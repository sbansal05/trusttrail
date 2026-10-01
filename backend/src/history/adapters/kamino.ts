import bs58 from "bs58";
import { CreditEvent } from "../types";
import { KAMINO_PROGRAM_ID, getInstructionName } from "../../getObligations";
import { TransactionList } from "../../heliusClient";

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

export function kaminoEvents(wallet: string, txs: TransactionList): CreditEvent[] {
    const events: CreditEvent[] = [];

    for (const tx of txs) {
        const meta = (tx as any).meta;
        const message = (tx.transaction as any).message;

        if (meta.err != null) continue;

        
        const allKeys: string[] = [
            ...message.accountKeys,
            ...(meta.loadedAddresses?.writable ?? []),
            ...(meta.loadedAddresses?.readonly ?? []),
        ];

        message.instructions.forEach((ix: any) => {
            if (message.accountKeys[ix.programIdIndex] !== KAMINO_PROGRAM_ID) return;
            const name = getInstructionName(ix.data);
            const layout = name ? LAYOUTS[name] : undefined;
            if (!layout) return;

            const data = Buffer.from(bs58.decode(ix.data));

            const amount = data.readBigUInt64LE(8);

            
            const position = allKeys[ix.accounts[OBLIGATION_INDEX]];
            const mint = allKeys[ix.accounts[layout.mintIndex]];

            events.push({
                protocol: "kamino",
                wallet,
                position,
                kind: layout.kind,
                mint,
                amount,
                decimals: mintDecimals(meta, mint),
                timestamp: tx.blockTime ?? 0,
                signature: (tx.transaction as any).signatures[0],
                dueAt: 0,
            });
        });
    }
    return events;
}

/** Decimals from the tx's token balances; USDC-style 6 if the mint isn't listed. */
function mintDecimals(meta: any, mint: string): number {
    const all = [...(meta?.preTokenBalances ?? []), ...(meta?.postTokenBalances ?? [])];
    const hit = all.find((b: any) => b.mint === mint);
    return hit ? hit.uiTokenAmount.decimals : 6;
}