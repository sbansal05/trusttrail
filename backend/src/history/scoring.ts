import type { Loan } from "./types";
export const BPS = 10_000n;
export const USDC = 1_000_000n;
export const MIN_PRINCIPAL = 100n * USDC;
export const MIN_HOLD_SECS = 86_400;
export const FULL_WEIGHT_BPS = 80_000n;
export const SCORE_MAX = 1_000n;
export const PENALTY_HALF_LIFE_SECS = 90 * 86_400;

const WEIGHT_TABLE: [bigint, bigint][] = [
    [100n * USDC, 0n], [150n * USDC, 2_026n], [200n * USDC, 3_463n], [300n * USDC, 5_489n],
    [500n * USDC, 8_041n], [740n * USDC, 10_000n], [2_500n * USDC, 10_244n],
    [10_000n * USDC, 10_522n], [50_000n * USDC, 10_845n], [108_000n * USDC, 11_000n],
];
const HALF_STEP_TABLE = [10_000n, 9_170n, 8_409n, 7_711n, 7_071n, 6_484n, 5_946n, 5_453n, 5_000n];

const O_ON_TIME = 10_000n, O_LATE = 5_000n, O_LIQUIDATED = 20_000n, O_DEFAULTED = 30_000n;

/** D = min(1, hours open / 24) in bps. */
export function durationBps(openedAt: number, closedAt: number): bigint {
    const held = Math.min(Math.max(closedAt - openedAt, 0), MIN_HOLD_SECS);
    return (BigInt(held) * BPS) / BigInt(MIN_HOLD_SECS);
}

export function dueDateFactorBps(dueAt: number): bigint {
    return dueAt !== 0 ? 10_000n : 5_000n;
}

/** w(P) in bps, straight-line between WEIGHT_TABLE rows. */
export function principalWeightBps(principal: bigint): bigint {
    const [firstP] = WEIGHT_TABLE[0];
    if (principal < firstP) return 0n;

    const [lastP, lastW] = WEIGHT_TABLE[WEIGHT_TABLE.length - 1];
    if (principal >= lastP) return lastW;

    for (let i = 0; i < WEIGHT_TABLE.length - 1; i++) {
        const [p0, w0] = WEIGHT_TABLE[i];
        const [p1, w1] = WEIGHT_TABLE[i + 1];
        if (principal < p1) {
            return w0 + ((principal - p0) * (w1 - w0)) / (p1 - p0);
        }
    }
    return lastW;
}

/** (S⁺ delta, S⁻ delta) for one closed loan. */
export function loanContributionBps(
    principal: bigint, openedAt: number, closedAt: number, dueAt: number, outcome: number,
): [bigint, bigint] {
    const w = principalWeightBps(principal);
    if (outcome === 0 || outcome === 1) {
        const o = outcome === 0 ? O_ON_TIME : O_LATE;
        const d = durationBps(openedAt, closedAt);
        return [((((w * d) / BPS) * o) / BPS * dueDateFactorBps(dueAt)) / BPS, 0n];
    }
    if (outcome === 2) return [0n, (w * O_LIQUIDATED) / BPS];
    if (outcome === 3) return [0n, (w * O_DEFAULTED) / BPS];
    return [0n, 0n];
}

/** value × 0.5^((now − from) / 90 days). */
export function decayBps(value: bigint, from: number, now: number): bigint {
    const hl = BigInt(PENALTY_HALF_LIFE_SECS);
    const elapsed = BigInt(Math.max(now - from, 0));
    const halvings = elapsed / hl;
    if (halvings >= 64n) return 0n;

    const afterHalvings = value >> halvings;
    const rest = elapsed % hl;
    const scaled = rest * 8n;
    const step = Number(scaled / hl);
    const within = scaled % hl;
    const hi = HALF_STEP_TABLE[step];
    const lo = HALF_STEP_TABLE[step + 1];
    const factor = hi - ((hi - lo) * within) / hl;
    return (afterHalvings * factor) / BPS;
}

