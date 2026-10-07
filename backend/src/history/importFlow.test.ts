import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, Transaction } from "@solana/web3.js";
import { importMessage, verifyImportRequest } from "./auth";
import { TRUSTTRAIL_PROGRAM_ID, reputationPda, whitelistPda } from "./chain";
import { discriminator, setImportedScoreIx } from "./importTx";
import { IMPORT_COOLDOWN_SECS, ImportError, prepareImport, submitImport, type ImportDeps } from "./importService";
import { importRouter } from "./routes";
import { importHistory, migrate } from "./store";
import { planImport } from "./importPlan";
import type { PriceSources } from "./prices";
import type { Loan } from "./types";

const DAY = 86_400;
const NOW = 1_760_000_000;
const SOL = "So11111111111111111111111111111111111111112";
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

const walletKey = Keypair.generate();
const WALLET = walletKey.publicKey.toBase58();
const writer = Keypair.generate();

/** Two repaid $500 SOL loans (2.5 SOL each at $200). */
const loan = (closedAt: number, sig: string): Loan => ({
    protocol: "kamino", wallet: WALLET, position: "P", mint: SOL, decimals: 9, principal: 2_500_000_000n,
    openedAt: closedAt - 10 * DAY, closedAt, dueAt: 0, outcome: 0,
    peakAt: closedAt - 5 * DAY, openSignature: `${sig}-o`, peakSignature: `${sig}-p`, endSignature: `${sig}-e`,
});
const HISTORY = [loan(NOW - 100 * DAY, "a"), loan(NOW - 50 * DAY, "b")];
const prices: PriceSources = {
    async binance(_s, at) { return { price: 200_000_000_000_000n, at, source: "binance" }; },
    async birdeye() { return null; },
};

function reputationData(importDate: number): Buffer {
    const data = Buffer.alloc(200);
    createHash("sha256").update("account:UserReputationV2").digest().copy(data, 0, 0, 8);
    data.writeBigInt64LE(BigInt(importDate), 46);
    return data;
}
function clockData(now: number): Buffer {
    const data = Buffer.alloc(40);
    data.writeBigInt64LE(BigInt(now), 32);
    return data;
}

/** A fake chain + an in-memory database. `importDate` null = the wallet has no reputation account yet. */
async function setup(importDate: number | null, opts: { failOnChain?: boolean; history?: Loan[] } = {}) {
    const { Pool } = newDb().adapters.createPg();
    const pool = new Pool() as Pool;
    await migrate(pool);
    const sent: Buffer[] = [];
    let historyCalls = 0;
    const connection = {
        async getAccountInfo(pk: PublicKey) {
            if (pk.equals(SYSVAR_CLOCK_PUBKEY)) return { data: clockData(NOW), owner: SYSVAR_CLOCK_PUBKEY };
            if (pk.equals(reputationPda(walletKey.publicKey)) && importDate !== null) {
                return { data: reputationData(importDate), owner: TRUSTTRAIL_PROGRAM_ID };
            }
            return null;
        },
        async getLatestBlockhash() { return { blockhash: BLOCKHASH, lastValidBlockHeight: 500 }; },
        async sendRawTransaction(raw: Buffer) { sent.push(raw); return "SIG1"; },
        async confirmTransaction() { return { context: { slot: 1 }, value: { err: opts.failOnChain ? { InstructionError: [0, "x"] } : null } }; },
    } as unknown as ImportDeps["connection"];
    const deps: ImportDeps = {
        pool, connection, writer, prices,
        history: async () => { historyCalls++; return opts.history ?? HISTORY; },
        checkedProtocols: ["kamino", "marginfi", "save"],
    };
    return { deps, pool, sent, historyCalls: () => historyCalls };
}

/** The wallet signs the prepared transaction, as a browser wallet would. */
function walletSigns(base64: string): string {
    const tx = Transaction.from(Buffer.from(base64, "base64"));
    tx.partialSign(walletKey);
    return tx.serialize().toString("base64");
}

// ---------- signed message ----------

const sign = (wallet: string, ts: number, key = walletKey) =>
    bs58.encode(nacl.sign.detached(new TextEncoder().encode(importMessage(wallet, ts)), key.secretKey));

