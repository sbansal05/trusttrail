//! Finds real wallets that borrowed recently on a protocol, to test the adapters on.
//! Usage:  npx tsx src/admin/findBorrowers.ts <kamino|marginfi|save>      (read only, uses HELIUS_API)

import { helius } from "../heliusClient";
import { ADAPTERS } from "../history/adapters";
import { accountKeys, succeeded } from "../history/adapters/common";
import { KAMINO_PROGRAM_ID } from "../getObligations";
import { MARGINFI_PROGRAM_ID } from "../history/adapters/marginfi";
import { SAVE_PROGRAM_ID } from "../history/adapters/save";

const PROGRAMS: Record<string, string> = { kamino: KAMINO_PROGRAM_ID, marginfi: MARGINFI_PROGRAM_ID, save: SAVE_PROGRAM_ID };

async function main() {
    const protocol = process.argv[2] ?? "";
    const program = PROGRAMS[protocol];
    const adapter = ADAPTERS.find((a) => a.protocol === protocol);
    if (!program || !adapter) throw new Error("usage: npx tsx src/admin/findBorrowers.ts <kamino|marginfi|save>");

    // newest first; the shared getTransaction helper reads oldest first
    const page = await helius.getTransactionsForAddress([
        program,
        { limit: 100, transactionDetails: "full", filters: { tokenAccounts: "none" }, sortOrder: "desc" },
    ]);
    const borrowers = new Map<string, number>();
    for (const tx of page.data) {
        if (!succeeded(tx)) continue;
        const signer = accountKeys(tx)[0]; // fee payer, normally the borrower
        const borrows = adapter.events(signer, tx).filter((e) => e.kind === "borrow").length;
        if (borrows > 0) borrowers.set(signer, (borrowers.get(signer) ?? 0) + borrows);
    }
    console.log(`${borrowers.size} wallets borrowed on ${protocol} in the latest ${page.data.length} transactions`);
    console.table([...borrowers].map(([wallet, borrows]) => ({ wallet, borrows })));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
