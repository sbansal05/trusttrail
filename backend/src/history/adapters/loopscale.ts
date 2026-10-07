//! Loopscale: fixed-term loans matched on an order book. Borrow, repay and liquidation of one ledger
//! (a loan holds up to 5 ledgers, one per principal). The principal mint is an account of every instruction.

import type { CreditEvent } from "../types";
import { discriminator } from "../importTx";
import { REPAY_ALL, instructions, mintDecimals, signatureOf, timeOf, type Adapter, type Tx } from "./common";

export const LOOPSCALE_PROGRAM_ID = "1oopBoJG58DgkUVKkEzKgyG9dvRmpgeEm1AVjoHkF78";

type Layout = { kind: CreditEvent["kind"]; disc: Buffer; mint: number };

/** Account positions from the Loopscale IDL: borrower is account 2 and the loan account 3 in all three. */
const LAYOUTS: Layout[] = [
    { kind: "borrow", disc: discriminator("borrow_principal"), mint: 6 },
    { kind: "repay", disc: discriminator("repay_principal"), mint: 6 },
    { kind: "liquidation", disc: discriminator("liquidate_ledger"), mint: 8 },
];
const BORROWER = 2;
const LOAN = 3;

/**
 * borrow_principal(amount u64, …) and repay_principal(amount u64, ledger_index u8, repay_all bool).
 * liquidate_ledger carries no amount: the liquidation closes the ledger whatever is left.
 */
function amountOf(kind: CreditEvent["kind"], data: Buffer): bigint {
    if (kind === "liquidation") return 0n;
    if (kind === "repay" && data.length >= 18 && data[17] === 1) return REPAY_ALL;
    return data.readBigUInt64LE(8);
}

export const loopscale: Adapter = {
    protocol: "loopscale",
    events(wallet: string, tx: Tx): CreditEvent[] {
        const out: CreditEvent[] = [];
        for (const ix of instructions(tx)) {
            if (ix.program !== LOOPSCALE_PROGRAM_ID || ix.data.length < 8) continue;
            const layout = LAYOUTS.find((l) => ix.data.subarray(0, 8).equals(l.disc));
            // Only this wallet's own loans: a liquidator's history also holds other borrowers' liquidations.
            if (!layout || ix.accounts[BORROWER] !== wallet) continue;
            const mint = ix.accounts[layout.mint];
            out.push({
                protocol: "loopscale",
                wallet,
                position: ix.accounts[LOAN],
                kind: layout.kind,
                mint,
                amount: amountOf(layout.kind, ix.data),
                decimals: mintDecimals(tx, mint),
                timestamp: timeOf(tx),
                signature: signatureOf(tx),
                dueAt: 0,
            });
        }
        return out;
    },
};
