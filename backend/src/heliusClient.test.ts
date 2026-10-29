import { test } from "node:test";
import assert from "node:assert/strict";
import { pageThrough, MAX_AGE_DAYS, MAX_PAGES } from "./heliusClient";

const NOW = 1_800_000_000;
const DAY = 86_400;
const tx = (ageDays: number) => ({ blockTime: NOW - ageDays * DAY });

/** Serves `pages` in order; each page but the last carries a token. */
function pager(pages: { blockTime: number | null }[][], lastToken: string | null = null) {
    const tokens: (string | undefined)[] = [];
    const fetchPage = async (token: string | undefined) => {
        tokens.push(token);
        const i = tokens.length - 1;
        return { data: pages[i] ?? [], paginationToken: i < pages.length - 1 ? `t${i + 1}` : lastToken };
    };
    return { fetchPage, tokens };
}

test("pageThrough follows tokens until the last page and is not capped", async () => {
    const { fetchPage, tokens } = pager([[tx(1), tx(2)], [tx(3)], [tx(4)]]);
    const h = await pageThrough(fetchPage, NOW);
    assert.equal(h.transactions.length, 4);
    assert.equal(h.capped, false);
    assert.deepEqual(tokens, [undefined, "t1", "t2"]);
});

test("pageThrough stops at an empty page", async () => {
    const { fetchPage, tokens } = pager([[tx(1)], []], "more");
    const h = await pageThrough(fetchPage, NOW);
    assert.equal(h.transactions.length, 1);
    assert.equal(h.capped, false);
    assert.equal(tokens.length, 2);
});

test("pageThrough stops past MAX_AGE_DAYS without calling it capped", async () => {
    const { fetchPage, tokens } = pager([[tx(1)], [tx(MAX_AGE_DAYS + 1)], [tx(MAX_AGE_DAYS + 2)]]);
    const h = await pageThrough(fetchPage, NOW);
    assert.equal(h.transactions.length, 2);
    assert.equal(h.capped, false);
    assert.equal(tokens.length, 2);
});

test("pageThrough is capped when MAX_PAGES are read and a token is left", async () => {
    const pages = Array.from({ length: MAX_PAGES + 5 }, (_, i) => [tx(i / 100)]);
    const { fetchPage, tokens } = pager(pages);
    const h = await pageThrough(fetchPage, NOW);
    assert.equal(tokens.length, MAX_PAGES);
    assert.equal(h.transactions.length, MAX_PAGES);
    assert.equal(h.capped, true);
});

test("pageThrough is not capped when the last allowed page has no token", async () => {
    const pages = Array.from({ length: MAX_PAGES }, (_, i) => [tx(i / 100)]);
    const { fetchPage } = pager(pages);
    const h = await pageThrough(fetchPage, NOW);
    assert.equal(h.transactions.length, MAX_PAGES);
    assert.equal(h.capped, false);
});

test("pageThrough keeps going when a transaction has no block time", async () => {
    const { fetchPage } = pager([[{ blockTime: null }], [tx(1)]]);
    const h = await pageThrough(fetchPage, NOW);
    assert.equal(h.transactions.length, 2);
    assert.equal(h.capped, false);
});