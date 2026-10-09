//! GET /price-update/:feed   (SOL_USD | USDC_USD)   -> { feed, data, price }
//! `data` is a signed Hermes update; the frontend posts it in the same flow as its borrow or liquidate.
//! The Hermes key stays here. One Hermes answer per feed is shared for a couple of seconds, so a burst of
//! users costs one API call, not one each.

import { Router } from "express";
import { FEED_IDS } from "./accounts";

export const PRICE_SHARE_MS = 2_000;

export type PriceUpdate = { data: string; price: number };
export type FeedName = keyof typeof FEED_IDS;

export interface PriceDeps {
    fetch: (feedId: Buffer) => Promise<PriceUpdate>;
    nowMs: () => number;
}

const FEEDS = Object.keys(FEED_IDS) as FeedName[];
const isFeed = (v: string): v is FeedName => (FEEDS as string[]).includes(v);

/** At most one Hermes call per feed in flight; an answer is reused until it is PRICE_SHARE_MS old. Failures are not kept. */
export function sharedPrices({ fetch, nowMs }: PriceDeps): (feed: FeedName) => Promise<PriceUpdate> {
    const cache = new Map<FeedName, { at: number; update: Promise<PriceUpdate> }>();
    return (feed) => {
        const hit = cache.get(feed);
        if (hit && nowMs() - hit.at < PRICE_SHARE_MS) return hit.update;
        const entry = { at: nowMs(), update: fetch(FEED_IDS[feed]) };
        cache.set(feed, entry);
        entry.update.catch(() => {
            if (cache.get(feed) === entry) cache.delete(feed);
        });
        return entry.update;
    };
}

export function priceRouter(deps: PriceDeps): Router {
    const latest = sharedPrices(deps);
    const r = Router();
    r.get("/price-update/:feed", async (req, res) => {
        const { feed } = req.params;
        if (!isFeed(feed)) return res.status(400).json({ error: "unknown feed", feeds: FEEDS });
        try {
            const { data, price } = await latest(feed);
            res.json({ feed, data, price });
        } catch (err) {
            console.error("price update failed:", err);
            res.status(502).json({ error: "price update failed" });
        }
    });
    return r;
}