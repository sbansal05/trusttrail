import { test } from "node:test";
import assert from "node:assert/strict";
import {
    principalWeightBps, durationBps, loanContributionBps, decayBps, nativeComponent, blend, computeTier, USDC,
    TIER_UNPROVEN, TIER_BRONZE, TIER_SILVER, TIER_GOLD,
} from "./scoring";

const H = 3_600, T0 = 1_800_000_000, D90 = 90 * 86_400;
const usd = (d: number) => BigInt(d) * USDC;

test("weight: table anchors and edges", () => {
    assert.equal(principalWeightBps(usd(150)), 2_026n);
    assert.equal(principalWeightBps(usd(740)), 10_000n);
    assert.equal(principalWeightBps(usd(108_000)), 11_000n);
    assert.equal(principalWeightBps(usd(100) - 1n), 0n);
    assert.equal(principalWeightBps(usd(10)), 0n);
    assert.equal(principalWeightBps(usd(200_000)), 11_000n);
});

test("duration", () => {
    assert.equal(durationBps(T0, T0 + 12 * H), 5_000n);
    assert.equal(durationBps(T0, T0 + 30 * 24 * H), 10_000n);
    assert.equal(durationBps(T0, T0 - 5), 0n);
});

test("contribution (same as Rust k_contribution)", () => {
    const day = T0 + 24 * H, DUE = T0 + 30 * 24 * H;
    assert.deepEqual(loanContributionBps(usd(740), T0, day, DUE, 0), [10_000n, 0n]);
    assert.deepEqual(loanContributionBps(usd(740), T0, T0 + 12 * H, DUE, 0), [5_000n, 0n]);
    assert.deepEqual(loanContributionBps(usd(740), T0, day, DUE, 1), [5_000n, 0n]);
    assert.deepEqual(loanContributionBps(usd(150), T0, day, DUE, 0), [2_026n, 0n]);
    assert.deepEqual(loanContributionBps(usd(740), T0, T0 + H, DUE, 2), [0n, 20_000n]);
    assert.deepEqual(loanContributionBps(usd(740), T0, day, DUE, 3), [0n, 30_000n]);
    assert.deepEqual(loanContributionBps(usd(740), T0, day, 0, 0), [5_000n, 0n]);
    assert.deepEqual(loanContributionBps(usd(740), T0, day, DUE, 9), [0n, 0n]);
});

test("decay (same as Rust l_decay)", () => {
    assert.equal(decayBps(20_000n, T0, T0), 20_000n);
    assert.equal(decayBps(20_000n, T0, T0 + D90), 10_000n);
    assert.equal(decayBps(20_000n, T0, T0 + 2 * D90), 5_000n);
    const half = Number(decayBps(20_000n, T0, T0 + D90 / 2));
    assert.ok(Math.abs(half - 14_142) <= 20, `45 days: ${half}`);
    assert.equal(decayBps(20_000n, T0, T0 - 1_000), 20_000n);
    assert.equal(decayBps(20_000n, T0, T0 + 64 * D90), 0n);
});

test("native component (same as Rust b_native_component)", () => {
    const loan = 10_000n;
    assert.equal(nativeComponent(0n, 0n), 0n);
    assert.equal(nativeComponent(8n * loan, 0n), 1000n);
    assert.equal(nativeComponent(4n * loan, 0n), 500n);
    assert.equal(nativeComponent(20n * loan, 2n * loan), 750n);
    assert.equal(nativeComponent(20n * loan, decayBps(2n * loan, T0, T0 + D90)), 875n);
    assert.equal(nativeComponent(1n * loan, 3n * loan), 0n);
});
import { importSummary, meaningfulLoan } from "./scoring";
import type { Loan } from "./types";

const DAY = 86_400;
const histLoan = (principal: bigint, openedAt: number, days: number, outcome: 0 | 2): Loan => ({
    protocol: "kamino", wallet: "w", position: "p", mint: "m", decimals: 6, principal,
    openedAt, closedAt: openedAt + days * DAY, dueAt: 0, outcome,
    peakAt: openedAt, openSignature: "o", peakSignature: "p", endSignature: "e",
});

