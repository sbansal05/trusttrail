import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { Keypair } from "@solana/web3.js";
import { migratePreview, previewImport, previewLimits, PREVIEW_DEFAULTS, PREVIEW_KEEP_SECS, type PreviewDeps } from "./preview";
import { ImportError } from "./importService";
import { importPreviewRouter } from "./routes";
import { priceLoans, type PriceSources } from "./prices";
import { importSummary } from "./scoring";
import type { Loan } from "./types";

const HOUR = 3600;
const DAY = 86_400;
const NOW = 1_760_000_000;
const SOL = "So11111111111111111111111111111111111111112";
const UNLISTED = "Unpriced11111111111111111111111111111111111";
const wallet = () => Keypair.generate().publicKey.toBase58();

/** A $500 SOL loan (2.5 SOL at $200), or an unlisted token with no price. */
const loan = (closedAt: number, sig: string, opts: Partial<Loan> = {}): Loan => ({
    protocol: "kamino", wallet: "W", position: "P", mint: SOL, decimals: 9, principal: 2_500_000_000n,
    openedAt: closedAt - 10 * DAY, closedAt, dueAt: 0, outcome: 0,
    peakAt: closedAt - 5 * DAY, openSignature: `${sig}-o`, peakSignature: `${sig}-p`, endSignature: `${sig}-e`,
    ...opts,
});
const HISTORY = [
    loan(NOW - 50 * DAY, "b"),
    loan(NOW - 100 * DAY, "a"),
    loan(NOW - 80 * DAY, "u", { mint: UNLISTED }),
    loan(NOW - 70 * DAY, "l", { mint: UNLISTED, outcome: 2 }),
    loan(NOW - 60 * DAY, "same", { endSignature: "same-o" }),
];
const prices: PriceSources = {
    binance: async (_symbol, at) => ({ price: 200_000_000_000_000n, at, source: "binance" }),
    birdeye: async () => null,
};

async function setup(opts: { limits?: Partial<PreviewDeps["limits"]>; history?: PreviewDeps["history"] } = {}) {
    const { Pool } = newDb().adapters.createPg();
    const pool = new Pool() as Pool;
    await migratePreview(pool);
    const clock = { now: NOW };
    const reads: string[] = [];
    const deps: PreviewDeps = {
        pool,
        prices,
        history: opts.history ?? (async (w) => {
            reads.push(w);
            return { loans: HISTORY, capped: true };
        }),
        checkedProtocols: ["kamino", "marginfi"],
        limits: { ...PREVIEW_DEFAULTS, ...opts.limits },
        now: () => clock.now,
    };
    const rows = async () => (await pool.query(`SELECT wallet, requester_ip, status, created_at FROM import_previews ORDER BY id`)).rows;
    return { deps, clock, reads, rows };
}

const refused = (status: number) => (err: unknown) => err instanceof ImportError && err.status === status;

test("preview limits: defaults when unset, positive integers used, anything else falls back", () => {
    assert.deepEqual(previewLimits({}), { cacheHours: 6, perIpPerHour: 5, perDay: 50 });
    assert.deepEqual(
        previewLimits({ IMPORT_PREVIEW_CACHE_HOURS: "12", IMPORT_PREVIEW_PER_IP_PER_HOUR: "3", IMPORT_PREVIEW_PER_DAY: "100" }),
        { cacheHours: 12, perIpPerHour: 3, perDay: 100 },
    );
    for (const bad of ["0", "-1", "2.5", "abc", " "]) {
        assert.deepEqual(
            previewLimits({ IMPORT_PREVIEW_CACHE_HOURS: bad, IMPORT_PREVIEW_PER_IP_PER_HOUR: bad, IMPORT_PREVIEW_PER_DAY: bad }),
            PREVIEW_DEFAULTS,
        );
    }
});

test("preview: whole history scored like a first import, unpriced loans counted, nothing written on-chain", async () => {
    const { deps, rows } = await setup();
    const w = wallet();
    const p = await previewImport(deps, w, "1.1.1.1");

    const kept = HISTORY.filter((l) => l.openSignature !== l.endSignature);
    const { priced } = await priceLoans(kept, prices);
    const expected = importSummary(priced, NOW);
    assert.equal(p.score, Number(expected.score));
    assert.equal(p.meaningfulOnTime, 2);
    assert.equal(p.meaningfulWeightBps, expected.meaningfulWeightBps.toString());
    assert.deepEqual(p.counts, { loans: 4, priced: 2, unpriced: 2, unpricedLiquidations: 1, sameTransaction: 1 });
    assert.equal(p.historyCapped, true);
    assert.equal(p.cached, false);
    assert.equal(p.computedAt, NOW);
    assert.equal(p.wallet, w);
    assert.deepEqual(p.checkedProtocols, ["kamino", "marginfi"]);

    // Oldest closed first, like a saved import; priced and unpriced side by side.
    assert.deepEqual(p.loans.map((l) => l.signatures.open), ["a-o", "u-o", "l-o", "b-o"]);
    assert.equal(p.loans[0].priced, true);
    assert.equal(p.loans[0].usdMicro, "500000000");
    assert.equal(p.loans[0].rawAmount, "2500000000");
    assert.equal(p.loans[1].priced, false);
    assert.equal(p.loans[1].usdMicro, null);

    assert.deepEqual((await rows()).map((r) => r.status), ["done"]);
});

