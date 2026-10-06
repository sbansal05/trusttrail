//! Save (formerly Solend): borrow, repay and liquidation, from top-level and inner instructions.
//! Not an Anchor program: the first data byte is the instruction tag, then a u64 amount.

import type { CreditEvent } from "../types";
import { instructions, signatureOf, timeOf, tokenAccountMint, type Adapter, type Tx } from "./common";

export const SAVE_PROGRAM_ID = "So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo";

type Layout = { kind: CreditEvent["kind"]; obligation: number; tokens: number[] };

/**
 * Instruction tag → account positions. `tokens` = accounts holding the borrowed token, tried in order:
 * the user's account first, then the reserve's liquidity supply (always listed).
 */
const LAYOUTS: Record<number, Layout> = {
    10: { kind: "borrow", obligation: 4, tokens: [1, 0] },     // BorrowObligationLiquidity: destination, then source supply
    11: { kind: "repay", obligation: 3, tokens: [0, 1] },      // RepayObligationLiquidity: source, then destination supply
    12: { kind: "liquidation", obligation: 6, tokens: [3] },   // LiquidateObligation: repay reserve liquidity supply
    17: { kind: "liquidation", obligation: 10, tokens: [4] },  // LiquidateObligationAndRedeemReserveCollateral: same
};

export const save: Adapter = {
    protocol: "save",
    events(wallet: string, tx: Tx): CreditEvent[] {
        const out: CreditEvent[] = [];
        for (const ix of instructions(tx)) {
            if (ix.program !== SAVE_PROGRAM_ID || ix.data.length < 9) continue;
            const layout = LAYOUTS[ix.data[0]];
            if (!layout) continue;
            const token = tokenAccountMint(tx, ...layout.tokens.map((i) => ix.accounts[i]));
            if (!token) continue;
            out.push({
                protocol: "save",
                wallet,
                position: ix.accounts[layout.obligation],
                kind: layout.kind,
                mint: token.mint,
                amount: ix.data.readBigUInt64LE(1), // u64::MAX on a repay means "repay all"
                decimals: token.decimals,
                timestamp: timeOf(tx),
                signature: signatureOf(tx),
                dueAt: 0,
            });
        }
        return out;
    },
};
