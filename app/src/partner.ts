//! Northwind Lend, a made-up second lender. It reads a wallet's TrustTrail score account straight from
//! Solana (no TrustTrail server involved) and prices its own offer from it, to show the record is portable.

import { PublicKey, type Connection } from "@solana/web3.js";

export const TRUSTTRAIL_PROGRAM_ID = new PublicKey("BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s");
const SCORE_SEED = new TextEncoder().encode("trust-v2");
/** UserReputationV2: 8-byte discriminator + 122 bytes of fields. */
const SCORE_ACCOUNT_LEN = 130;

export const scoreAccount = (wallet: PublicKey) => PublicKey.findProgramAddressSync([SCORE_SEED, wallet.toBytes()], TRUSTTRAIL_PROGRAM_ID)[0];

/** The fields the program caches for other apps to read. */
export type TrustTrailRecord = {
    account: string;
    score: number;
    tier: number;
    onTime: number;
    late: number;
    liquidated: number;
    totalRepaidUsdc: bigint;
    updatedAt: number;
};

/**
 * UserReputationV2, Borsh, little-endian: discriminator 8 | wallet 32 | score u16 @40 | native u16 | imported u16 |
 * import_date i64 | tier u8 @54 | on_time u16 @55 | late u16 @57 | liquidated u16 @59 | streak u16 |
 * last_liquidation i64 | total_usdc_repaid u64 @71 | last_update i64 @79 | …
 */
export function parseRecord(account: PublicKey, data: Uint8Array): TrustTrailRecord {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return {
        account: account.toBase58(),
        score: v.getUint16(40, true),
        tier: v.getUint8(54),
        onTime: v.getUint16(55, true),
        late: v.getUint16(57, true),
        liquidated: v.getUint16(59, true),
        totalRepaidUsdc: v.getBigUint64(71, true),
        updatedAt: Number(v.getBigInt64(79, true)),
    };
}

/** The wallet's record from chain, or null when it has never used TrustTrail. */
export async function readRecord(connection: Connection, wallet: string): Promise<TrustTrailRecord | null> {
    const account = scoreAccount(new PublicKey(wallet));
    const info = await connection.getAccountInfo(account);
    if (!info) return null;
    // The address comes from the program's seeds, so only the program can have made it; still check owner and size.
    if (!info.owner.equals(TRUSTTRAIL_PROGRAM_ID) || info.data.length < SCORE_ACCOUNT_LEN) throw new Error("not a TrustTrail score account");
    return parseRecord(account, info.data);
}

// ---------- Northwind's own terms ----------

/** Northwind's base terms per TrustTrail tier (Unproven, Bronze, Silver, Gold). */
export const NORTHWIND_BASE = [
    { aprBps: 900, collateralBps: 16_000 },
    { aprBps: 700, collateralBps: 14_500 },
    { aprBps: 500, collateralBps: 13_000 },
    { aprBps: 350, collateralBps: 11_500 },
];
const ON_TIME_STEP = 3; // every 3 on-time repays …
const ON_TIME_CUT_BPS = 50; // … take 0.5% off the APR,
const ON_TIME_CUT_MAX_BPS = 150; // at most 1.5%
const LATE_ADD_BPS = 50; // each late repay adds 0.5% to the APR,
const LATE_ADD_MAX_BPS = 200; // at most 2%
const LIQUIDATED_ADD_COLLATERAL_BPS = 1_000; // any liquidation: 10% more collateral
const APR_FLOOR_BPS = 200;

export type Adjustment = { label: string; aprBps: number; collateralBps: number };
export type NorthwindOffer = { tier: number; base: Adjustment; adjustments: Adjustment[]; aprBps: number; collateralBps: number };

/** Northwind's price for a record: the tier's base, then its own rules on the counts inside the record. */
export function northwindOffer(r: TrustTrailRecord | null, tierName: (tier: number) => string): NorthwindOffer {
    const tier = r?.tier ?? 0;
    const b = NORTHWIND_BASE[tier];
    const base = { label: `Base for ${tierName(tier)}`, aprBps: b.aprBps, collateralBps: b.collateralBps };
    const adjustments: Adjustment[] = [];
    if (r) {
        const steps = Math.floor(r.onTime / ON_TIME_STEP);
        if (steps > 0) {
            adjustments.push({ label: `${r.onTime} on-time repays`, aprBps: -Math.min(steps * ON_TIME_CUT_BPS, ON_TIME_CUT_MAX_BPS), collateralBps: 0 });
        }
        if (r.late > 0) {
            adjustments.push({ label: `${r.late} late repay${r.late === 1 ? "" : "s"}`, aprBps: Math.min(r.late * LATE_ADD_BPS, LATE_ADD_MAX_BPS), collateralBps: 0 });
        }
        if (r.liquidated > 0) {
            adjustments.push({ label: `Liquidated ${r.liquidated} time${r.liquidated === 1 ? "" : "s"}`, aprBps: 0, collateralBps: LIQUIDATED_ADD_COLLATERAL_BPS });
        }
    }
    const apr = adjustments.reduce((sum, a) => sum + a.aprBps, base.aprBps);
    const collateral = adjustments.reduce((sum, a) => sum + a.collateralBps, base.collateralBps);
    return { tier, base, adjustments, aprBps: Math.max(apr, APR_FLOOR_BPS), collateralBps: collateral };
}