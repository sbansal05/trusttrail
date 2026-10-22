try {
    process.loadEnvFile();
} catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { whitelistPda } from "../history/chain";
import { GLOBAL_CONFIG, addWriterIx, initWhitelistIx, initializeIx } from "./trusttrailIx";

/** Writers in raw WriterWhitelist data: 8 discriminator, u32 length, then 32 bytes per pubkey. */
function parseWriters(data: Buffer): PublicKey[] {
    const n = data.readUInt32LE(8);
    return Array.from({ length: n }, (_, i) => new PublicKey(data.subarray(12 + 32 * i, 44 + 32 * i)));
}



async function main() {
    const writer = new PublicKey(process.argv[2] ?? "");
    const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
    // The GlobalConfig authority (admin) key; pass its path as the second argument.
    const adminPath = process.argv[3] ?? join(homedir(), ".config/solana/trusttrail-authority.json");
    const admin = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(adminPath, "utf8"))));
       const tx = new Transaction();
    const config = await connection.getAccountInfo(GLOBAL_CONFIG);
    if (!config) {
        tx.add(initializeIx(admin.publicKey)); // must be the program's upgrade authority; becomes the GlobalConfig authority
    } else {
        const authority = new PublicKey(config.data.subarray(8, 40));
        if (!authority.equals(admin.publicKey)) {
            throw new Error(`id.json is ${admin.publicKey.toBase58()}, but the GlobalConfig authority is ${authority.toBase58()}`);
        }
    }
    let list = await connection.getAccountInfo(whitelistPda());
    if (!list) tx.add(initWhitelistIx(admin.publicKey));
    const writers = list ? parseWriters(list.data) : [];
    if (writers.some((w) => w.equals(writer))) {
        console.log(`${writer.toBase58()} is already a writer`);
    } else {
        tx.add(addWriterIx(admin.publicKey, writer));
    }

    if (tx.instructions.length > 0) {
        const sig = await sendAndConfirmTransaction(connection, tx, [admin]);
        console.log("tx:", sig);
    }
    list = await connection.getAccountInfo(whitelistPda());
    console.log("whitelist:", whitelistPda().toBase58());
    console.log("writers:", parseWriters(list!.data).map((w) => w.toBase58()));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});