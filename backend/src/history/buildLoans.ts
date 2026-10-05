import { CreditEvent, Loan } from "./types";

type OpenLoan = { first: CreditEvent; debt: bigint; peak: bigint; peakEvent: CreditEvent };

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
                o = { first: e, debt: 0n, peak: 0n, peakEvent: e };
                open.set(key, o)
            }
            o.debt += e.amount
            if (o.debt > o.peak){
                o.peak = o.debt ;
                o.peakEvent = e;
            }

            
        } else if (e.kind === "repay") {
            if (!cur) continue;
            cur.debt -= e.amount;
            if (cur.debt <= 0n) {
                const outcome = cur.first.dueAt !== 0 && e.timestamp > cur.first.dueAt ? 1 : 0;
                loans.push(close(cur, e, outcome))
                open.delete(key);
            }
            
        } else {
            if (!cur) {
                continue;
            } else {
                const outcome = 2;
                loans.push(close(cur, e, 2));
                open.delete(key)
            }
        }
    }
    return loans;
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
        dueAt: f.dueAt,
        outcome,
        peakAt: o.peakEvent.timestamp,
        openSignature: f.signature,
        peakSignature: o.peakEvent.signature,
        endSignature: end.signature,
    };
}