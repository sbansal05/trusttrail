try {
    process.loadEnvFile();
} catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
    Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import { TRUSTTRAIL_PROGRAM_ID, whitelistPda } from "../history/chain";
import { discriminator } from "../history/importTx";

const GLOBAL_CONFIG = PublicKey.findProgramAddressSync([Buffer.from("global-config")], TRUSTTRAIL_PROGRAM_ID)[0];

/** Writers in raw WriterWhitelist data: 8 discriminator, u32 length, then 32 bytes per pubkey. */
function parseWriters(data: Buffer): PublicKey[] {
    const n = data.readUInt32LE(8);
    return Array.from({ length: n }, (_, i) => new PublicKey(data.subarray(12 + 32 * i, 44 + 32 * i)));
}

function initWhitelistIx(admin: PublicKey): TransactionInstruction {
    return new TransactionInstruction({
        programId: TRUSTTRAIL_PROGRAM_ID,
        keys: [
            { pubkey: admin, isSigner: true, isWritable: true },
            { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: false },
            { pubkey: whitelistPda(), isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: discriminator("init_writer_whitelist"),
    });
}

function addWriterIx(admin: PublicKey, writer: PublicKey): TransactionInstruction {
    return new TransactionInstruction({
        programId: TRUSTTRAIL_PROGRAM_ID,
        keys: [
            { pubkey: admin, isSigner: true, isWritable: false },
            { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: false },
            { pubkey: whitelistPda(), isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([discriminator("add_writer"), writer.toBuffer()]),
    });
}
function initializeIx(admin: PublicKey): TransactionInstruction {
    return new TransactionInstruction({
        programId: TRUSTTRAIL_PROGRAM_ID,
        keys: [
            { pubkey: admin, isSigner: true, isWritable: true },
            { pubkey: GLOBAL_CONFIG, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: discriminator("initialize"),
    });
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
        tx.add(initializeIx(admin.publicKey)); // the admin wallet becomes the GlobalConfig authority
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