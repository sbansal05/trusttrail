//! Live USDC lending rates, to calibrate the pool's rate curve and tier spreads.
//! Kamino Main Market (API + the reserve's on-chain rate curve), Jupiter Lend (API), DefiLlama as a fallback.
try {
    process.loadEnvFile();
} catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
import { writeFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
// Only the account decoder; the SDK root pulls in many optional dependencies.
import { Reserve } from "@kamino-finance/klend-sdk/dist/@codegen/klend/accounts/Reserve";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const KAMINO_MAIN_MARKET = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
/** Used only if the Kamino API does not say which reserve holds USDC. */
const KAMINO_USDC_RESERVE_FALLBACK = "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59";

const report: Record<string, unknown> = { fetchedAt: new Date().toISOString() };

async function getJson(url: string): Promise<any> {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
    return res.json();
}

/** Runs one source; a failure is printed and saved, and the other sources still run. */
async function section(name: string, fn: () => Promise<unknown>) {
    console.log(`\n=== ${name} ===`);
    try {
        report[name] = await fn();
    } catch (err) {
        console.log(`FAILED: ${(err as Error).message}`);
        report[name] = { error: (err as Error).message };
    }
}

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
const isUsdc = (v: unknown) => v === USDC_MINT || v === "USDC";

/** Kamino's public API: current borrow and supply APY of the USDC reserve. */
async function kaminoMetrics() {
    const rows = await getJson(`https://api.kamino.finance/kamino-market/${KAMINO_MAIN_MARKET}/reserves/metrics?env=mainnet-beta`);
    if (!Array.isArray(rows)) throw new Error(`unexpected shape: ${JSON.stringify(rows).slice(0, 300)}`);
    // A market can hold more than one USDC reserve; the real one is the biggest.
    const usdcRows = rows
        .filter((r: any) => isUsdc(r.liquidityTokenMint) || isUsdc(r.liquidityToken))
        .sort((a: any, b: any) => Number(b.totalSupplyUsd) - Number(a.totalSupplyUsd));
    console.log(`${usdcRows.length} USDC reserve(s) in the Main Market; using the biggest`);
    const usdc = usdcRows[0];    if (!usdc) throw new Error(`no USDC row; keys of the first row: ${Object.keys(rows[0] ?? {}).join(", ")}`);
    const borrow = Number(usdc.totalBorrow ?? usdc.totalBorrowUsd);
    const supply = Number(usdc.totalSupply ?? usdc.totalSupplyUsd);
    const out = {
        reserve: usdc.reserve,
        borrowApy: Number(usdc.borrowApy),
        supplyApy: Number(usdc.supplyApy),
        utilization: supply > 0 ? borrow / supply : null,
        totalBorrowUsd: Number(usdc.totalBorrowUsd),
        totalSupplyUsd: Number(usdc.totalSupplyUsd),
    };
    console.table([{ ...out, borrowApy: pct(out.borrowApy), supplyApy: pct(out.supplyApy), utilization: out.utilization === null ? "?" : pct(out.utilization) }]);
    return out;
}

/** Kamino's USDC reserve on-chain: its full borrow-rate curve and current utilization. */
async function kaminoCurve() {
    const key = process.env.HELIUS_API;
    const rpc = key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : "https://api.mainnet-beta.solana.com";
    const metrics = report["Kamino API (Main Market USDC)"] as { reserve?: string } | undefined;
    const address = metrics?.reserve ?? KAMINO_USDC_RESERVE_FALLBACK;
    const info = await new Connection(rpc, "confirmed").getAccountInfo(new PublicKey(address));
    if (!info) throw new Error(`reserve ${address} not found`);
    const reserve = Reserve.decode(Buffer.from(info.data));
    if (reserve.liquidity.mintPubkey.toString() !== USDC_MINT) throw new Error(`reserve ${address} is not USDC`);

    // The curve has 11 slots; unused ones repeat the last point.
    const points = reserve.config.borrowRateCurve.points
        .map((p) => ({ utilizationBps: p.utilizationRateBps, borrowRateBps: p.borrowRateBps }))
        .filter((p, i, all) => i === 0 || p.utilizationBps !== all[i - 1].utilizationBps);
    // Amounts: borrowedAmountSf is a fixed-point number with 60 fraction bits.
    const borrowed = Number(BigInt(reserve.liquidity.borrowedAmountSf.toString()) >> 60n);
    const available = Number(reserve.liquidity.totalAvailableAmount.toString());
    const utilization = borrowed / (borrowed + available);
    const out = { reserve: address, utilization, protocolTakeRatePct: reserve.config.protocolTakeRatePct, points };
    console.log(`reserve ${address}: utilization ${pct(utilization)}, protocol take rate ${out.protocolTakeRatePct}%`);
    console.table(points.map((p) => ({ utilization: `${p.utilizationBps / 100}%`, borrowAPR: `${p.borrowRateBps / 100}%` })));
    return out;
}

/** Jupiter Lend borrow vaults whose borrowed token is USDC (one vault per collateral). */
async function jupiterVaults() {
    let vaults: any;
    try {
        vaults = await getJson("https://api.jup.ag/lend/v1/borrow/vaults");
    } catch {
        vaults = await getJson("https://lite-api.jup.ag/lend/v1/borrow/vaults");
    }
    const list: any[] = Array.isArray(vaults) ? vaults : vaults.vaults ?? vaults.data ?? [];
    if (list.length === 0) throw new Error(`unexpected shape: ${JSON.stringify(vaults).slice(0, 300)}`);
    const usdc = list.filter((v) => isUsdc(v.borrowToken?.address) || isUsdc(v.borrowToken?.symbol));
    if (usdc.length === 0) throw new Error(`no USDC-borrow vault; keys of the first vault: ${Object.keys(list[0]).join(", ")}`);
    const out = usdc.map((v) => ({
        collateral: v.supplyToken?.symbol,
        borrowRate: v.borrowRate,
        supplyRate: v.supplyRate,
        borrowLimitUtilization: v.borrowLimitUtilization,
    }));
    console.log("(rates exactly as the API returns them; units are checked from these numbers)");
    console.table(out);
    return out;
}

/** DefiLlama: supply and borrow APY for USDC on Kamino Lend and Jupiter Lend. */
async function defiLlama() {
    const [pools, lendBorrow] = await Promise.all([
        getJson("https://yields.llama.fi/pools"),
        getJson("https://yields.llama.fi/lendBorrow"),
    ]);
    const borrowById = new Map((lendBorrow as any[]).map((b) => [b.pool, b]));
    const rows = (pools.data as any[])
        .filter((p) => ["kamino-lend", "jupiter-lend"].includes(p.project) && p.chain === "Solana" && p.symbol === "USDC")
        .map((p) => {
            const b: any = borrowById.get(p.pool) ?? {};
            const supplyUsd = Number(b.totalSupplyUsd ?? 0), borrowUsd = Number(b.totalBorrowUsd ?? 0);
            return {
                project: p.project,
                market: p.poolMeta ?? "",
                supplyApy: p.apyBase,
                borrowApy: b.apyBaseBorrow ?? null,
                utilization: supplyUsd > 0 ? borrowUsd / supplyUsd : null,
                supplyUsd,
            };
        })
        .sort((a, b) => b.supplyUsd - a.supplyUsd);
    if (rows.length === 0) throw new Error("no Kamino or Jupiter Lend USDC pools in the response");
    console.table(rows.map((r) => ({ ...r, utilization: r.utilization === null ? "?" : pct(r.utilization), supplyUsd: Math.round(r.supplyUsd).toLocaleString() })));
    return rows;
}

async function main() {
    await section("Kamino API (Main Market USDC)", kaminoMetrics);
    await section("Kamino on-chain curve (Main Market USDC)", kaminoCurve);
    await section("Jupiter Lend (USDC borrow vaults)", jupiterVaults);
    await section("DefiLlama (USDC, Kamino + Jupiter Lend)", defiLlama);
    const file = `rates-${new Date().toISOString().slice(0, 10)}.json`;
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`\nsaved ${file}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});