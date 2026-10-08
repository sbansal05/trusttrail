import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { FEED_IDS } from "./accounts";
import { PRICE_SHARE_MS, priceRouter, sharedPrices, type PriceDeps } from "./priceRoutes";

function fakeHermes(opts: { fail?: boolean } = {}) {
    let now = 0, calls = 0;
    const deps: PriceDeps = {
        nowMs: () => now,
        async fetch(feedId) {
            calls++;
            if (opts.fail) throw new Error("401 unauthorized");
            return { data: `${feedId.toString("hex").slice(0, 4)}#${calls}`, price: calls };
        },
    };
    return { deps, calls: () => calls, later: (ms: number) => { now += ms; } };
}

test("price: one Hermes answer per feed is shared for 2 s, then fetched again", async () => {
    const h = fakeHermes();
    const latest = sharedPrices(h.deps);
    const first = await latest("SOL_USD");
    h.later(PRICE_SHARE_MS - 1);
    assert.deepEqual(await latest("SOL_USD"), first);
    assert.equal(h.calls(), 1);

    await latest("USDC_USD");
    assert.equal(h.calls(), 2, "each feed has its own answer");

    h.later(1);
    assert.notDeepEqual(await latest("SOL_USD"), first);
    assert.equal(h.calls(), 3);
});

test("price: requests arriving together wait on one call; a failure is not kept", async () => {
    const ok = fakeHermes();
    const latest = sharedPrices(ok.deps);
    const [a, b] = await Promise.all([latest("SOL_USD"), latest("SOL_USD")]);
    assert.deepEqual(a, b);
    assert.equal(ok.calls(), 1);

    const bad = fakeHermes({ fail: true });
    const failing = sharedPrices(bad.deps);
    await assert.rejects(failing("SOL_USD"));
    await assert.rejects(failing("SOL_USD"));
    assert.equal(bad.calls(), 2, "the next request tries Hermes again");
});

test("GET /price-update/:feed: 200 with the update, 400 for an unknown feed, 502 when Hermes fails", async () => {
    async function call(deps: PriceDeps, feed: string) {
        const server = express().use(priceRouter(deps)).listen(0);
        try {
            const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/price-update/${feed}`);
            return { status: res.status, body: await res.json() };
        } finally {
            server.close();
        }
    }
    const ok = await call(fakeHermes().deps, "SOL_USD");
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { feed: "SOL_USD", data: `${FEED_IDS.SOL_USD.toString("hex").slice(0, 4)}#1`, price: 1 });

    for (const feed of ["BTC_USD", "constructor"]) {
        const bad = await call(fakeHermes().deps, feed);
        assert.equal(bad.status, 400);
        assert.deepEqual(bad.body.feeds, ["SOL_USD", "USDC_USD"]);
    }

    const down = await call(fakeHermes({ fail: true }).deps, "USDC_USD");
    assert.equal(down.status, 502);
});