import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { migrate, savePending, confirmImport, importHistory } from "./store";
import { importHistoryRouter } from "./routes";
import { planImport } from "./importPlan";
import type { PricedLoan } from "./prices";
import type { Loan } from "./types";

const WALLET = "So11111111111111111111111111111111111111112";
const DAY = 86_400;
const T0 = 1_735_689_600;

const loan = (usd: bigint, closedAt: number, outcome: Loan["outcome"] = 0, sig = "s"): Loan => ({
    protocol: "kamino", wallet: WALLET, position: "P", mint: "M", decimals: 6, principal: usd * 1_000_000n,
    openedAt: closedAt - 10 * DAY, closedAt, dueAt: 0, outcome,
    peakAt: closedAt - 5 * DAY, openSignature: `${sig}-open`, peakSignature: `${sig}-peak`, endSignature: `${sig}-end`,
});
const priced = (l: Loan): PricedLoan => ({
    ...l, rawAmount: l.principal, price: 1_000_000_000_000n, priceSource: "binance", priceAt: l.peakAt + 2, priceGapSecs: 2,
});

/** A fresh in-memory Postgres with the schema applied. */
async function freshPool(): Promise<Pool> {
    const { Pool } = newDb().adapters.createPg();
    const pool = new Pool() as Pool;
    await migrate(pool);
    return pool;
}

const firstPlan = () =>
    planImport([priced(loan(500n, T0, 0, "a")), priced(loan(800n, T0 + DAY, 0, "b"))], [loan(300n, T0 + 2 * DAY, 2, "c")], 0, T0 + 30 * DAY);

test("a pending import is not public", async () => {
    const pool = await freshPool();
    await savePending(pool, WALLET, firstPlan());
    assert.deepEqual(await importHistory(pool, WALLET, true), []);
});

test("a confirmed import is public with every loan, priced and unpriced", async () => {
    const pool = await freshPool();
    const id = await savePending(pool, WALLET, firstPlan());
    assert.equal(await confirmImport(pool, id, "TX1"), true);

    const [imp] = await importHistory(pool, WALLET, true);
    assert.equal(imp.txSignature, "TX1");
    assert.equal(imp.meaningfulOnTime, 2);
    assert.equal(imp.loans.length, 3);

    const [a, , c] = imp.loans;
    assert.equal(a.priced, true);
    assert.equal(a.usdMicro, "500000000");
    assert.equal(a.priceGapSecs, 2);
    assert.deepEqual(a.signatures, { open: "a-open", peak: "a-peak", end: "a-end" });
    assert.equal(c.priced, false);
    assert.equal(c.usdMicro, null);
    assert.equal(c.rawAmount, "300000000");
    assert.equal(c.outcome, 2);
});

test("an import can be confirmed only once", async () => {
    const pool = await freshPool();
    const id = await savePending(pool, WALLET, firstPlan());
    assert.equal(await confirmImport(pool, id, "TX1"), true);
    assert.equal(await confirmImport(pool, id, "TX2"), false);
    assert.equal((await importHistory(pool, WALLET, true))[0].txSignature, "TX1");
});

test("every import is kept: latest by default, all newest first on request", async () => {
    const pool = await freshPool();
    const first = await savePending(pool, WALLET, firstPlan());
    await confirmImport(pool, first, "TX1");
    const second = await savePending(pool, WALLET, planImport([priced(loan(500n, T0))], [], T0 + 30 * DAY, T0 + 50 * DAY));
    await confirmImport(pool, second, "TX2");

    const latest = await importHistory(pool, WALLET, true);
    assert.deepEqual(latest.map((i) => i.txSignature), ["TX2"]);
    assert.equal(latest[0].previousImportDate, T0 + 30 * DAY);
    const all = await importHistory(pool, WALLET, false);
    assert.deepEqual(all.map((i) => i.txSignature), ["TX2", "TX1"]);
});

test("GET /import-history/:wallet: 400 for a bad wallet, 404 with no import, 200 with history", async () => {
    const pool = await freshPool();
    const app = express().use(importHistoryRouter(pool));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
        assert.equal((await fetch(`${base}/import-history/not-a-wallet`)).status, 400);
        assert.equal((await fetch(`${base}/import-history/${WALLET}`)).status, 404);

        const id = await savePending(pool, WALLET, firstPlan());
        await confirmImport(pool, id, "TX1");
        const res = await fetch(`${base}/import-history/${WALLET}`);
        assert.equal(res.status, 200);
        const body = (await res.json()) as { wallet: string; imports: { loans: { usdMicro: string | null }[] }[] };
        assert.equal(body.wallet, WALLET);
        assert.equal(body.imports[0].loans[0].usdMicro, "500000000"); // amounts travel as strings
    } finally {
        server.close();
    }
});