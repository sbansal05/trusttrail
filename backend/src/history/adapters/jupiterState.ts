//! The second way to find Jupiter Lend liquidations: each position's state today, from the Jupiter SDK.
//! A position liquidated after the user last touched it reads `userLiquidationStatus = true`; a position
//! whose debt is zero while our history still shows it open had its debt cleared without a repay we saw.
//! Either one becomes a liquidation event, dated at the user's last transaction on the position
//! (the earliest moment the liquidation can have happened).

import { Connection, PublicKey } from "@solana/web3.js";
import { getCurrentPosition } from "@jup-ag/lend/borrow";
import type { CreditEvent } from "../types";

export type PositionState = { liquidated: boolean; debtRaw: bigint };
export type ReadPosition = (position: string) => Promise<PositionState | null>;

/** Marks the synthetic events: their proof is the position account's state, not a transaction. */
export const STATE_SIGNATURE_PREFIX = "position-state:";

export async function jupiterStateEvents(events: CreditEvent[], read: ReadPosition): Promise<CreditEvent[]> {
    const last = new Map<string, CreditEvent>();
    for (const e of events) {
        if (e.protocol !== "jupiter_lend") continue;
        const prev = last.get(e.position);
        if (!prev || e.timestamp >= prev.timestamp) last.set(e.position, e);
    }
    const out: CreditEvent[] = [];
    for (const [position, e] of last) {
        const state = await read(position);
        if (!state || (!state.liquidated && state.debtRaw !== 0n)) continue;
        out.push({
            ...e,
            kind: "liquidation",
            amount: 0n,
            signature: `${STATE_SIGNATURE_PREFIX}${position}`,
            paid: undefined,
        });
    }
    return out;
}

/** Position account (bytemuck): 8 discriminator, vault_id u16, nft_id u32, … */
export function parsePositionIds(data: Buffer): { vaultId: number; positionId: number } {
    return { vaultId: data.readUInt16LE(8), positionId: data.readUInt32LE(10) };
}

/** Reads a position on mainnet through the SDK; null if the position account no longer exists. */
export function sdkPositionReader(connection: Connection): ReadPosition {
    return async (position) => {
        const info = await connection.getAccountInfo(new PublicKey(position));
        if (!info) return null;
        const { vaultId, positionId } = parsePositionIds(info.data);
        const p = await getCurrentPosition({ vaultId, positionId, connection, market: "main" });
        return { liquidated: p.userLiquidationStatus, debtRaw: BigInt(p.debtRaw.toString()) };
    };
}

/** Mainnet RPC for the SDK reads: MAINNET_RPC_URL, or Helius mainnet with the same key as the history. */
export function mainnetConnection(): Connection {
    const url = process.env.MAINNET_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API}`;
    return new Connection(url, "confirmed");
}
