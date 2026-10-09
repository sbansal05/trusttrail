//! A fresh Pyth price in the same flow as the instruction that needs it: the latest signed update from
//! Hermes is posted (fully verified) to a short-lived PriceUpdateV2 account, the instruction reads it,
//! and the account is closed again to get the rent back.

import { Wallet } from "@coral-xyz/anchor";
import type { Connection, Keypair, PublicKey, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

export const HERMES_URL = "https://pyth.dourolabs.app/hermes";

/** Hermes needs an API key (sent as a Bearer token); it stays on the backend. */
function hermesClient(): HermesClient {
    const accessToken = process.env.PYTH_API_KEY;
    if (!accessToken) throw new Error("PYTH_API_KEY is not set");
    return new HermesClient(HERMES_URL, { accessToken });
}

/**
 * The latest signed update for a feed. `price` is a plain number for display; `lowPrice` × 10^expo is
 * price − confidence, the value the pool uses for collateral.
 */
export type HermesUpdate = { data: string; price: number; lowPrice: bigint; expo: number };

export async function latestUpdate(feedId: Buffer): Promise<HermesUpdate> {
    const u = await hermesClient().getLatestPriceUpdates([feedId.toString("hex")], { encoding: "base64", parsed: true });
    const p = u.parsed?.[0]?.price;
    if (!u.binary.data[0] || !p) throw new Error("Hermes returned no update");
    return {
        data: u.binary.data[0],
        price: Number(p.price) * 10 ** p.expo,
        lowPrice: BigInt(p.price) - BigInt(p.conf),
        expo: p.expo,
    };
}

/** A wallet the receiver can build for (it only needs the fee payer's key); the real wallet signs later. */
function payerOnly(payer: PublicKey): Wallet {
    const refuse = async () => {
        throw new Error("transactions are built here and signed by the wallet");
    };
    return { publicKey: payer, signTransaction: refuse, signAllTransactions: refuse } as unknown as Wallet;
}

/**
 * Builds, in send order: post the update, `build(priceUpdateAccount)`'s instructions, close the update account.
 * Each transaction is already signed by the throwaway keys the receiver uses; only `payer`'s signature is missing.
 */
export async function buildWithFreshPrice(
    connection: Connection, payer: PublicKey, feedId: Buffer, updateData: string,
    build: (priceUpdate: PublicKey) => TransactionInstruction[],
): Promise<VersionedTransaction[]> {
    const receiver = new PythSolanaReceiver({ connection, wallet: payerOnly(payer) });
    const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
    await builder.addPostPriceUpdates([updateData]);
    await builder.addPriceConsumerInstructions(async (account) =>
        build(account(`0x${feedId.toString("hex")}`)).map((instruction) => ({ instruction, signers: [] })),
    );
    const built = await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 50_000 });
    return built.map(({ tx, signers }) => {
        if (signers.length > 0) tx.sign(signers);
        return tx;
    });
}

/** Sends signed transactions one after the other, each confirmed before the next. Returns the signatures. */
export async function sendInOrder(connection: Connection, txs: VersionedTransaction[]): Promise<string[]> {
    const sigs: string[] = [];
    for (const tx of txs) {
        const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const signature = await connection.sendRawTransaction(tx.serialize());
        const res = await connection.confirmTransaction(
            { signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight }, "confirmed",
        );
        if (res.value.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(res.value.err)}`);
        sigs.push(signature);
    }
    return sigs;
}

/** Builds with a fresh price, signs with `signer` and sends (admin and demo scripts). */
export async function withFreshPrice(
    connection: Connection, signer: Keypair, feedId: Buffer, updateData: string,
    build: (priceUpdate: PublicKey) => TransactionInstruction[],
): Promise<string[]> {
    const txs = await buildWithFreshPrice(connection, signer.publicKey, feedId, updateData, build);
    for (const tx of txs) tx.sign([signer]);
    return sendInOrder(connection, txs);
}