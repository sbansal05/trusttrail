//! The pool's on-chain accounts read back, and the same rate, debt and limit math the program runs
//! (programs/pool: rates.rs, terms.rs, state.rs)

import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export const BPS = 10_000n;
export const WAD = 10n ** 18n;
export const YEAR_SECS = 365n * 86_400n;
const TIERS = 4;

export const BASE_RATE_BPS = 200n;
export const KINK_RATE_BPS = 550n;
export const MAX_RATE_BPS = 3_600n;
export const KINK_UTIL_BPS = 9_500n;
export const TIER_COLLATERAL_BPS = [15_000n, 14_000n, 13_000n, 12_000n];
export const TIER_MAX_LOAN = [100_000_000n, 250_000_000n, 1_000_000_000n, 5_000_000_000n];
export const MIN_LOAN_CAP = 100_000_000n;
export const DEFAULT_GRACE_SECS = 3 * 86_400;

export const accountDiscriminator = (name: string) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
export const LOAN_DISCRIMINATOR = accountDiscriminator("Loan");

const u128 = (d: Buffer, at: number) => d.readBigUInt64LE(at) | (d.readBigUInt64LE(at + 8) << 64n);
const key = (d: Buffer, at: number) => new PublicKey(d.subarray(at, at + 32));
const quad = <T>(f: (i: number) => T) => Array.from({ length: TIERS }, (_, i) => f(i));


export type PoolState = {
    usdcMint: PublicKey;
    vault: PublicKey;
    totalBorrowed: bigint;
    protocolFees: bigint;
    lastAccrual: number;
    tierIndex: bigint[];
    tierScaledDebt: bigint[];
    tierSpreadBps: bigint[];
    reserveFactorBps: bigint;
    badDebt: bigint;
};

export function parsePool(d: Buffer): PoolState {
    return {
        usdcMint: key(d, 40),
        vault: key(d, 72),
        totalBorrowed: d.readBigUInt64LE(136),
        protocolFees: d.readBigUInt64LE(144),
        lastAccrual: Number(d.readBigInt64LE(152)),
        tierIndex: quad((i) => u128(d, 160 + 16 * i)),
        tierScaledDebt: quad((i) => u128(d, 224 + 16 * i)),
        tierSpreadBps: quad((i) => BigInt(d.readInt16LE(288 + 2 * i))),
        reserveFactorBps: BigInt(d.readUInt16LE(296)),
        badDebt: d.readBigUInt64LE(298),
    };
}

export type CollateralState = {
    mint: PublicKey;
    feedId: Buffer;
    minTier: number;
    maxAgeSecs: number;
    decimals: number;
    liqThresholdBps: number;
    liqBonusBps: number;
};

export function parseCollateral(d: Buffer): CollateralState {
    return {
        mint: key(d, 8),
        feedId: Buffer.from(d.subarray(72, 104)),
        minTier: d[104],
        maxAgeSecs: d.readUInt32LE(105),
        decimals: d[109],
        liqThresholdBps: d.readUInt16LE(110),
        liqBonusBps: d.readUInt16LE(112),
    };
}

export type LoanState = {
    borrower: PublicKey;
    loanId: bigint;
    tierAtOpen: number;
    principal: bigint;
    scaledDebt: bigint;
    collateralMint: PublicKey;
    collateralAmount: bigint;
    collateralRatioBps: number;
    openedAt: number;
    dueAt: number;
    status: number;
};

export const LOAN_BORROWER_OFFSET = 8;
export const LOAN_STATUS_OFFSET = 147;
export const LOAN_OPEN = 0;
export const LOAN_REPAID = 1;
export const LOAN_LIQUIDATED = 2;
export const LOAN_DEFAULTED = 3;

export function parseLoan(d: Buffer): LoanState {
    return {
        borrower: key(d, 8),
        loanId: d.readBigUInt64LE(40),
        tierAtOpen: d[48],
        principal: d.readBigUInt64LE(49),
        scaledDebt: u128(d, 73),
        collateralMint: key(d, 89),
        collateralAmount: d.readBigUInt64LE(121),
        collateralRatioBps: d.readUInt16LE(129),
        openedAt: Number(d.readBigInt64LE(131)),
        dueAt: Number(d.readBigInt64LE(139)),
        status: d[LOAN_STATUS_OFFSET],
    };
}


/** borrowed ÷ (borrowed + idle), in bps; an empty pool is 0%. */
export function utilizationBps(borrowed: bigint, idle: bigint): bigint {
    const total = borrowed + idle;
    return total === 0n ? 0n : (borrowed * BPS) / total;
}


/** New borrows stop at 90% utilization, so a tenth of the pool stays free for withdrawals (the program's MAX_BORROW_UTIL_BPS). */
export const MAX_BORROW_UTIL_BPS = 9_000n;

/** The most the pool will still lend: up to 90% utilization, never below zero (the program's within_borrow_cap). */
export function borrowRoom(borrowed: bigint, idle: bigint): bigint {
    const room = (MAX_BORROW_UTIL_BPS * (borrowed + idle)) / BPS - borrowed;
    return room > 0n ? room : 0n;
}

