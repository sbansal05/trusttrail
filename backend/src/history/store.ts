//! Postgres storage for the public import history.
//! One `imports` row per import (first or repeat), one `import_loans` row per loan in it.
//! An import is saved as pending when it is planned and becomes confirmed once its transaction lands.
//! Only confirmed imports are public. Every import is kept, so any past on-chain score can be checked.

import type { Pool, PoolClient } from "pg";
import type { ImportPlan } from "./importPlan";
import type { PricedLoan, PriceSource } from "./prices";
import { PRICE_EXPO } from "./prices";
import type { Loan } from "./types";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS imports (
    id                    BIGSERIAL PRIMARY KEY,
    wallet                TEXT        NOT NULL,
    status                TEXT        NOT NULL CHECK (status IN ('pending', 'confirmed')),
    score                 INTEGER     NOT NULL,
    meaningful_on_time    INTEGER     NOT NULL,
    meaningful_weight_bps NUMERIC(39) NOT NULL,
    previous_import_date  BIGINT      NOT NULL,
    computed_at           BIGINT      NOT NULL,
    new_loans             INTEGER     NOT NULL,
    tx_message            TEXT,
    last_valid_height     BIGINT,
    tx_signature          TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at          TIMESTAMPTZ
);
ALTER TABLE imports ADD COLUMN IF NOT EXISTS tx_message TEXT;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS last_valid_height BIGINT;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS checked_protocols TEXT;
CREATE INDEX IF NOT EXISTS imports_wallet_idx ON imports (wallet, id);

CREATE TABLE IF NOT EXISTS import_loans (
    import_id      BIGINT      NOT NULL REFERENCES imports (id) ON DELETE CASCADE,
    protocol       TEXT        NOT NULL,
    position       TEXT        NOT NULL,
    mint           TEXT        NOT NULL,
    decimals       INTEGER     NOT NULL,
    raw_amount     NUMERIC(39) NOT NULL,
    usd_micro      NUMERIC(39),
    price          NUMERIC(39),
    price_source   TEXT,
    price_at       BIGINT,
    price_gap_secs BIGINT,
    opened_at      BIGINT      NOT NULL,
    closed_at      BIGINT      NOT NULL,
    due_at         BIGINT      NOT NULL,
    outcome        SMALLINT    NOT NULL,
    peak_at        BIGINT      NOT NULL,
    open_signature TEXT        NOT NULL,
    peak_signature TEXT        NOT NULL,
    end_signature  TEXT        NOT NULL
);
CREATE INDEX IF NOT EXISTS import_loans_import_idx ON import_loans (import_id);
`;

export async function migrate(pool: Pool): Promise<void> {
    await pool.query(SCHEMA);
}

/** Runs `fn` inside BEGIN / COMMIT, rolling back on any error. */
async function inTransaction<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
        await c.query("BEGIN");
        const out = await fn(c);
        await c.query("COMMIT");
        return out;
    } catch (err) {
        await c.query("ROLLBACK");
        throw err;
    } finally {
        c.release();
    }
}

const LOAN_COLUMNS = [
    "import_id", "protocol", "position", "mint", "decimals", "raw_amount", "usd_micro", "price", "price_source",
    "price_at", "price_gap_secs", "opened_at", "closed_at", "due_at", "outcome", "peak_at",
    "open_signature", "peak_signature", "end_signature",
];
const INSERT_LOAN = `INSERT INTO import_loans (${LOAN_COLUMNS.join(", ")})
    VALUES (${LOAN_COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})`;

/** Column values for one loan. A loan without a price has null price columns. Bigints go in as strings. */
function loanValues(importId: string, l: Loan, p: PricedLoan | null): unknown[] {
    return [
        importId, l.protocol, l.position, l.mint, l.decimals,
        (p ? p.rawAmount : l.principal).toString(),
        p ? p.principal.toString() : null,
        p ? p.price.toString() : null,
        p ? p.priceSource : null,
        p ? p.priceAt : null,
        p ? p.priceGapSecs : null,
        l.openedAt, l.closedAt, l.dueAt, l.outcome, l.peakAt,
        l.openSignature, l.peakSignature, l.endSignature,
    ];
}

/**
 * Saves a planned import as pending and returns its id. Older pending imports of the same wallet are deleted,
 * since their transactions have expired or been replaced.
 */
export async function savePending(
    pool: Pool, wallet: string, plan: ImportPlan, tx: PendingTx, checkedProtocols: string[],
): Promise<string> {
    return inTransaction(pool, async (c) => {
        await c.query(`DELETE FROM imports WHERE wallet = $1 AND status = 'pending'`, [wallet]);
        const { rows } = await c.query(
            `INSERT INTO imports (wallet, status, score, meaningful_on_time, meaningful_weight_bps,
                                  previous_import_date, computed_at, new_loans, tx_message, last_valid_height,
                                  checked_protocols)
             VALUES ($1, 'pending', $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [wallet, Number(plan.score), plan.meaningfulOnTime, plan.meaningfulWeightBps.toString(),
             plan.previousImportDate, plan.computedAt, plan.newLoans, tx.message, tx.lastValidBlockHeight,
             checkedProtocols.join(",")],
        );
        const id = String(rows[0].id);
        for (const p of plan.priced) await c.query(INSERT_LOAN, loanValues(id, p, p));
        for (const d of plan.dropped) await c.query(INSERT_LOAN, loanValues(id, d, null));
        return id;
    });
}

