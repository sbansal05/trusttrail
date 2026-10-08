import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { FAUCET_AMOUNT, FAUCET_COOLDOWN_SECS, claim, migrateFaucet, type FaucetDeps, FaucetError } from "./faucet";
import { faucetRouter } from "./routes";

const T0 = 1_800_000_000;
const WALLET = Keypair.generate().publicKey.toBase58();

async function setup(opts: { fail?: boolean } = {}) {
    const { Pool } = newDb().adapters.createPg();
    const pool = new Pool() as Pool;
    await migrateFaucet(pool);
    const sent: Transaction[] = [];
    let now = T0;
    const deps: FaucetDeps = {
        pool,
        faucet: Keypair.generate(),
        mint: Keypair.generate().publicKey,
        now: () => now,
        connection: {
            async getLatestBlockhash() { return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 10 }; },
            async sendRawTransaction(raw: Buffer | Uint8Array) {
                if (opts.fail) throw new Error("simulation failed");
                sent.push(Transaction.from(raw));
                return `SIG${sent.length}`;
            },
            async confirmTransaction() { return { context: { slot: 1 }, value: { err: null } }; },
        } as unknown as FaucetDeps["connection"],
    };
    return { deps, sent, later: (s: number) => { now += s; } };
}

test("faucet: mints 1,000 tUSDC into the wallet's token account, created if needed, faucet pays", async () => {
    const { deps, sent } = await setup();
    const c = await claim(deps, WALLET);
    assert.deepEqual(c, { signature: "SIG1", amount: FAUCET_AMOUNT.toString(), nextClaimAt: T0 + FAUCET_COOLDOWN_SECS });
    const tx = sent[0];
    assert.ok(tx.feePayer!.equals(deps.faucet.publicKey));
    assert.equal(tx.instructions.length, 2);
    const ata = getAssociatedTokenAddressSync(deps.mint, new PublicKey(WALLET));
    assert.ok(tx.instructions[1].keys[1].pubkey.equals(ata)); // mintTo: mint, destination, authority
    assert.equal(tx.instructions[1].data.readBigUInt64LE(1), FAUCET_AMOUNT);
});

test("faucet: once per wallet per 24 hours", async () => {
    const { deps, sent, later } = await setup();
    await claim(deps, WALLET);
    later(FAUCET_COOLDOWN_SECS - 1);
    await assert.rejects(claim(deps, WALLET), (e: FaucetError) => e.status === 429 && e.details.nextClaimAt === T0 + FAUCET_COOLDOWN_SECS);
    later(1);
    await claim(deps, WALLET);
    assert.equal(sent.length, 2);
});

test("faucet: a failed transaction gives the claim back", async () => {
    const failing = await setup({ fail: true });
    await assert.rejects(claim(failing.deps, WALLET), (e: FaucetError) => e.status === 502);
    const { rows } = await failing.deps.pool.query(`SELECT * FROM faucet_claims`);
    assert.equal(rows.length, 0);
});

test("POST /faucet: 400 for a bad wallet, 200 then 429 for the same wallet", async () => {
    const { deps } = await setup();
    const app = express();
    app.use(express.json());
    app.use(faucetRouter(deps));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (wallet: unknown) => fetch(`${base}/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet }) });
    try {
        assert.equal((await post("nope")).status, 400);
        assert.equal((await post(WALLET)).status, 200);
        const again = await post(WALLET);
        assert.equal(again.status, 429);
        assert.equal((await again.json()).nextClaimAt, T0 + FAUCET_COOLDOWN_SECS);
    } finally {
        server.close();
    }
});
