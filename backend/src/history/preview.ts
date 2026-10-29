//! Read-only import preview: what an import would give a wallet, without writing anything on-chain.
//! Each fresh read is one `import_previews` row, kept for 2 days. The rows are the cache (newest 'done' row of a
//! wallet within the cache hours) and the rate limits (every row of an IP in the last hour, every row in the last
//! 24 hours). A row is reserved as 'pending' before the history is read, so reads still running and failed reads
//! count too: Helius credits are spent either way.

import type { Pool } from "pg";
import { withoutSameTransaction } from "./buildLoans";
import { ImportError } from "./importService";
import { priceLoans, type PriceSources } from "./prices";
import { importSummary } from "./scoring";
import { publicLoan, type PublicLoan } from "./store";
import type { Loan } from "./types";

export const PREVIEW_SCHEMA = `
CREATE TABLE IF NOT EXISTS import_previews (
    id           BIGSERIAL PRIMARY KEY,
    wallet       TEXT   NOT NULL,
    requester_ip TEXT   NOT NULL,
    status       TEXT   NOT NULL CHECK (status IN ('pending', 'done', 'failed')),
    result       JSONB,
    created_at   BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS import_previews_wallet_idx ON import_previews (wallet, created_at);
CREATE INDEX IF NOT EXISTS import_previews_ip_idx ON import_previews (requester_ip, created_at);
`;

export async function migratePreview(pool: Pool): Promise<void> {
    await pool.query(PREVIEW_SCHEMA);
}

const HOUR = 3600;
const DAY = 24 * HOUR;
/** Rows older than this are deleted on each new read; longer than both limit windows. */
export const PREVIEW_KEEP_SECS = 2 * DAY;

export type PreviewLimits = { cacheHours: number; perIpPerHour: number; perDay: number };
export const PREVIEW_DEFAULTS: PreviewLimits = { cacheHours: 6, perIpPerHour: 5, perDay: 50 };

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
    const v = env[name];
    if (v === undefined || v === "") return fallback;
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) return n;
    console.warn(`${name}="${v}" is not a positive integer, using ${fallback}`);
    return fallback;
}

/** Read once at startup; a missing or invalid value falls back to its default. */
export function previewLimits(env: NodeJS.ProcessEnv = process.env): PreviewLimits {
    return {
        cacheHours: positiveInt(env, "IMPORT_PREVIEW_CACHE_HOURS", PREVIEW_DEFAULTS.cacheHours),
        perIpPerHour: positiveInt(env, "IMPORT_PREVIEW_PER_IP_PER_HOUR", PREVIEW_DEFAULTS.perIpPerHour),
        perDay: positiveInt(env, "IMPORT_PREVIEW_PER_DAY", PREVIEW_DEFAULTS.perDay),
    };
}

export type PreviewDeps = {
    pool: Pool;
    prices: PriceSources;
    history: (wallet: string) => Promise<{ loans: Loan[]; capped: boolean }>;
    checkedProtocols: string[];
    limits: PreviewLimits;
    now: () => number; // unix seconds
};

export type ImportPreview = {
    wallet: string;
    computedAt: number;
    cached: boolean;
    checkedProtocols: string[];
    score: number;
    meaningfulOnTime: number;
    meaningfulWeightBps: string;
    counts: { loans: number; priced: number; unpriced: number; unpricedLiquidations: number; sameTransaction: number };
    historyCapped: boolean;
    loans: PublicLoan[];
};

/** Builds the preview from the wallet's history: scored like a first import, over the whole history. */
async function readPreview(deps: PreviewDeps, wallet: string): Promise<ImportPreview> {
    const { loans, capped } = await deps.history(wallet);
    const { kept, sameTransaction } = withoutSameTransaction(loans);
    const { priced, dropped } = await priceLoans(kept, deps.prices);
    const now = deps.now();
    const { score, meaningfulOnTime, meaningfulWeightBps } = importSummary(priced, now);
    const all = [...priced.map((p) => publicLoan(p, p)), ...dropped.map((d) => publicLoan(d, null))];
    all.sort((a, b) => a.closedAt - b.closedAt || a.signatures.open.localeCompare(b.signatures.open));
    return {
        wallet,
        computedAt: now,
        cached: false,
        checkedProtocols: deps.checkedProtocols,
        score: Number(score),
        meaningfulOnTime,
        meaningfulWeightBps: meaningfulWeightBps.toString(),
        counts: {
            loans: kept.length,
            priced: priced.length,
            unpriced: dropped.length,
            unpricedLiquidations: dropped.filter((d) => d.outcome >= 2).length,
            sameTransaction,
        },
        historyCapped: capped,
        loans: all,
    };
}

/** Rows since `since`, and when the oldest of them leaves the window. */
async function countSince(pool: Pool, since: number, window: number, ip?: string): Promise<{ n: number; retryAt: number }> {
    const { rows } = ip === undefined
        ? await pool.query(`SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM import_previews WHERE created_at > $1`, [since])
        : await pool.query(
            `SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM import_previews WHERE requester_ip = $1 AND created_at > $2`,
            [ip, since],
        );
    return { n: Number(rows[0].n), retryAt: Number(rows[0].oldest) + window };
}

/** A cached preview if one is fresh enough; otherwise a new read, within the per-IP and daily limits. */
export async function previewImport(deps: PreviewDeps, wallet: string, ip: string): Promise<ImportPreview> {
    const { pool, limits } = deps;
    const now = deps.now();

    const hit = await pool.query(
        `SELECT result FROM import_previews WHERE wallet = $1 AND status = 'done' AND created_at > $2
         ORDER BY id DESC LIMIT 1`,
        [wallet, now - limits.cacheHours * HOUR],
    );
    if (hit.rows.length > 0) return { ...(hit.rows[0].result as ImportPreview), cached: true };

    // Counted, then reserved below without a lock: requests arriving together can pass the limit by one or two.
    const perIp = await countSince(pool, now - HOUR, HOUR, ip);
    if (perIp.n >= limits.perIpPerHour) {
        throw new ImportError(429, "too many previews from this IP, try again later", { retryAt: perIp.retryAt });
    }
    const perDay = await countSince(pool, now - DAY, DAY);
    if (perDay.n >= limits.perDay) {
        throw new ImportError(429, "the daily preview limit is reached, try again later", { retryAt: perDay.retryAt });
    }

    await pool.query(`DELETE FROM import_previews WHERE created_at < $1`, [now - PREVIEW_KEEP_SECS]);
    const { rows } = await pool.query(
        `INSERT INTO import_previews (wallet, requester_ip, status, created_at) VALUES ($1, $2, 'pending', $3) RETURNING id`,
        [wallet, ip, now],
    );
    const id = String(rows[0].id);

    try {
        const preview = await readPreview(deps, wallet);
        await pool.query(`UPDATE import_previews SET status = 'done', result = $2 WHERE id = $1`, [id, JSON.stringify(preview)]);
        return preview;
    } catch (err) {
        await pool.query(`UPDATE import_previews SET status = 'failed' WHERE id = $1`, [id]);
        console.error("import preview read failed:", err);
        throw new ImportError(502, "the wallet's history could not be read, try again later");
    }
}