import { test } from "node:test";
import assert from "node:assert/strict";
import {
    WAD, YEAR_SECS, accrue, baseRateBps, collateralValue, debtNow, growIndex, lenderApyBps, maxLoan, minCollateral,
    tierRatesBps, utilizationBps, type PoolState,
} from "./state";

const U = 1_000_000n;

const pool = (o: Partial<PoolState> = {}): PoolState => ({
    usdcMint: null as never, vault: null as never, totalBorrowed: 0n, protocolFees: 0n, lastAccrual: 0,
    tierIndex: [WAD, WAD, WAD, WAD], tierScaledDebt: [0n, 0n, 0n, 0n], tierSpreadBps: [400n, 200n, 0n, -150n],
    reserveFactorBps: 1_000n, badDebt: 0n, ...o,
});

test("rates (same as Rust rates.rs): utilization and the two-line base curve", () => {
    assert.deepEqual([utilizationBps(0n, 0n), utilizationBps(80n, 20n), utilizationBps(100n, 0n)], [0n, 8_000n, 10_000n]);
    assert.deepEqual([0n, 5_000n, 9_500n, 9_750n, 10_000n, 12_000n].map(baseRateBps), [200n, 384n, 550n, 2_075n, 3_600n, 3_600n]);
    assert.equal(growIndex(WAD, 1_000n, YEAR_SECS), (WAD * 11n) / 10n);
});

test("tier rates (same as Rust state.rs): Gold 4% at the kink, a 2% floor on an empty pool", () => {
    assert.deepEqual(tierRatesBps(pool({ totalBorrowed: 950n * U }), 50n * U), [950n, 750n, 550n, 400n]);
    assert.deepEqual(tierRatesBps(pool(), 100n * U), [600n, 400n, 200n, 50n]);
});

test("accrue (same as Rust state.rs): a Silver loan at the kink for a year", () => {
    const p = accrue(pool({ tierScaledDebt: [0n, 0n, 950n * U, 0n], totalBorrowed: 950n * U }), Number(YEAR_SECS), 50n * U);
    assert.equal(p.totalBorrowed, 1_002_250_000n);
    assert.equal(p.protocolFees, 5_225_000n);
    assert.equal(accrue(p, Number(YEAR_SECS), 50n * U), p, "no time, no change");
});

test("lender APY: borrower interest on what is lent, less the protocol's 10%, over what lenders own", () => {
    // 950 lent at 5.5% (Silver at the kink), 50 idle: 52.25 a year × 90% ÷ 1,000 = 4.70%
    assert.equal(lenderApyBps(pool({ tierScaledDebt: [0n, 0n, 950n * U, 0n], totalBorrowed: 950n * U }), 50n * U), 470n);
    assert.equal(lenderApyBps(pool(), 0n), 0n);
});

test("terms (same as Rust terms.rs): debt rounds up, the loan limit grows with repaid loans", () => {
    assert.equal(debtNow(100n * U, WAD), 100n * U);
    assert.equal(debtNow(1n, WAD + 1n), 2n);
    assert.deepEqual([maxLoan(0, 0n), maxLoan(2, 0n), maxLoan(2, 300n * U), maxLoan(3, 10_000n * U)], [100n * U, 100n * U, 600n * U, 5_000n * U]);
});

test("collateral: 1.385 SOL at $115.52 is just under $160, and the minimum for 100 tUSDC at 150% is just enough", () => {
    const price = 11_552_000_000n, expo = -8; // $115.52
    assert.equal(collateralValue(1_385_037_350n, 9, price, expo), 159_999_514n);
    const min = minCollateral(100n * U, 15_000n, 9, price, expo);
    assert.ok(collateralValue(min, 9, price, expo) >= 150n * U);
    assert.ok(collateralValue(min - 1n, 9, price, expo) < 150n * U);
    // a 6-decimal token at $0.9998: 150 tUSDC of value needs a little over 150 tUSDC
    assert.equal(minCollateral(100n * U, 15_000n, 6, 99_980_000n, -8), 150_030_007n);
});