/** clamp(1000 × (min(S⁺, 8.0) − S⁻) ÷ 8.0, 0, 1000) */
export function nativeComponent(sPlus: bigint, sMinusNow: bigint): bigint {
    const good = sPlus < FULL_WEIGHT_BPS ? sPlus : FULL_WEIGHT_BPS;
    const net = good > sMinusNow ? good - sMinusNow : 0n;
    return (net * SCORE_MAX) / FULL_WEIGHT_BPS;
}
/** Repaid in full (on time or late), at least $100, open at least 24 h. Same as Rust `meaningful_loan`. */
export function meaningfulLoan(principal: bigint, openedAt: number, closedAt: number, outcome: number): boolean {
    const repaidInFull = outcome === 0 || outcome === 1;
    return repaidInFull && principal >= MIN_PRINCIPAL && closedAt - openedAt >= MIN_HOLD_SECS;
}

export type ImportSummary = {
    score: bigint;               // 0..1000, written as imported_score
    meaningfulOnTime: number;    // added to meaningful_on_time
    meaningfulWeightBps: bigint; // added to meaningful_weight_bps
};

/** What `set_imported_score` writes for a wallet's outside history. Loan principals must be in micro-USD. */
export function importSummary(loans: Loan[], now: number): ImportSummary {
    let sPlus = 0n;
    let sMinus = 0n;
    let meaningfulOnTime = 0;
    let meaningfulWeightBps = 0n;
    for (const l of loans) {
        const [plus, minus] = loanContributionBps(l.principal, l.openedAt, l.closedAt, l.dueAt, l.outcome);
        sPlus += plus;
        sMinus += decayBps(minus, l.closedAt, now); // each penalty fades from the day it happened
        if (l.outcome === 0 && meaningfulLoan(l.principal, l.openedAt, l.closedAt, l.outcome)) {
            meaningfulOnTime += 1;
            meaningfulWeightBps += principalWeightBps(l.principal);
        }
    }
    return { score: nativeComponent(sPlus, sMinus), meaningfulOnTime, meaningfulWeightBps };
}

// ---------- Final score and tier (same as Rust blend / compute_tier) ----------

export const TIER_UNPROVEN = 0, TIER_BRONZE = 1, TIER_SILVER = 2, TIER_GOLD = 3;
export const TIER_NAMES = ["unproven", "bronze", "silver", "gold"] as const;
export const LIQUIDATION_COOLDOWN_SECS = 90 * 86_400;

/** Gates of each tier above Bronze; every one must pass. Bronze only needs a score above 0. */
export const TIER_GATES = {
    [TIER_SILVER]: { minScore: 500, minOnTime: 3, minWeightBps: 30_000n },
    [TIER_GOLD]: { minScore: 750, minOnTime: 8, minWeightBps: 80_000n },
} as const;

/** Share of the native part in bps: α = min(1, exposure ÷ 8.0). */
export function nativeShareBps(exposureBps: bigint): bigint {
    const e = exposureBps < FULL_WEIGHT_BPS ? exposureBps : FULL_WEIGHT_BPS;
    return (e * BPS) / FULL_WEIGHT_BPS;
}

/** Final score: α · native + (1 − α) · imported. */
export function blend(native: bigint, imported: bigint, exposureBps: bigint): bigint {
    const alpha = nativeShareBps(exposureBps);
    return (native * alpha + imported * (BPS - alpha)) / BPS;
}

/** True if no liquidation or default happened in the last 90 days (0 = never). */
export function liquidationClean(lastLiquidationAt: number, now: number): boolean {
    return lastLiquidationAt === 0 || now - lastLiquidationAt >= LIQUIDATION_COOLDOWN_SECS;
}

export function computeTier(
    score: bigint, meaningfulOnTime: number, meaningfulWeightBps: bigint, lastLiquidationAt: number, now: number,
): number {
    if (score === 0n) return TIER_UNPROVEN;
    const clean = liquidationClean(lastLiquidationAt, now);
    for (const tier of [TIER_GOLD, TIER_SILVER] as const) {
        const g = TIER_GATES[tier];
        if (clean && score >= BigInt(g.minScore) && meaningfulOnTime >= g.minOnTime && meaningfulWeightBps >= g.minWeightBps) {
            return tier;
        }
    }
    return TIER_BRONZE;
}