/** Two straight lines that meet at the kink: 2% at 0%, 5.5% at 95%, 36% at 100%. */
export function baseRateBps(util: bigint): bigint {
    const u = util < BPS ? util : BPS;
    if (u <= KINK_UTIL_BPS) return BASE_RATE_BPS + (u * (KINK_RATE_BPS - BASE_RATE_BPS)) / KINK_UTIL_BPS;
    return KINK_RATE_BPS + ((u - KINK_UTIL_BPS) * (MAX_RATE_BPS - KINK_RATE_BPS)) / (BPS - KINK_UTIL_BPS);
}

export const tierRateBps = (base: bigint, spread: bigint) => (base + spread > 0n ? base + spread : 0n);

export function tierRatesBps(pool: PoolState, idle: bigint): bigint[] {
    const base = baseRateBps(utilizationBps(pool.totalBorrowed, idle));
    return pool.tierSpreadBps.map((s) => tierRateBps(base, s));
}

export const growIndex = (index: bigint, rateBps: bigint, dt: bigint) => index + (index * rateBps * dt) / (BPS * YEAR_SECS);

/** The pool as the next instruction will see it: every tier's index grown to `now`, debt and fees re-priced. */
export function accrue(pool: PoolState, now: number, idle: bigint): PoolState {
    const dt = BigInt(now - pool.lastAccrual);
    if (dt <= 0n) return pool;
    const rates = tierRatesBps(pool, idle);
    const tierIndex = pool.tierIndex.map((ix, t) => growIndex(ix, rates[t], dt));
    const totalBorrowed = tierIndex.reduce((sum, ix, t) => sum + (pool.tierScaledDebt[t] * ix) / WAD, 0n);
    const interest = totalBorrowed > pool.totalBorrowed ? totalBorrowed - pool.totalBorrowed : 0n;
    return {
        ...pool,
        tierIndex,
        totalBorrowed,
        protocolFees: pool.protocolFees + (interest * pool.reserveFactorBps) / BPS,
        lastAccrual: now,
    };
}
/** What lenders own: idle USDC plus what borrowers owe, minus the protocol's fees (the program's total_assets). */
export const totalAssets = (pool: PoolState, idle: bigint) => idle + pool.totalBorrowed - pool.protocolFees;

/** What lenders earn per year, in bps of what they own: borrower interest minus the protocol's cut. */
export function lenderApyBps(pool: PoolState, idle: bigint): bigint {
    const assets = totalAssets(pool, idle);
    if (assets <= 0n) return 0n;
    const rates = tierRatesBps(pool, idle);
    const yearly = pool.tierScaledDebt.reduce((sum, s, t) => sum + ((s * pool.tierIndex[t]) / WAD) * rates[t], 0n);
    return (yearly * (BPS - pool.reserveFactorBps)) / BPS / assets;
}


/** USDC owed now for `scaled` index units, rounded up (the program's debt_now). */
export const debtNow = (scaled: bigint, index: bigint) => (scaled * index + WAD - 1n) / WAD;

/** Biggest loan a wallet may take: the tier's maximum, and at most twice its largest on-time repay (at least 100 USDC). */
export function maxLoan(tier: number, largestRepaid: bigint): bigint {
    const growth = largestRepaid * 2n > MIN_LOAN_CAP ? largestRepaid * 2n : MIN_LOAN_CAP;
    return TIER_MAX_LOAN[tier] < growth ? TIER_MAX_LOAN[tier] : growth;
}

/** Value in micro-USDC of `amount` base units at `price × 10^expo` USD (the program's collateral_value). */
export function collateralValue(amount: bigint, decimals: number, price: bigint, expo: number): bigint {
    const shift = 6 + expo - decimals;
    const raw = amount * price;
    return shift >= 0 ? raw * 10n ** BigInt(shift) : raw / 10n ** BigInt(-shift);
}

/** Smallest collateral (base units) worth `ratioBps` of `loan` at `price × 10^expo`, rounded up. */
export function minCollateral(loan: bigint, ratioBps: bigint, decimals: number, price: bigint, expo: number): bigint {
    const shift = 6 + expo - decimals;
    const needed = (loan * ratioBps + BPS - 1n) / BPS; // micro-USDC of value
    // value = amount × price × 10^shift  →  amount = needed ÷ (price × 10^shift), rounded up
    if (shift >= 0) {
        const per = price * 10n ** BigInt(shift);
        return (needed + per - 1n) / per;
    }
    const scaled = needed * 10n ** BigInt(-shift);
    return (scaled + price - 1n) / price;
}


// ---------- lender shares (programs/pool math.rs) ----------

/** LP shares minted for depositing `amount`: 1 : 1 into an empty pool, else amount × supply ÷ assets, rounded down. */
export function sharesForDeposit(amount: bigint, assets: bigint, supply: bigint): bigint {
    return supply === 0n || assets === 0n ? amount : (amount * supply) / assets;
}

/** USDC paid out for burning `shares`: shares × assets ÷ supply, rounded down; nothing when no shares exist. */
export function assetsForShares(shares: bigint, assets: bigint, supply: bigint): bigint {
    return supply === 0n ? 0n : (shares * assets) / supply;
}

/** Shares to burn for a withdraw of about `amount`, rounded down, so the payout is never more than asked. */
export function sharesForWithdraw(amount: bigint, assets: bigint, supply: bigint): bigint {
    return assets === 0n ? 0n : (amount * supply) / assets;
}