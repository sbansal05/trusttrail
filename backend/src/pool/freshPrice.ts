//! A fresh Pyth price in the same flow as the instruction that needs it: the latest signed update from
//! Hermes is posted (fully verified) to a short-lived PriceUpdateV2 account, the instruction reads it,
//! and the account is closed again to get the rent back.

import { Wallet } from "@coral-xyz/anchor";
import type { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { HermesClient } from "@pythnetwork/hermes-client";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";

export const HERMES_URL = "https://hermes.pyth.network";

/** The latest update for a feed, plus its price as a number (for sizing collateral). */
export async function latestUpdate(feedId: Buffer): Promise<{ data: string; price: number }> {
    const hermes = new HermesClient(HERMES_URL);
    const u = await hermes.getLatestPriceUpdates([feedId.toString("hex")], { encoding: "base64", parsed: true });
    const p = u.parsed?.[0]?.price;
    if (!u.binary.data[0] || !p) throw new Error("Hermes returned no update");
    return { data: u.binary.data[0], price: Number(p.price) * 10 ** p.expo };
}

/** Posts the update, runs `build(priceUpdateAccount)`'s instructions, closes the update account. Returns the signatures. */
export async function withFreshPrice(
    connection: Connection, signer: Keypair, feedId: Buffer, updateData: string,
    build: (priceUpdate: PublicKey) => TransactionInstruction[],
): Promise<string[]> {
    const receiver = new PythSolanaReceiver({ connection, wallet: new Wallet(signer) });
    const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
    await builder.addPostPriceUpdates([updateData]);
    await builder.addPriceConsumerInstructions(async (account) =>
        build(account(`0x${feedId.toString("hex")}`)).map((instruction) => ({ instruction, signers: [] })),
    );
    const txs = await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 50_000 });
    return receiver.provider.sendAll(txs, { commitment: "confirmed" });
}
