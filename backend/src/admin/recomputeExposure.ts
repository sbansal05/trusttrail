//! Lowers every wallet's stored exposure (E) to the current rule, rebuilt from its repayment attestations.
//! Dry run by default: prints stored and recomputed E for every score account.
//! With --send, sends set_exposure for each wallet whose E goes down, signed by the GlobalConfig admin.
//! Usage: npx tsx src/admin/recomputeExposure.ts [--send] [admin keypair path]

try {
    process.loadEnvFile();
} catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { REPUTATION_LEN, TRUSTTRAIL_PROGRAM_ID, parseReputation } from "../history/chain";
import { repaymentsOf } from "../score/attestations";
import { exposureChange, type ExposureChange } from "./exposureFix";
import { GLOBAL_CONFIG, setExposureIx } from "./trusttrailIx";

const asWeight = (bps: bigint) => (Number(bps) / 10_000).toFixed(4);

async function main() {
    const send = process.argv.includes("--send");
    const adminPath = process.argv.slice(2).find((a) => a !== "--send") ?? join(homedir(), ".config/solana/trusttrail-authority.json");
    const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");

    const accounts = await connection.getProgramAccounts(TRUSTTRAIL_PROGRAM_ID, { filters: [{ dataSize: REPUTATION_LEN }] });
    const changes: ExposureChange[] = [];
    for (const { account } of accounts) {
        const rep = parseReputation(account.data);
        const records = await repaymentsOf(connection, new PublicKey(rep.wallet));
        const c = exposureChange(rep.wallet, rep.exposureBps, records);
        changes.push(c);
        console.log(`${c.wallet}  E ${asWeight(c.storedBps)} -> ${asWeight(c.recomputedBps)}  ${c.action}  (${records.length} records)`);
    }
    const lower = changes.filter((c) => c.action === "lower");
    console.log(`${changes.length} score accounts, ${lower.length} to lower, ${changes.filter((c) => c.action === "skip").length} skipped`);
    if (!send) {
        console.log("Dry run: nothing sent. Run again with --send to lower them.");
        return;
    }

    const admin = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(adminPath, "utf8"))));
    const config = await connection.getAccountInfo(GLOBAL_CONFIG);
    if (!config) throw new Error("GlobalConfig not found");
    const authority = new PublicKey(config.data.subarray(8, 40));
    if (!authority.equals(admin.publicKey)) {
        throw new Error(`${adminPath} is ${admin.publicKey.toBase58()}, but the GlobalConfig admin is ${authority.toBase58()}`);
    }
    for (const c of lower) {
        const tx = new Transaction().add(setExposureIx(admin.publicKey, new PublicKey(c.wallet), c.recomputedBps));
        console.log(`${c.wallet}: ${await sendAndConfirmTransaction(connection, tx, [admin])}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});