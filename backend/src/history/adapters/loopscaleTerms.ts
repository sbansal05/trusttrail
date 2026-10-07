//! Loopscale due dates. A ledger's term starts at the borrow that opens it and starts again at every
//! refinance_ledger (rollovers); both carry a duration index. A further borrow into an open ledger keeps
//! its due date. The due date in force at a repay or a liquidation is the latest term start before it +
//! that term. Refinances are signed by Loopscale, not the borrower, so they come from each loan's own history.

import type { CreditEvent } from "../types";
import type { TransactionList } from "../../heliusClient";
import { discriminator } from "../importTx";
import { instructions, succeeded, timeOf, type Tx } from "./common";
import { LOOPSCALE_PROGRAM_ID } from "./loopscale";

const DAY = 86_400;

/**
 * Duration index → term in seconds. Only indexes checked against the Loopscale API on real open loans
 * are listed; a loan with any other index gets no due date (it counts like a floating-rate loan).
 */
export const TERM_SECS_BY_INDEX: Record<number, number> = {
    0: DAY, // checked on 10 open loans of 7 wallets, 6 of them rolled over (7 Oct 2026)
};

/** Loopscale's Duration { duration, duration_type }: 0 days, 1 weeks, 2 months of 30 days. */
export function durationSecs(duration: number, durationType: number): number | null {
    const unit = [DAY, 7 * DAY, 30 * DAY].at(durationType);
    return unit === undefined ? null : duration * unit;
}

const BORROW = discriminator("borrow_principal");
const REFINANCE = discriminator("refinance_ledger");
const BORROWER = 2, BORROW_LOAN = 3, BORROW_MINT = 6;
const REFINANCE_LOAN = 2, REFINANCE_MINT = 9;

export type TermStart = { loan: string; mint: string; at: number; index: number; signature: string; kind: "borrow" | "refinance" };

/**
 * borrow_principal(amount u64, asset_index_guidance bytes, duration u8, …): the index follows the
 * u32-length-prefixed guidance. refinance_ledger(ledger_index u8, duration_index u8, …).
 */
export function termStarts(wallet: string, txs: TransactionList): TermStart[] {
    const out: TermStart[] = [];
    for (const tx of txs) {
        if (!succeeded(tx)) continue;
        const signature = (tx.transaction as any).signatures[0];
        for (const ix of instructions(tx as Tx)) {
            if (ix.program !== LOOPSCALE_PROGRAM_ID || ix.data.length < 10) continue;
            const d = ix.data.subarray(0, 8);
            if (d.equals(BORROW) && ix.accounts[BORROWER] === wallet && ix.data.length >= 21) {
                const at = 20 + ix.data.readUInt32LE(16);
                if (at >= ix.data.length) continue;
                out.push({ loan: ix.accounts[BORROW_LOAN], mint: ix.accounts[BORROW_MINT], at: timeOf(tx), index: ix.data[at], signature, kind: "borrow" });
            } else if (d.equals(REFINANCE)) {
                out.push({ loan: ix.accounts[REFINANCE_LOAN], mint: ix.accounts[REFINANCE_MINT], at: timeOf(tx), index: ix.data[9], signature, kind: "refinance" });
            }
        }
    }
    return out;
}

/**
 * The starts that really start a term: every refinance, and a borrow only when its ledger had no debt
 * (the borrow that opens it). Debt is followed through the wallet's own borrow, repay and liquidation events.
 */
export function effectiveStarts(events: CreditEvent[], starts: TermStart[]): TermStart[] {
    const borrowAt = new Map(starts.filter((s) => s.kind === "borrow").map((s) => [`${s.signature}:${s.loan}:${s.mint}`, s]));
    const ledgerEvents = events.filter((e) => e.protocol === "loopscale").sort((a, b) => a.timestamp - b.timestamp);
    const debt = new Map<string, bigint>();
    const out = starts.filter((s) => s.kind === "refinance");
    for (const e of ledgerEvents) {
        const key = `${e.position}:${e.mint}`;
        const d = debt.get(key) ?? 0n;
        if (e.kind === "borrow") {
            const s = borrowAt.get(`${e.signature}:${e.position}:${e.mint}`);
            if (s && d <= 0n) out.push(s);
            debt.set(key, d + e.amount);
        } else if (e.kind === "repay") {
            debt.set(key, e.amount >= d ? 0n : d - e.amount);
        } else {
            debt.set(key, 0n);
        }
    }
    return out;
}

/** The latest term start of this loan and mint at or before `at`. */
export function latestStart(starts: TermStart[], loan: string, mint: string, at: number): TermStart | undefined {
    let latest: TermStart | undefined;
    for (const s of starts) {
        if (s.loan !== loan || s.mint !== mint || s.at > at) continue;
        if (!latest || s.at >= latest.at) latest = s;
    }
    return latest;
}

/** Sets dueAt on every Loopscale event from the term in force at that moment (0 when unknown). */
export function withLoopscaleDueDates(
    events: CreditEvent[], starts: TermStart[], terms: Record<number, number> = TERM_SECS_BY_INDEX,
): CreditEvent[] {
    const real = effectiveStarts(events, starts);
    return events.map((e) => {
        if (e.protocol !== "loopscale") return e;
        const latest = latestStart(real, e.position, e.mint, e.timestamp);
        const term = latest ? terms[latest.index] : undefined;
        return { ...e, dueAt: latest && term !== undefined ? latest.at + term : 0 };
    });
}

/** Reads the wallet's and each Loopscale loan's history, then dates the wallet's Loopscale events. */
export async function loopscaleDueDates(
    wallet: string, events: CreditEvent[], history: (address: string) => Promise<TransactionList>,
): Promise<CreditEvent[]> {
    const loans = [...new Set(events.filter((e) => e.protocol === "loopscale").map((e) => e.position))];
    if (loans.length === 0) return events;
    const txs = [...(await history(wallet))];
    for (const loan of loans) txs.push(...(await history(loan)));
    return withLoopscaleDueDates(events, termStarts(wallet, txs));
}