test("preview cache: a hit within the cache hours is free; after them the history is read again", async () => {
    const { deps, clock, reads, rows } = await setup({ limits: { perIpPerHour: 1 } });
    const w = wallet();
    await previewImport(deps, w, "1.1.1.1");

    clock.now = NOW + 6 * HOUR - 1;
    const hit = await previewImport(deps, w, "2.2.2.2");
    assert.equal(hit.cached, true);
    assert.equal(hit.computedAt, NOW);
    assert.equal(reads.length, 1);
    assert.equal((await rows()).length, 1);

    clock.now = NOW + 6 * HOUR;
    const fresh = await previewImport(deps, w, "2.2.2.2");
    assert.equal(fresh.cached, false);
    assert.equal(fresh.computedAt, NOW + 6 * HOUR);
    assert.equal(reads.length, 2);
});

test("per-IP limit: fresh reads in the last hour; other IPs and cache hits still work", async () => {
    const { deps, clock } = await setup({ limits: { perIpPerHour: 2 } });
    const first = wallet();
    await previewImport(deps, first, "1.1.1.1");
    clock.now = NOW + 60;
    await previewImport(deps, wallet(), "1.1.1.1");

    await assert.rejects(previewImport(deps, wallet(), "1.1.1.1"), (err) => {
        assert.ok(refused(429)(err));
        assert.equal((err as ImportError).details.retryAt, NOW + HOUR);
        return true;
    });
    assert.equal((await previewImport(deps, first, "1.1.1.1")).cached, true);
    assert.equal((await previewImport(deps, wallet(), "2.2.2.2")).cached, false);

    clock.now = NOW + HOUR;
    assert.equal((await previewImport(deps, wallet(), "1.1.1.1")).cached, false);
});

test("daily limit: fresh reads from every IP in the last 24 hours", async () => {
    const { deps, clock } = await setup({ limits: { perDay: 2 } });
    await previewImport(deps, wallet(), "1.1.1.1");
    clock.now = NOW + 10 * HOUR;
    await previewImport(deps, wallet(), "2.2.2.2");

    await assert.rejects(previewImport(deps, wallet(), "3.3.3.3"), (err) => {
        assert.ok(refused(429)(err));
        assert.equal((err as ImportError).details.retryAt, NOW + DAY);
        return true;
    });
    clock.now = NOW + DAY;
    assert.equal((await previewImport(deps, wallet(), "3.3.3.3")).cached, false);
});

test("a failed read is 502, is never served from the cache, and still counts toward the limits", async () => {
    let fail = true;
    const { deps, rows } = await setup({
        limits: { perIpPerHour: 2 },
        history: async () => {
            if (fail) throw new Error("helius down");
            return { loans: HISTORY, capped: false };
        },
    });
    const w = wallet();
    await assert.rejects(previewImport(deps, w, "1.1.1.1"), refused(502));
    assert.deepEqual((await rows()).map((r) => r.status), ["failed"]);

    fail = false;
    const p = await previewImport(deps, w, "1.1.1.1");
    assert.equal(p.cached, false);
    assert.equal(p.historyCapped, false);
    await assert.rejects(previewImport(deps, wallet(), "1.1.1.1"), refused(429));
});

test("a read still running counts toward the limits", async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const reading = new Promise<void>((r) => (started = r));
    const { deps, rows } = await setup({
        limits: { perIpPerHour: 1 },
        history: async () => {
            started();
            await gate;
            return { loans: [], capped: false };
        },
    });
    const running = previewImport(deps, wallet(), "1.1.1.1");
    await reading;
    assert.deepEqual((await rows()).map((r) => r.status), ["pending"]);
    await assert.rejects(previewImport(deps, wallet(), "1.1.1.1"), refused(429));

    release();
    assert.equal((await running).score, 0);
    assert.deepEqual((await rows()).map((r) => r.status), ["done"]);
});

test("rows older than 2 days are deleted when a new read is reserved", async () => {
    const { deps, clock, rows } = await setup();
    await previewImport(deps, wallet(), "1.1.1.1");
    clock.now = NOW + DAY;
    await previewImport(deps, wallet(), "1.1.1.1");

    clock.now = NOW + PREVIEW_KEEP_SECS + 1;
    await previewImport(deps, wallet(), "1.1.1.1");
    assert.deepEqual((await rows()).map((r) => Number(r.created_at)), [NOW + DAY, NOW + PREVIEW_KEEP_SECS + 1]);
});

test("GET /import-preview/:wallet: a bad wallet is 400 and not counted; the caller's IP comes from the proxy", async () => {
    const { deps, rows } = await setup({ limits: { perIpPerHour: 1 } });
    const app = express();
    app.set("trust proxy", 1);
    app.use(importPreviewRouter(deps));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const get = (w: string, ip: string) => fetch(`${base}/import-preview/${w}`, { headers: { "x-forwarded-for": ip } });
    try {
        assert.equal((await get("nope", "1.1.1.1")).status, 400);
        assert.equal((await rows()).length, 0);

        const ok = await get(wallet(), "1.1.1.1");
        assert.equal(ok.status, 200);
        assert.equal((await ok.json()).counts.loans, 4);
        assert.equal((await get(wallet(), "1.1.1.1")).status, 429);
        assert.equal((await get(wallet(), "2.2.2.2")).status, 200);
        assert.deepEqual((await rows()).map((r) => r.requester_ip), ["1.1.1.1", "2.2.2.2"]);
    } finally {
        server.close();
    }
});