test("signed message: valid for 7 minutes, then refused", () => {
    assert.equal(verifyImportRequest(WALLET, NOW, sign(WALLET, NOW), NOW + 7 * 60), true);
    assert.equal(verifyImportRequest(WALLET, NOW, sign(WALLET, NOW), NOW + 7 * 60 + 1), false);
});

test("signed message: another key or another wallet is refused", () => {
    assert.equal(verifyImportRequest(WALLET, NOW, sign(WALLET, NOW, Keypair.generate()), NOW), false);
    const other = Keypair.generate().publicKey.toBase58();
    assert.equal(verifyImportRequest(other, NOW, sign(WALLET, NOW), NOW), false);
    assert.equal(verifyImportRequest(WALLET, NOW, "not-base58-0OIl", NOW), false);
});

// ---------- instruction encoding ----------

test("discriminators and account order match the program's IDL", () => {
    const idl = JSON.parse(readFileSync(join(__dirname, "../../../target/idl/trusttrail.json"), "utf8"));
    const ix = (name: string) => idl.instructions.find((i: { name: string }) => i.name === name);
    for (const name of ["init_score_v2", "set_imported_score"]) {
        assert.ok(ix(name), `${name} missing from the IDL: run anchor build`);
        assert.deepEqual([...discriminator(name)], ix(name).discriminator);
    }
    assert.deepEqual(ix("set_imported_score").accounts.map((a: { name: string }) => a.name), ["writer", "whitelist", "wallet", "reputation"]);
    assert.deepEqual(ix("set_imported_score").args.map((a: { type: string }) => a.type), ["u16", "u16", "u64"]);
    assert.deepEqual(ix("init_score_v2").accounts.map((a: { name: string }) => a.name), ["payer", "wallet", "reputation", "system_program"]);
});

test("set_imported_score data: score u16, meaningful_on_time u16, meaningful_weight_bps u64 (little-endian)", () => {
    const plan = { ...planImport([], [], 0, NOW), score: 742n, meaningfulOnTime: 3, meaningfulWeightBps: 23_456n };
    const ix = setImportedScoreIx(writer.publicKey, walletKey.publicKey, plan);
    assert.equal(ix.data.readUInt16LE(8), 742);
    assert.equal(ix.data.readUInt16LE(10), 3);
    assert.equal(ix.data.readBigUInt64LE(12), 23_456n);
    assert.ok(ix.keys[1].pubkey.equals(whitelistPda()));
    assert.ok(ix.keys[3].pubkey.equals(reputationPda(walletKey.publicKey)));
});

// ---------- prepare ----------

test("new wallet: one transaction creates the account and imports; the wallet pays", async () => {
    const { deps, pool } = await setup(null);
    const p = await prepareImport(deps, WALLET);
    const tx = Transaction.from(Buffer.from(p.transaction, "base64"));
    assert.equal(p.createsAccount, true);
    assert.equal(tx.instructions.length, 2);
    assert.deepEqual([...tx.instructions[0].data], [...discriminator("init_score_v2")]);
    assert.ok(tx.feePayer!.equals(walletKey.publicKey));
    const sigs = new Map(tx.signatures.map((s) => [s.publicKey.toBase58(), s.signature]));
    assert.ok(sigs.get(writer.publicKey.toBase58()));    // the backend signed
    assert.equal(sigs.get(WALLET), null);                 // the wallet has not yet
    assert.equal(p.meaningfulOnTime, 2);
    assert.deepEqual(await importHistory(pool, WALLET, true), []); // pending is not public
});

test("loans repaid in the same transaction are skipped before pricing and only counted", async () => {
    const flash = { ...loan(NOW - 20 * DAY, "f"), openSignature: "flash", endSignature: "flash" };
    const { deps } = await setup(null, { history: [...HISTORY, flash, flash] });
    const p = await prepareImport(deps, WALLET);
    assert.equal(p.sameTransactionLoans, 2);
    assert.equal(p.pricedLoans, 2);
    assert.equal(p.meaningfulOnTime, 2);
});