/** The transaction the wallet must sign unchanged: its base64 message and the last block height it is valid for. */
export type PendingTx = { message: string; lastValidBlockHeight: number };

/** The transaction of a pending import, or null if there is no such pending import. */
export async function pendingTx(pool: Pool, importId: string): Promise<PendingTx | null> {
    const { rows } = await pool.query(
        `SELECT tx_message, last_valid_height FROM imports WHERE id = $1 AND status = 'pending'`,
        [importId],
    );
    if (rows.length === 0) return null;
    return { message: rows[0].tx_message, lastValidBlockHeight: Number(rows[0].last_valid_height) };
}

/** Marks a pending import confirmed with its on-chain transaction. Returns false if it was not pending. */
export async function confirmImport(pool: Pool, importId: string, txSignature: string): Promise<boolean> {
    const { rowCount } = await pool.query(
        `UPDATE imports SET status = 'confirmed', tx_signature = $2, confirmed_at = now()
         WHERE id = $1 AND status = 'pending'`,
        [importId, txSignature],
    );
    return rowCount === 1;
}

// ---------- Public view ----------

export type PublicLoan = {
    protocol: string;
    position: string;
    mint: string;
    decimals: number;
    rawAmount: string;
    priced: boolean;
    usdMicro: string | null;
    price: string | null;
    priceExpo: number;
    priceSource: PriceSource | null;
    priceAt: number | null;
    priceGapSecs: number | null;
    openedAt: number;
    closedAt: number;
    dueAt: number;
    outcome: number;
    peakAt: number;
    signatures: { open: string; peak: string; end: string };
};

export type PublicImport = {
    id: string;
    txSignature: string;
    confirmedAt: string;
    score: number;
    meaningfulOnTime: number;
    meaningfulWeightBps: string;
    previousImportDate: number;
    computedAt: number;
    newLoans: number;
    checkedProtocols: string[];
    loans: PublicLoan[];
};

/** Imports saved before the checked list was stored were made by the Kamino-only scanner. */
export const LEGACY_CHECKED_PROTOCOLS = ["kamino"];

function checkedOf(v: string | null): string[] {
    return v === null ? LEGACY_CHECKED_PROTOCOLS : v.split(",").filter((p) => p !== "");
}

const num = (v: string | number | null) => (v === null ? null : Number(v));
const str = (v: string | number | null) => (v === null ? null : String(v));

function toPublicLoan(r: Record<string, any>): PublicLoan {
    return {
        protocol: r.protocol,
        position: r.position,
        mint: r.mint,
        decimals: r.decimals,
        rawAmount: String(r.raw_amount),
        priced: r.price !== null,
        usdMicro: str(r.usd_micro),
        price: str(r.price),
        priceExpo: PRICE_EXPO,
        priceSource: r.price_source,
        priceAt: num(r.price_at),
        priceGapSecs: num(r.price_gap_secs),
        openedAt: Number(r.opened_at),
        closedAt: Number(r.closed_at),
        dueAt: Number(r.due_at),
        outcome: Number(r.outcome),
        peakAt: Number(r.peak_at),
        signatures: { open: r.open_signature, peak: r.peak_signature, end: r.end_signature },
    };
}

/** Confirmed imports of a wallet, newest first, each with its loans. `latestOnly` keeps just the newest. */
export async function importHistory(pool: Pool, wallet: string, latestOnly: boolean): Promise<PublicImport[]> {
    const { rows } = await pool.query(
        `SELECT * FROM imports WHERE wallet = $1 AND status = 'confirmed' ORDER BY id DESC
         ${latestOnly ? "LIMIT 1" : ""}`,
        [wallet],
    );
    const out: PublicImport[] = [];
    for (const r of rows) {
        const loans = await pool.query(
            `SELECT * FROM import_loans WHERE import_id = $1 ORDER BY closed_at, open_signature`,
            [r.id],
        );
        out.push({
            id: String(r.id),
            txSignature: r.tx_signature,
            confirmedAt: new Date(r.confirmed_at).toISOString(),
            score: Number(r.score),
            meaningfulOnTime: Number(r.meaningful_on_time),
            meaningfulWeightBps: String(r.meaningful_weight_bps),
            previousImportDate: Number(r.previous_import_date),
            computedAt: Number(r.computed_at),
            newLoans: Number(r.new_loans),
            checkedProtocols: checkedOf(r.checked_protocols),
            loans: loans.rows.map(toPublicLoan),
        });
    }
    return out;
}
