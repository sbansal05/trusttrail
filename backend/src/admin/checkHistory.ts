//! Live check of the history adapters on a real wallet: events per protocol, then the loans they make.
//! Usage:  npx tsx src/admin/checkHistory.ts <wallet>      (read only, uses HELIUS_API)

import { walletHistory } from "../history/adapters";
import { buildLoans, withoutSameTransaction } from "../history/buildLoans";

const OUTCOME = ["on time", "late", "liquidated", "defaulted"];

async function main() {
    const wallet = process.argv[2];
    if (!wallet) throw new Error("usage: npx tsx src/admin/checkHistory.ts <wallet>");
    const events = await walletHistory(wallet);

    const counts = new Map<string, { borrow: number; repay: number; liquidation: number }>();
    for (const e of events) {
        const c = counts.get(e.protocol) ?? { borrow: 0, repay: 0, liquidation: 0 };
        c[e.kind] += 1;
        counts.set(e.protocol, c);
    }
    console.log(`\n${events.length} events`);
    console.table(Object.fromEntries(counts));

    const { kept: loans, sameTransaction } = withoutSameTransaction(buildLoans(events));
    console.log(`\n${sameTransaction} loans repaid in the transaction that opened them (skipped)`);

    const byOutcome = new Map<string, number>();
    for (const l of loans) byOutcome.set(OUTCOME[l.outcome], (byOutcome.get(OUTCOME[l.outcome]) ?? 0) + 1);
    console.log(`${loans.length} closed loans kept:`, Object.fromEntries(byOutcome));

    // A long history shows its first and last loans only.
    const shown = loans.length > 50 ? [...loans.slice(0, 20), ...loans.slice(-20)] : loans;
    if (shown.length < loans.length) console.log(`showing the first 20 and the last 20`);
    console.table(
        shown.map((l) => ({
            protocol: l.protocol,
            mint: l.mint.slice(0, 6),
            peak: (Number(l.principal) / 10 ** l.decimals).toFixed(2),
            days: ((l.closedAt - l.openedAt) / 86_400).toFixed(1),
            outcome: OUTCOME[l.outcome],
            closed: new Date(l.closedAt * 1000).toISOString().slice(0, 10),
        })),
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
