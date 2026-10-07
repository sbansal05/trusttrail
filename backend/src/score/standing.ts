//! A wallet's score as of now, exactly as the pool sees it at borrow time (Rust `standing`),
//! plus the factors behind it and what the next tier still needs.

import type { Reputation } from "../history/chain";
import {
    BPS, FULL_WEIGHT_BPS, LIQUIDATION_COOLDOWN_SECS, TIER_BRONZE, TIER_GATES, TIER_GOLD, TIER_NAMES,
    blend, computeTier, decayBps, liquidationClean, nativeComponent, nativeShareBps,
} from "../history/scoring";

export type Standing = { native: bigint; score: bigint; tier: number };

/** Penalty decayed to now → native part → blend with the imported part → tier. */
export function standing(rep: Reputation, now: number): Standing {
    const sMinus = decayBps(rep.sMinusBps, rep.sMinusAt, now);
    const native = nativeComponent(rep.sPlusBps, sMinus);
    const score = blend(native, BigInt(rep.importedScore), rep.exposureBps);
    const tier = computeTier(score, rep.meaningfulOnTime, rep.meaningfulWeightBps, rep.lastLiquidationDate, now);
    return { native, score, tier };
}

/** One condition of the next tier: what the wallet has, what it needs, and whether it already passes. */
export type Gate =
    | { gate: "score" | "meaningfulOnTime" | "meaningfulWeightBps"; have: string; need: string; met: boolean }
    | { gate: "noLiquidationFor90Days"; blockedUntil: number | null; met: boolean };

export type NextTier = { tier: string; gates: Gate[] } | null;

const amount = (gate: "score" | "meaningfulOnTime" | "meaningfulWeightBps", have: bigint, need: bigint): Gate =>
    ({ gate, have: have.toString(), need: need.toString(), met: have >= need });

/** The tier above the current one and each of its gates; null at Gold. */
export function nextTier(rep: Reputation, s: Standing, now: number): NextTier {
    if (s.tier === TIER_GOLD) return null;
    const target = s.tier + 1;
    if (target === TIER_BRONZE) return { tier: TIER_NAMES[target], gates: [amount("score", s.score, 1n)] };

    const g = TIER_GATES[target as keyof typeof TIER_GATES];
    const clean = liquidationClean(rep.lastLiquidationDate, now);
    return {
        tier: TIER_NAMES[target],
        gates: [
            amount("score", s.score, BigInt(g.minScore)),
            amount("meaningfulOnTime", BigInt(rep.meaningfulOnTime), BigInt(g.minOnTime)),
            amount("meaningfulWeightBps", rep.meaningfulWeightBps, g.minWeightBps),
            {
                gate: "noLiquidationFor90Days",
                blockedUntil: clean ? null : rep.lastLiquidationDate + LIQUIDATION_COOLDOWN_SECS,
                met: clean,
            },
        ],
    };
}

export type Factors = {
    native: number;
    imported: number;
    importDate: number;               // 0 = never imported
    blend: {
        exposureBps: string;          // Σ weight of closed native loans of $100+
        fullWeightBps: string;        // exposure at which the native part counts 100%
        nativeShareBps: string;
        importedShareBps: string;
    };
    meaningful: { onTime: number; weightBps: string };
    liquidation: { last: number; blockedUntil: number | null };  // last = 0: never
    nextTier: NextTier;
};

export function factors(rep: Reputation, s: Standing, now: number): Factors {
    const nativeShare = nativeShareBps(rep.exposureBps);
    const clean = liquidationClean(rep.lastLiquidationDate, now);
    return {
        native: Number(s.native),
        imported: rep.importedScore,
        importDate: rep.importDate,
        blend: {
            exposureBps: rep.exposureBps.toString(),
            fullWeightBps: FULL_WEIGHT_BPS.toString(),
            nativeShareBps: nativeShare.toString(),
            importedShareBps: (BPS - nativeShare).toString(),
        },
        meaningful: { onTime: rep.meaningfulOnTime, weightBps: rep.meaningfulWeightBps.toString() },
        liquidation: {
            last: rep.lastLiquidationDate,
            blockedUntil: clean ? null : rep.lastLiquidationDate + LIQUIDATION_COOLDOWN_SECS,
        },
        nextTier: nextTier(rep, s, now),
    };
}

/** A wallet with no score account reads as all zeros: Unproven. */
export function emptyReputation(wallet: string): Reputation {
    return {
        wallet, score: 0, nativeScore: 0, importedScore: 0, importDate: 0, tier: 0,
        loansRepaidOnTime: 0, lateRepaidLoans: 0, liquidatedLoans: 0, currentOnTimeStreak: 0,
        lastLiquidationDate: 0, totalUsdcRepaid: 0n, lastUpdate: 0,
        sPlusBps: 0n, sMinusBps: 0n, sMinusAt: 0, exposureBps: 0n, meaningfulOnTime: 0, meaningfulWeightBps: 0n,
    };
}