test("existing wallet: only set_imported_score, counts only loans closed after the last import", async () => {
    const { deps } = await setup(NOW - 60 * DAY);
    const p = await prepareImport(deps, WALLET);
    const tx = Transaction.from(Buffer.from(p.transaction, "base64"));
    assert.equal(p.createsAccount, false);
    assert.equal(tx.instructions.length, 1);
    assert.equal(p.newLoans, 1);
    assert.equal(p.meaningfulOnTime, 1);
});

test("cooldown is checked before any history is fetched", async () => {
    const { deps, historyCalls } = await setup(NOW - 10 * DAY);
    await assert.rejects(prepareImport(deps, WALLET), (err: ImportError) => {
        assert.equal(err.status, 429);
        assert.equal(err.details.nextImportAt, NOW - 10 * DAY + IMPORT_COOLDOWN_SECS);
        return true;
    });
    assert.equal(historyCalls(), 0);
});

test("a wallet with no history can still import (score 0)", async () => {
    const { deps } = await setup(null);
    deps.history = async () => [];
    const p = await prepareImport(deps, WALLET);
    assert.equal(p.score, 0);
    assert.equal(p.newLoans, 0);
});

// ---------- submit ----------

test("submit: the wallet-signed transaction is sent, confirmed and made public", async () => {
    const { deps, pool, sent } = await setup(null);
    const p = await prepareImport(deps, WALLET);
    assert.equal(await submitImport(deps, p.importId, walletSigns(p.transaction)), "SIG1");
    assert.equal(sent.length, 1);
    const [imp] = await importHistory(pool, WALLET, true);
    assert.equal(imp.txSignature, "SIG1");
    assert.equal(imp.loans.length, 2);
});

test("submit: a changed transaction is refused and nothing is sent", async () => {
    const { deps, sent } = await setup(null);
    const p = await prepareImport(deps, WALLET);
    const tx = Transaction.from(Buffer.from(p.transaction, "base64"));
    tx.instructions[1].data.writeUInt16LE(1000, 8); // the wallet tries to raise its own score
    tx.signatures = tx.signatures.map((s) => ({ ...s, signature: null }));
    tx.sign(walletKey);
    await assert.rejects(submitImport(deps, p.importId, tx.serialize({ requireAllSignatures: false }).toString("base64")),
        (err: ImportError) => err.status === 400 && /differs/.test(err.message));
    assert.equal(sent.length, 0);
});

test("submit: without the wallet's signature it is refused", async () => {
    const { deps, sent } = await setup(null);
    const p = await prepareImport(deps, WALLET);
    await assert.rejects(submitImport(deps, p.importId, p.transaction), (err: ImportError) => err.status === 400);
    assert.equal(sent.length, 0);
});

test("submit: a transaction that fails on-chain leaves the import pending", async () => {
    const { deps, pool } = await setup(null, { failOnChain: true });
    const p = await prepareImport(deps, WALLET);
    await assert.rejects(submitImport(deps, p.importId, walletSigns(p.transaction)), (err: ImportError) => err.status === 400);
    assert.deepEqual(await importHistory(pool, WALLET, true), []);
});

test("submit: an old, replaced import id is refused", async () => {
    const { deps } = await setup(null);
    const first = await prepareImport(deps, WALLET);
    await prepareImport(deps, WALLET);
    await assert.rejects(submitImport(deps, first.importId, walletSigns(first.transaction)), (err: ImportError) => err.status === 404);
});

// ---------- routes ----------

test("POST /import/prepare needs a fresh signed message", async () => {
    const { deps } = await setup(null);
    const app = express().use(express.json()).use(importRouter(deps, () => NOW));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (body: unknown) =>
        fetch(`${base}/import/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    try {
        assert.equal((await post({ wallet: "bad", timestamp: NOW, signature: "x" })).status, 400);
        assert.equal((await post({ wallet: WALLET, timestamp: NOW - 8 * 60, signature: sign(WALLET, NOW - 8 * 60) })).status, 401);
        const ok = await post({ wallet: WALLET, timestamp: NOW, signature: sign(WALLET, NOW) });
        assert.equal(ok.status, 200);
        assert.equal(((await ok.json()) as { createsAccount: boolean }).createsAccount, true);
    } finally {
        server.close();
    }
});
