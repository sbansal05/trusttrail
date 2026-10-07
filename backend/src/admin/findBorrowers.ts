//! Finds real wallets that borrowed recently on a protocol, to test the adapters on.
//! Usage:  npx tsx src/admin/findBorrowers.ts <kamino|marginfi|save|loopscale|jupiter> [pages]   (read only, uses HELIUS_API)
//! Reads the program's newest transactions, 100 per page (1 page by default, at most 20).

import { helius } from "../heliusClient";
import { accountKeys, succeeded, type Adapter } from "../history/adapters/common";
import { kamino } from "../history/adapters/kamino";
import { marginfi, MARGINFI_PROGRAM_ID } from "../history/adapters/marginfi";
import { save, SAVE_PROGRAM_ID } from "../history/adapters/save";
import { loopscale, LOOPSCALE_PROGRAM_ID } from "../history/adapters/loopscale";
import { jupiterLend, JUPITER_VAULTS_PROGRAM_ID } from "../history/adapters/jupiterLend";
import { KAMINO_PROGRAM_ID } from "../getObligations";

const PROTOCOLS: Record<string, { program: string; adapter: Adapter }> = {
    kamino: { program: KAMINO_PROGRAM_ID, adapter: kamino },
    marginfi: { program: MARGINFI_PROGRAM_ID, adapter: marginfi },
    save: { program: SAVE_PROGRAM_ID, adapter: save },
    loopscale: { program: LOOPSCALE_PROGRAM_ID, adapter: loopscale },
    jupiter: { program: JUPITER_VAULTS_PROGRAM_ID, adapter: jupiterLend },
};

async function main() {
    const name = process.argv[2] ?? "";
    const p = PROTOCOLS[name];
    if (!p) throw new Error(`usage: npx tsx src/admin/findBorrowers.ts <${Object.keys(PROTOCOLS).join("|")}>`);

    const pages = Math.min(Math.max(Number(process.argv[3] ?? 1), 1), 20);
    const borrowers = new Map<string, number>();
    let token: string | undefined;
    let read = 0;
    for (let i = 0; i < pages; i++) {
        // newest first; the shared getTransaction helper reads oldest first
        const page = await helius.getTransactionsForAddress([
            p.program,
            { limit: 100, transactionDetails: "full", filters: { tokenAccounts: "none" }, sortOrder: "desc", paginationToken: token },
        ]);
        read += page.data.length;
        for (const tx of page.data) {
            if (!succeeded(tx)) continue;
            // every signer: the fee payer is not always the borrower (a relayer can pay)
            const signers = accountKeys(tx).slice(0, (tx.transaction as any).message.header?.numRequiredSignatures ?? 1);
            for (const signer of signers) {
                const borrows = p.adapter.events(signer, tx).filter((e) => e.kind === "borrow").length;
                if (borrows > 0) borrowers.set(signer, (borrowers.get(signer) ?? 0) + borrows);
            }
        }
        token = page.paginationToken ?? undefined;
        if (!token || page.data.length === 0) break;
    }
    console.log(`${borrowers.size} wallets borrowed on ${name} in the latest ${read} transactions`);
    console.table([...borrowers].map(([wallet, borrows]) => ({ wallet, borrows })));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
