//! Test-USDC faucet: 1,000 tUSDC to a wallet, once per wallet per 24 h. The faucet key is the tUSDC mint
//! authority and pays the fees (and the wallet's token account, if it has none yet).
//! The claim is reserved in Postgres before anything is sent, so two requests at once cannot both mint.

import type { Connection, Keypair } from "@solana/web3.js";
import { PublicKey, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Pool } from "pg";

export const FAUCET_AMOUNT = 1_000n * 10n ** 6n;
export const FAUCET_COOLDOWN_SECS = 24 * 3600;

export const FAUCET_SCHEMA = `
CREATE TABLE IF NOT EXISTS faucet_claims (
    wallet     TEXT PRIMARY KEY,
    claimed_at BIGINT NOT NULL,
    signature  TEXT
);
`;

export async function migrateFaucet(pool: Pool): Promise<void> {
    await pool.query(FAUCET_SCHEMA);
}

export type FaucetDeps = {
    pool: Pool;
    connection: Pick<Connection, "getLatestBlockhash" | "sendRawTransaction" | "confirmTransaction">;
    faucet: Keypair;
    mint: PublicKey;
    now: () => number; // unix seconds
};

export class FaucetError extends Error {
    constructor(public status: number, message: string, public details: Record<string, unknown> = {}) {
        super(message);
    }
}

export type Claim = { signature: string; amount: string; nextClaimAt: number };

export async function claim(deps: FaucetDeps, walletAddress: string): Promise<Claim> {
    const wallet = new PublicKey(walletAddress);
    const now = deps.now();
    const prev = await deps.pool.query(`SELECT claimed_at FROM faucet_claims WHERE wallet = $1`, [walletAddress]);
    const prevAt: number | null = prev.rows.length ? Number(prev.rows[0].claimed_at) : null;
    if (prevAt !== null && now - prevAt < FAUCET_COOLDOWN_SECS) {
        throw new FaucetError(429, "already claimed in the last 24 hours", { nextClaimAt: prevAt + FAUCET_COOLDOWN_SECS });
    }

    // Reserve the claim: only succeeds if the row is unchanged since the read above.
    const reserved = prevAt === null
        ? await deps.pool.query(
            `INSERT INTO faucet_claims (wallet, claimed_at) VALUES ($1, $2) ON CONFLICT (wallet) DO NOTHING RETURNING wallet`,
            [walletAddress, now],
        )
        : await deps.pool.query(
            `UPDATE faucet_claims SET claimed_at = $2, signature = NULL WHERE wallet = $1 AND claimed_at = $3 RETURNING wallet`,
            [walletAddress, now, prevAt],
        );
    if (reserved.rows.length === 0) throw new FaucetError(429, "a claim for this wallet is already in progress");

    try {
        const ata = getAssociatedTokenAddressSync(deps.mint, wallet);
        const { blockhash, lastValidBlockHeight } = await deps.connection.getLatestBlockhash("confirmed");
        const tx = new Transaction({ feePayer: deps.faucet.publicKey, blockhash, lastValidBlockHeight }).add(
            createAssociatedTokenAccountIdempotentInstruction(deps.faucet.publicKey, ata, wallet, deps.mint),
            createMintToInstruction(deps.mint, ata, deps.faucet.publicKey, FAUCET_AMOUNT),
        );
        tx.sign(deps.faucet);
        const signature = await deps.connection.sendRawTransaction(tx.serialize());
        const result = await deps.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        if (result.value.err) throw new Error(`faucet transaction failed: ${JSON.stringify(result.value.err)}`);
        await deps.pool.query(`UPDATE faucet_claims SET signature = $2 WHERE wallet = $1`, [walletAddress, signature]);
        return { signature, amount: FAUCET_AMOUNT.toString(), nextClaimAt: now + FAUCET_COOLDOWN_SECS };
    } catch (err) {
        // Nothing was minted: give the claim back.
        if (prevAt === null) await deps.pool.query(`DELETE FROM faucet_claims WHERE wallet = $1`, [walletAddress]);
        else await deps.pool.query(`UPDATE faucet_claims SET claimed_at = $2 WHERE wallet = $1`, [walletAddress, prevAt]);
        throw new FaucetError(502, "the faucet transaction did not go through", { reason: (err as Error).message });
    }
}
