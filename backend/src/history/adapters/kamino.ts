//! Kamino Lend: borrow, repay and liquidation, from top-level and inner instructions.

import type { CreditEvent } from "../types";
import { KAMINO_PROGRAM_ID, kaminoInstructionName } from "../../getObligations";
import { getAllTransactions } from "../../heliusClient";
import { instructions, mintDecimals, signatureOf, timeOf, walletEvents, type Adapter, type Tx } from "./common";

type Layout = { kind: CreditEvent["kind"]; mintIndex: number };

/** Account positions from the klend IDL. The obligation is always account 1. */
const LAYOUTS: Record<string, Layout> = {
    borrowObligationLiquidity: { kind: "borrow", mintIndex: 5 },
    borrowObligationLiquidityV2: { kind: "borrow", mintIndex: 5 },
    repayObligationLiquidity: { kind: "repay", mintIndex: 4 },
    repayObligationLiquidityV2: { kind: "repay", mintIndex: 4 },
    repayAndWithdrawAndRedeem: { kind: "repay", mintIndex: 4 },
    liquidateObligationAndRedeemReserveCollateral: { kind: "liquidation", mintIndex: 5 },
    liquidateObligationAndRedeemReserveCollateralV2: { kind: "liquidation", mintIndex: 5 },
};
const OBLIGATION_INDEX = 1;

export const kamino: Adapter = {
    protocol: "kamino",
    events(wallet: string, tx: Tx): CreditEvent[] {
        const out: CreditEvent[] = [];
        for (const ix of instructions(tx)) {
            if (ix.program !== KAMINO_PROGRAM_ID) continue;
            const name = kaminoInstructionName(ix.data);
            const layout = name ? LAYOUTS[name] : undefined;
            if (!layout) continue;
            const mint = ix.accounts[layout.mintIndex];
            out.push({
                protocol: "kamino",
                wallet,
                position: ix.accounts[OBLIGATION_INDEX],
                kind: layout.kind,
                mint,
                amount: ix.data.readBigUInt64LE(8),
                decimals: mintDecimals(tx, mint),
                timestamp: timeOf(tx),
                signature: signatureOf(tx),
                dueAt: 0,
            });
        }
        return out;
    },
};

/** Kamino only (kept for the old debug scripts). */
export async function kaminoHistory(wallet: string): Promise<CreditEvent[]> {
    return walletEvents(wallet, [kamino], getAllTransactions);
}
