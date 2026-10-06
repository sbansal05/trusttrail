//! What every protocol adapter shares: walking a transaction's instructions (top-level and inner),
//! reading token accounts' mints, and building a wallet's full event list.

import bs58 from "bs58";
import type { CreditEvent, Protocol } from "../types";
import type { TransactionList } from "../../heliusClient";

export type Tx = TransactionList[number];

/** One instruction with its accounts already turned into addresses. */
export type Ix = { program: string; accounts: string[]; data: Buffer };

/** A protocol adapter: turns one transaction into this wallet's CreditEvents. */
export type Adapter = {
    protocol: Protocol;
    events(wallet: string, tx: Tx): CreditEvent[];
};

/** Static keys first, then the ones loaded from address lookup tables (the order indexes use). */
export function accountKeys(tx: Tx): string[] {
    const meta = (tx as any).meta;
    const message = (tx.transaction as any).message;
    return [
        ...message.accountKeys,
        ...(meta?.loadedAddresses?.writable ?? []),
        ...(meta?.loadedAddresses?.readonly ?? []),
    ];
}

/** Every instruction in execution order: each top-level one, then the inner ones it made. */
export function instructions(tx: Tx): Ix[] {
    const meta = (tx as any).meta;
    const message = (tx.transaction as any).message;
    const keys = accountKeys(tx);
    const inner = new Map<number, any[]>();
    for (const group of meta?.innerInstructions ?? []) inner.set(group.index, group.instructions);
    const toIx = (raw: any): Ix => ({
        program: keys[raw.programIdIndex],
        accounts: (raw.accounts as number[]).map((i) => keys[i]),
        data: Buffer.from(bs58.decode(raw.data)),
    });
    const out: Ix[] = [];
    (message.instructions as any[]).forEach((raw, i) => {
        out.push(toIx(raw));
        for (const r of inner.get(i) ?? []) out.push(toIx(r));
    });
    return out;
}

/**
 * Mint and decimals of the first of these token accounts that the transaction's token balances list.
 * A token account created and closed inside the same transaction (a temporary wSOL account) is never
 * listed, so callers pass the user's account first and the protocol's vault as the fallback.
 */
export function tokenAccountMint(tx: Tx, ...tokenAccounts: string[]): { mint: string; decimals: number } | null {
    const meta = (tx as any).meta;
    const keys = accountKeys(tx);
    const balances = [...(meta?.preTokenBalances ?? []), ...(meta?.postTokenBalances ?? [])];
    for (const account of tokenAccounts) {
        const hit = balances.find((b: any) => keys[b.accountIndex] === account);
        if (hit) return { mint: hit.mint, decimals: hit.uiTokenAmount.decimals };
    }
    return null;
}

/** Decimals of a mint from the transaction's token balances (6, USDC-style, if not listed). */
export function mintDecimals(tx: Tx, mint: string): number {
    const meta = (tx as any).meta;
    const balances = [...(meta?.preTokenBalances ?? []), ...(meta?.postTokenBalances ?? [])];
    const hit = balances.find((b: any) => b.mint === mint);
    return hit ? hit.uiTokenAmount.decimals : 6;
}

export const succeeded = (tx: Tx) => (tx as any).meta?.err == null;
export const signatureOf = (tx: Tx): string => (tx.transaction as any).signatures[0];
export const timeOf = (tx: Tx): number => tx.blockTime ?? 0;

/** A "repay everything" amount: bigger than any debt, so buildLoans closes the loan. */
export const REPAY_ALL = 2n ** 64n - 1n;

/** The same event can appear in the wallet's history and in its position's history. */
export function dedupe(events: CreditEvent[]): CreditEvent[] {
    const seen = new Set<string>();
    return events.filter((e) => {
        const key = `${e.signature}:${e.protocol}:${e.kind}:${e.position}:${e.mint}:${e.amount}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * All of a wallet's events from all adapters. Borrows and repays come from the wallet's own transactions;
 * liquidations are signed by the liquidator, so each position's own history is read for them too.
 */
export async function walletEvents(
    wallet: string,
    adapters: Adapter[],
    history: (address: string) => Promise<TransactionList>,
): Promise<CreditEvent[]> {
    const decode = (txs: TransactionList) =>
        txs.filter(succeeded).flatMap((tx) => adapters.flatMap((a) => a.events(wallet, tx)));

    const events = decode(await history(wallet));
    const positions = new Set(events.map((e) => e.position));
    for (const position of positions) {
        const liquidations = decode(await history(position)).filter((e) => e.kind === "liquidation" && e.position === position);
        events.push(...liquidations);
    }
    return dedupe(events);
}
