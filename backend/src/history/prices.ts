//! USD price of a loan at its peak moment 
//! Binance first, Birdeye as fallback. Direct prices, not candles 
//! No maximum gap: the nearest price we can get is used, and its gap is recorded 
//! If Binance's price is more than 24 h from the peak (e.g. the loan is older than the Binance listing),
//! Birdeye is asked too and the price with the smaller gap wins 

import type { Loan } from "./types";

/** Pyth-style fixed point: value = price × 10^expo. 12 decimals so tiny prices like BONK keep their digits. */
export const PRICE_EXPO = -12;
const PRICE_DECIMALS = 12;

/** A Binance price further than this from the peak time sends the loan to Birdeye as well . */
export const MAX_BINANCE_GAP_SECS = 24 * 3600;

export type PriceSource = "binance" | "birdeye";
export type PricePoint = { price: bigint; at: number; source: PriceSource };

/** A loan valued in USD. `principal` is now micro-USD; the token amount is kept in `rawAmount`. */
export type PricedLoan = Loan & {
    rawAmount: bigint;
    price: bigint;          // × 10^PRICE_EXPO USD per whole token
    priceSource: PriceSource;
    priceAt: number;        // time of the price we found
    priceGapSecs: number;   
};

export const BINANCE_SYMBOLS: Record<string, string> = {
    So11111111111111111111111111111111111111112: "SOLUSDT",   
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDCUSDT", 
    JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUPUSDT", 
    DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "BONKUSDT", 
    jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: "JTOUSDT",   
};

/** Where prices come from. Real ones call the APIs; tests pass fakes. */
export type PriceSources = {
    binance(symbol: string, at: number): Promise<PricePoint | null>;
    birdeye(mint: string, at: number): Promise<PricePoint | null>;
};

/** "189.31" → 189.31 × 10^decimals as a bigint. Extra digits are cut, not rounded. No floats anywhere. */
export function decimalToFixed(s: string, decimals = PRICE_DECIMALS): bigint {
    const [whole, frac = ""] = s.split(".");
    return BigInt(whole + frac.padEnd(decimals, "0").slice(0, decimals));
}

/** Token amount (with `decimals`) × price (× 10^expo) → micro-USD (6 decimals). */
export function toMicroUsd(amount: bigint, decimals: number, price: bigint, expo: number): bigint {
    const shift = 6 + expo - decimals;
    const raw = amount * price;
    return shift >= 0 ? raw * 10n ** BigInt(shift) : raw / 10n ** BigInt(-shift);
}

const gap = (p: PricePoint, at: number) => Math.abs(p.at - at);

/** The price closest to `at`, or null if neither source has one  */
export async function priceAt(mint: string, at: number, sources: PriceSources): Promise<PricePoint | null> {
    const symbol = BINANCE_SYMBOLS[mint];
    const binance = symbol ? await sources.binance(symbol, at) : null;
    if (binance && gap(binance, at) <= MAX_BINANCE_GAP_SECS) return binance;

    const birdeye = await sources.birdeye(mint, at);
    if (!birdeye) return binance;           
    if (!binance) return birdeye;
    return gap(birdeye, at) < gap(binance, at) ? birdeye : binance; 
}

/** Price every loan at its peak. Loans with no price at all are dropped, liquidations too . */
export async function priceLoans(loans: Loan[], sources: PriceSources): Promise<{ priced: PricedLoan[]; dropped: Loan[] }> {
    const priced: PricedLoan[] = [];
    const dropped: Loan[] = [];
    for (const l of loans) {
        const p = await priceAt(l.mint, l.peakAt, sources);
        if (!p) {
            dropped.push(l);
            continue;
        }
        priced.push({
            ...l,
            principal: toMicroUsd(l.principal, l.decimals, p.price, PRICE_EXPO),
            rawAmount: l.principal,
            price: p.price,
            priceSource: p.source,
            priceAt: p.at,
            priceGapSecs: gap(p, l.peakAt),
        });
    }
    return { priced, dropped };
}


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Binance: the first trade at or after `at` (keyless public data API). */
export async function binanceTrade(symbol: string, at: number): Promise<PricePoint | null> {
    const url = `https://data-api.binance.vision/api/v3/aggTrades?symbol=${symbol}&startTime=${at * 1000}&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const trades = (await res.json()) as { p: string; T: number }[];
    if (trades.length === 0) return null;
    return { price: decimalToFixed(trades[0].p), at: Math.floor(trades[0].T / 1000), source: "binance" };
}

/** Birdeye historical_price_unix. The free plan allows 1 request a second, so each call waits 1.1 s. */
export function birdeyeSource(apiKey: string) {
    return async (mint: string, at: number): Promise<PricePoint | null> => {
        await sleep(1100);
        const url = `https://public-api.birdeye.so/defi/historical_price_unix?address=${mint}&unixtime=${at}`;
        const res = await fetch(url, { headers: { "X-API-KEY": apiKey, "x-chain": "solana" } });
        if (!res.ok) return null;
        const body = (await res.json()) as { success: boolean; data?: { value: number; updateUnixTime: number } };
        if (!body.success || !body.data || !body.data.value) return null;
        return { price: decimalToFixed(body.data.value.toFixed(PRICE_DECIMALS)), at: body.data.updateUnixTime, source: "birdeye" };
    };
}

export function liveSources(): PriceSources {
    const key = process.env.BIRDEYE_API_KEY;
    if (!key) throw new Error("BIRDEYE_API_KEY is not set");
    return { binance: binanceTrade, birdeye: birdeyeSource(key) };
}