test("meaningful: $100+, 24h+, repaid", () => {
    assert.equal(meaningfulLoan(usd(100), T0, T0 + DAY, 0), true);
    assert.equal(meaningfulLoan(usd(99), T0, T0 + DAY, 0), false);
    assert.equal(meaningfulLoan(usd(500), T0, T0 + DAY - 1, 0), false);
    assert.equal(meaningfulLoan(usd(500), T0, T0 + 10 * DAY, 2), false);
});

test("importSummary: three median Kamino loans", () => {
    const loans = [0, 1, 2].map((i) => histLoan(usd(740), T0 + i * 10 * DAY, 5, 0));
    const s = importSummary(loans, T0 + 60 * DAY);
    // no due date → each adds 0.5 to S⁺ → 1.5 of 8.0 → 187
    assert.equal(s.score, 187n);
    assert.equal(s.meaningfulOnTime, 3);
    assert.equal(s.meaningfulWeightBps, 30_000n);
});

test("importSummary: a liquidation subtracts, and fades with time", () => {
    const good = [0, 1, 2, 3].map((i) => histLoan(usd(740), T0 + i * 10 * DAY, 5, 0)); // S⁺ = 2.0
    const liq = histLoan(usd(740), T0 + 50 * DAY, 3, 2);                             // S⁻ = 2.0
    const fresh = importSummary([...good, liq], T0 + 53 * DAY);
    const later = importSummary([...good, liq], T0 + 53 * DAY + 180 * DAY);
    assert.equal(fresh.score, 0n);       // 2.0 − 2.0
    assert.equal(later.score, 187n);     // penalty quartered after 180 days: 2.0 − 0.5 = 1.5
    assert.equal(fresh.meaningfulOnTime, 4);
});

test("blend (same as Rust c_blend)", () => {
    const loan = 10_000n;
    assert.equal(blend(0n, 600n, 0n), 600n);
    assert.equal(blend(1000n, 600n, 4n * loan), 800n);
    assert.equal(blend(1000n, 600n, 8n * loan), 1000n);
    assert.equal(blend(1000n, 600n, 50n * loan), 1000n);
    assert.equal(blend(0n, 900n, 8n * loan), 0n);
    assert.equal(blend(0n, 800n, 1n * loan), 700n);
    assert.equal(blend(0n, 0n, 0n), 0n);
    assert.equal(blend(1000n, 1000n, 2n ** 64n - 1n), 1000n);
});

test("tiers (same as Rust d_tiers)", () => {
    const now = T0;
    const w = (d: number) => principalWeightBps(usd(d));
    assert.equal(computeTier(0n, 0, 0n, 0, now), TIER_UNPROVEN);
    assert.equal(computeTier(400n, 10, 100_000n, 0, now), TIER_BRONZE);
    assert.equal(computeTier(600n, 2, 50_000n, 0, now), TIER_BRONZE);
    assert.equal(computeTier(600n, 3, 29_999n, 0, now), TIER_BRONZE);
    assert.equal(computeTier(600n, 3, 30_000n, 0, now), TIER_SILVER);
    assert.equal(computeTier(600n, 3, 3n * w(101), 0, now), TIER_BRONZE);
    assert.equal(computeTier(600n, 6, 6n * w(300), 0, now), TIER_SILVER);
    assert.equal(computeTier(600n, 3, 3n * w(740), 0, now), TIER_SILVER);
    assert.equal(computeTier(800n, 8, 79_999n, 0, now), TIER_SILVER);
    assert.equal(computeTier(800n, 8, 80_000n, 0, now), TIER_GOLD);
    assert.equal(computeTier(800n, 5, 200_000n, 0, now), TIER_SILVER);
    assert.equal(computeTier(900n, 20, 200_000n, now - 10 * 86_400, now), TIER_BRONZE);
    assert.equal(computeTier(900n, 20, 200_000n, now - D90, now), TIER_GOLD);
});
