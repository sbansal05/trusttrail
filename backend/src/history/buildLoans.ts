import { CreditEvent, Loan, Protocol } from "./types";
import { REPAY_ALL } from "./adapters/common";

type OpenLoan = { first: CreditEvent; debt: bigint; peak: bigint; peakEvent: CreditEvent; borrowed: bigint; repaid: bigint };

/** Grace after the due date before a loan counts as defaulted. Only protocols with real due dates have one. */
export const GRACE_SECS: Partial<Record<Protocol, number>> = { loopscale: 2 * 86_400 };

/**
 * Outcome of a repay at `at`: on time by the due date, late within the grace, defaulted after it.
 * Without a due date every full repay is on time.
 */
export function repayOutcome(protocol: Protocol, dueAt: number, at: number): Loan["outcome"] {
    if (dueAt === 0 || at <= dueAt) return 0;
    const grace = GRACE_SECS[protocol];
    return grace !== undefined && at > dueAt + grace ? 3 : 1;
}

/** A liquidation after the grace is a default (the deadline was missed); before it, a liquidation. */
export function liquidationOutcome(protocol: Protocol, dueAt: number, at: number): Loan["outcome"] {
    const grace = GRACE_SECS[protocol];
    return dueAt !== 0 && grace !== undefined && at > dueAt + grace ? 3 : 2;
}

/** Turns one wallet's events into closed loans. Open loans at the end are dropped. */
export function buildLoans(events: CreditEvent[]): Loan[] {
    const loans: Loan[] = [];
    const open = new Map<string, OpenLoan>();

    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

    for (const e of sorted) {
        const key = `${e.protocol}:${e.position}:${e.mint}`;
        const cur = open.get(key);

        if (e.kind === "borrow") {
            let  o = cur;
            if (!o) {
                o = { first: e, debt: 0n, peak: 0n, peakEvent: e, borrowed: 0n, repaid: 0n };
                open.set(key, o)
            }
            o.debt += e.amount;
            o.borrowed += e.amount;
            if (o.debt > o.peak) {
                o.peak = o.debt;
                o.peakEvent = e;
            }

            
        } else if (e.kind === "repay") {
            if (!cur) continue;
            cur.debt -= e.amount;
            cur.repaid += e.amount === REPAY_ALL ? (e.paid ?? 0n) : e.amount;
            if (cur.debt <= 0n) {
                // A repay-everything that moved less than was borrowed: a liquidation took the rest.
                const short = e.amount === REPAY_ALL && e.paid !== undefined && cur.repaid < cur.borrowed;
                const due = dueOf(cur, e);
                const outcome = short ? liquidationOutcome(e.protocol, due, e.timestamp) : repayOutcome(e.protocol, due, e.timestamp);
                loans.push(close(cur, e, outcome));
                open.delete(key);
            }
            
        } else {
            if (!cur) {
                continue;
            } else {
                loans.push(close(cur, e, liquidationOutcome(e.protocol, dueOf(cur, e), e.timestamp)));
                open.delete(key);
            }
        }
    }
    return loans;
}

/** The due date in force when the loan ends: the closing event's (a rollover moves it), else the first borrow's. */
function dueOf(o: OpenLoan, end: CreditEvent): number {
    return end.dueAt !== 0 ? end.dueAt : o.first.dueAt;
}

function close(o: OpenLoan, end: CreditEvent, outcome: Loan["outcome"]): Loan {
    const f = o.first;
    return {
        protocol: f.protocol,
        wallet: f.wallet,
        position: f.position,
        mint: f.mint,
        decimals: f.decimals,
        principal: o.peak,
        openedAt: f.timestamp,
        closedAt: end.timestamp,
        dueAt: dueOf(o, end),
        outcome,
        peakAt: o.peakEvent.timestamp,
        openSignature: f.signature,
        peakSignature: o.peakEvent.signature,
        endSignature: end.signature,
    };
}
/**
 * Loans repaid in the transaction that opened them (flash loans, arbitrage bots) put nothing at risk and
 * score nothing (duration 0), so they are removed before pricing. Liquidations are always kept.
 */
export function withoutSameTransaction(loans: Loan[]): { kept: Loan[]; sameTransaction: number } {
    const kept = loans.filter((l) => l.outcome >= 2 || l.openSignature !== l.endSignature);
    return { kept, sameTransaction: loans.length - kept.length };
}
