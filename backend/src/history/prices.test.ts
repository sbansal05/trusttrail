import { test } from "node:test";
import assert from "node:assert/strict";
import { decimalToFixed as px, toMicroUsd, priceAt, priceLoans, PRICE_EXPO, type PriceSources } from "./prices";
import type { Loan } from "./types";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const JITOSOL = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
const T0 = 1_735_689_600;
const DAY = 86_400;

const loan = (mint: string, principal: bigint, decimals: number, outcome: Loan["outcome"] = 0): Loan => ({
    protocol: "kamino", wallet: "W", position: "P", mint, decimals, principal,
    openedAt: T0 - DAY, closedAt: T0 + DAY, dueAt: 0, outcome,
    peakAt: T0, openSignature: "o", peakSignature: "p", endSignature: "e",
});

/** Fake APIs: Binance knows SOL and USDC; Birdeye knows JitoSOL. */
const fake: PriceSources = {
    async binance(symbol, at) {
        if (symbol === "SOLUSDT") return { price: px("189.31"), at: at + 1, source: "binance" };
        if (symbol === "USDCUSDT") return { price: px("0.9997"), at, source: "binance" };
        return null;
    },
    async birdeye(mint, at) {
        if (mint === JITOSOL) return { price: px("225"), at: at - 3, source: "birdeye" };
        return null;
    },
};

/** Fake BONK prices: Binance answers `binanceGap` seconds late, Birdeye `birdeyeGap` seconds early (null = no price). */
function bonk(binanceGap: number, birdeyeGap: number | null) {
    const calls = { birdeye: 0 };
    const sources: PriceSources = {
        async binance(_symbol, at) {
            return { price: px("0.00000383"), at: at + binanceGap, source: "binance" };
        },
        async birdeye(_mint, at) {
            calls.birdeye++;
            return birdeyeGap === null ? null : { price: px("0.0000005"), at: at - birdeyeGap, source: "birdeye" };
        },
    };
    return { sources, calls };
}

test("decimal strings become 12-decimal fixed point", () => {
    assert.equal(px("189.31000000"), 189_310_000_000_000n);
    assert.equal(px("0.9997"), 999_700_000_000n);
    assert.equal(px("188.8668546531234"), 188_866_854_653_123n); // extra digits cut, not rounded
    assert.equal(px("42"), 42_000_000_000_000n);
    assert.equal(px("0.00000383"), 3_830_000n); // BONK keeps every digit
});

test("toMicroUsd: 2 SOL at $189.31 = $378.62, 1M BONK at $0.00000383 = $3.83", () => {
    assert.equal(toMicroUsd(2_000_000_000n, 9, px("189.31"), PRICE_EXPO), 378_620_000n);
    assert.equal(toMicroUsd(100_000_000_000n, 5, px("0.00000383"), PRICE_EXPO), 3_830_000n);
});

test("Binance first, Birdeye for the rest, no price = dropped", async () => {
    const { priced, dropped } = await priceLoans(
        [loan(SOL, 2_000_000_000n, 9), loan(JITOSOL, 1_000_000_000n, 9), loan("Unknown1111", 5n, 6, 2)],
        fake,
    );
    assert.deepEqual(priced.map((l) => l.priceSource), ["binance", "birdeye"]);
    assert.deepEqual(priced.map((l) => l.principal), [378_620_000n, 225_000_000n]);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].outcome, 2); 
});

test("stablecoins are priced, not assumed to be $1", async () => {
    const { priced } = await priceLoans([loan(USDC, 1_000_000_000n, 6)], fake); // 1,000 USDC
    assert.equal(priced[0].principal, 999_700_000n); // $999.70 at 0.9997
});

test("the raw amount, price and gap are kept for the public history", async () => {
    const { priced } = await priceLoans([loan(SOL, 2_000_000_000n, 9), loan(JITOSOL, 1_000_000_000n, 9)], fake);
    assert.equal(priced[0].rawAmount, 2_000_000_000n);
    assert.equal(priced[0].price, px("189.31"));
    assert.equal(priced[0].priceGapSecs, 1);
    assert.equal(priced[1].priceGapSecs, 3);
});

test("a Binance price within 24 h is used and Birdeye is not called", async () => {
    const { sources, calls } = bonk(DAY, 5);
    const p = await priceAt(BONK, T0, sources);
    assert.equal(p?.source, "binance");
    assert.equal(calls.birdeye, 0);
});

test("a Binance price more than 24 h away asks Birdeye, and the smaller gap wins", async () => {
    const { sources, calls } = bonk(180 * DAY, 60); // loan older than the Binance listing
    const p = await priceAt(BONK, T0, sources);
    assert.equal(p?.source, "birdeye");
    assert.equal(p?.at, T0 - 60);
    assert.equal(calls.birdeye, 1);
});

test("if Birdeye is even further away, the Binance price stays", async () => {
    const { sources } = bonk(2 * DAY, 3 * DAY);
    assert.equal((await priceAt(BONK, T0, sources))?.source, "binance");
});

test("if Birdeye has nothing, the far Binance price is kept and its gap recorded", async () => {
    const { sources } = bonk(180 * DAY, null);
    const { priced, dropped } = await priceLoans([loan(BONK, 100_000_000_000n, 5)], sources);
    assert.equal(dropped.length, 0);
    assert.equal(priced[0].priceSource, "binance");
    assert.equal(priced[0].priceGapSecs, 180 * DAY);
});