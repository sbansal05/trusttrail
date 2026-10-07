import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { parseReputation, reputationPda, REPUTATION_LEN, TRUSTTRAIL_PROGRAM_ID, type Reputation } from "../history/chain";
import { migrate, savePending, confirmImport, importHistory } from "../history/store";
import { planImport } from "../history/importPlan";
import { IMPORT_COOLDOWN_SECS } from "../history/importService";
import { TIER_BRONZE, TIER_GOLD, TIER_UNPROVEN } from "../history/scoring";
import type { PricedLoan } from "../history/prices";
import type { Loan } from "../history/types";
import { emptyReputation, factors, nextTier, standing } from "./standing";
import { parseRepayment, REPAYMENT_SCHEMA, SAS_SIGNER, SAS_PROGRAM_ID } from "./attestations";
import { coverageOf } from "./coverage";
import { scoreRouter } from "./routes";

const DAY = 86_400;
const T0 = 1_800_000_000;
const WALLET = Keypair.generate().publicKey;
const LENDER = Keypair.generate().publicKey;
const LOAN = Keypair.generate().publicKey;

/** UserReputationV2 bytes in account order, as Anchor writes them. */
function reputationBytes(r: Reputation): Buffer {
    const b = Buffer.alloc(REPUTATION_LEN);
    createHash("sha256").update("account:UserReputationV2").digest().copy(b, 0, 0, 8);
    let o = 8;
    new PublicKey(r.wallet).toBuffer().copy(b, o); o += 32;
    const u8 = (v: number) => { b.writeUInt8(v, o); o += 1; };
    const u16 = (v: number) => { b.writeUInt16LE(v, o); o += 2; };
    const i64 = (v: number) => { b.writeBigInt64LE(BigInt(v), o); o += 8; };
    const u64 = (v: bigint) => { b.writeBigUInt64LE(v, o); o += 8; };
    u16(r.score); u16(r.nativeScore); u16(r.importedScore); i64(r.importDate); u8(r.tier);
    u16(r.loansRepaidOnTime); u16(r.lateRepaidLoans); u16(r.liquidatedLoans); u16(r.currentOnTimeStreak);
    i64(r.lastLiquidationDate); u64(r.totalUsdcRepaid); i64(r.lastUpdate);
    u64(r.sPlusBps); u64(r.sMinusBps); i64(r.sMinusAt); u64(r.exposureBps);
    u16(r.meaningfulOnTime); u64(r.meaningfulWeightBps); u8(254);
    return b;
}

/** A Gold-level history (8 full loans) with one liquidation at T0. */
const liquidatedOnce = (): Reputation => ({
    ...emptyReputation(WALLET.toBase58()),
    score: 750, nativeScore: 750, tier: TIER_BRONZE, importDate: T0 - 30 * DAY, importedScore: 600,
    loansRepaidOnTime: 8, liquidatedLoans: 1, lastLiquidationDate: T0, totalUsdcRepaid: 6_000_000_000n, lastUpdate: T0,
    sPlusBps: 80_000n, sMinusBps: 20_000n, sMinusAt: T0, exposureBps: 80_000n,
    meaningfulOnTime: 8, meaningfulWeightBps: 80_000n,
});

/** SAS Attestation account bytes holding one repayment record (same layout as Rust encode_repayment). */
function attestationBytes(signer = SAS_SIGNER): Buffer {
    const record = Buffer.alloc(116);
    let o = 0;
    const vec = (k: PublicKey) => { record.writeUInt32LE(32, o); k.toBuffer().copy(record, o + 4); o += 36; };
    const u64 = (v: bigint) => { record.writeBigUInt64LE(v, o); o += 8; };
    const i64 = (v: number) => { record.writeBigInt64LE(BigInt(v), o); o += 8; };
    vec(WALLET); vec(LENDER); u64(740_000_000n); u64(5_000_000n);
    i64(T0 - 20 * DAY); i64(T0 + 10 * DAY); i64(T0 - DAY);
    record.writeUInt8(0, o); record.writeUInt16LE(13_000, o + 1); record.writeUInt8(2, o + 3);

    const len = Buffer.alloc(4); len.writeUInt32LE(116);
    const tail = Buffer.alloc(8 + 32);
    return Buffer.concat([
        Buffer.from([0]), LOAN.toBuffer(), Keypair.generate().publicKey.toBuffer(), REPAYMENT_SCHEMA.toBuffer(),
        len, record, signer.toBuffer(), tail,
    ]);
}

// ---------- account parsing ----------

test("the whole UserReputationV2 account is read back field by field", () => {
    const r = liquidatedOnce();
    assert.deepEqual(parseReputation(reputationBytes(r)), r);
    assert.throws(() => parseReputation(Buffer.alloc(REPUTATION_LEN)), /not a UserReputationV2 account/);
});

test("a repayment attestation is decoded; one signed by anyone else is refused", () => {
    const rec = parseRepayment("ADDR", attestationBytes());
    assert.deepEqual(rec, {
        address: "ADDR", loan: LOAN.toBase58(), borrower: WALLET.toBase58(), lenderProgram: LENDER.toBase58(),
        principalUsdc: "740000000", interestPaidUsdc: "5000000",
        openedAt: T0 - 20 * DAY, dueAt: T0 + 10 * DAY, closedAt: T0 - DAY,
        outcome: 0, collateralRatioBps: 13_000, tierAtOpen: 2,
    });
    assert.equal(parseRepayment("ADDR", attestationBytes(Keypair.generate().publicKey)), null);
});

// ---------- live standing ----------

test("live score: the penalty fades and the 90-day block lifts, as the pool sees it", () => {
    const r = liquidatedOnce();
    // at the liquidation: native (8.0 − 2.0) ÷ 8.0 = 750, blocked from Silver and Gold
    assert.deepEqual(standing(r, T0), { native: 750n, score: 750n, tier: TIER_BRONZE });
    // 90 days later the penalty is half (1.0): native 875, and Gold is open again
    assert.deepEqual(standing(r, T0 + 90 * DAY), { native: 875n, score: 875n, tier: TIER_GOLD });
});

test("blend: little native history leans on the imported part", () => {
    const r = { ...emptyReputation(WALLET.toBase58()), importedScore: 800, sPlusBps: 20_000n, exposureBps: 20_000n };
    const s = standing(r, T0);
    assert.equal(s.native, 250n);
    assert.equal(s.score, 662n); // 0.25 × 250 + 0.75 × 800
    const f = factors(r, s, T0).blend;
    assert.deepEqual([f.nativeShareBps, f.importedShareBps], ["2500", "7500"]);
});

test("next tier: each gate with what is there and what is needed", () => {
    const r = { ...emptyReputation(WALLET.toBase58()), importedScore: 600, meaningfulOnTime: 2, meaningfulWeightBps: 24_000n };
    const n = nextTier(r, standing(r, T0), T0);
    assert.deepEqual(n, {
        tier: "silver",
        gates: [
            { gate: "score", have: "600", need: "500", met: true },
            { gate: "meaningfulOnTime", have: "2", need: "3", met: false },
            { gate: "meaningfulWeightBps", have: "24000", need: "30000", met: false },
            { gate: "noLiquidationFor90Days", blockedUntil: null, met: true },
        ],
    });
});

test("next tier: Unproven needs any score, a recent liquidation shows when the block lifts, Gold has none", () => {
    const empty = emptyReputation(WALLET.toBase58());
    assert.deepEqual(nextTier(empty, standing(empty, T0), T0), {
        tier: "bronze", gates: [{ gate: "score", have: "0", need: "1", met: false }],
    });
    const r = liquidatedOnce();
    const blocked = nextTier(r, standing(r, T0 + DAY), T0 + DAY)!;
    assert.equal(blocked.tier, "silver");
    assert.deepEqual(blocked.gates[3], { gate: "noLiquidationFor90Days", blockedUntil: T0 + 90 * DAY, met: false });
    assert.equal(factors(r, standing(r, T0 + DAY), T0 + DAY).liquidation.blockedUntil, T0 + 90 * DAY);
    assert.equal(nextTier(r, standing(r, T0 + 90 * DAY), T0 + 90 * DAY), null);
});

// ---------- coverage ----------

const loan = (protocol: Loan["protocol"], outcome: Loan["outcome"], sig: string): Loan => ({
    protocol, wallet: WALLET.toBase58(), position: "P", mint: "M", decimals: 6, principal: 500_000_000n,
    openedAt: T0 - 40 * DAY, closedAt: T0 - 35 * DAY, dueAt: 0, outcome,
    peakAt: T0 - 38 * DAY, openSignature: `${sig}-o`, peakSignature: `${sig}-p`, endSignature: `${sig}-e`,
});
const priced = (l: Loan): PricedLoan => ({
    ...l, rawAmount: l.principal, price: 1_000_000_000_000n, priceSource: "binance", priceAt: l.peakAt, priceGapSecs: 0,
});

async function poolWithImport(): Promise<Pool> {
    const { Pool } = newDb().adapters.createPg();
    const pool = new Pool() as Pool;
    await migrate(pool);
    const plan = planImport(
        [priced(loan("kamino", 0, "a")), priced(loan("kamino", 2, "b")), priced(loan("save", 0, "c"))],
        [loan("kamino", 0, "d")], 0, T0 - 30 * DAY,
    );
    const id = await savePending(pool, WALLET.toBase58(), plan, { message: "M", lastValidBlockHeight: 1 }, ["kamino", "marginfi", "save"]);
    await confirmImport(pool, id, "TX");
    return pool;
}

test("coverage: every checked protocol is listed, even with nothing found", async () => {
    const pool = await poolWithImport();
    const [latest] = await importHistory(pool, WALLET.toBase58(), true);
    const c = coverageOf(latest, T0 - 30 * DAY + IMPORT_COOLDOWN_SECS);
    assert.equal(c.importedAt, T0 - 30 * DAY);
    assert.deepEqual(c.protocols, [
        { protocol: "kamino", loans: 3, onTime: 2, late: 0, liquidated: 1, defaulted: 0, unpriced: 1, usdMicro: "1000000000" },
        { protocol: "marginfi", loans: 0, onTime: 0, late: 0, liquidated: 0, defaulted: 0, unpriced: 0, usdMicro: "0" },
        { protocol: "save", loans: 1, onTime: 1, late: 0, liquidated: 0, defaulted: 0, unpriced: 0, usdMicro: "500000000" },
    ]);
    assert.deepEqual(coverageOf(undefined, null), { importId: null, importedAt: null, nextImportAt: null, protocols: [] });
});

// ---------- GET /score/:wallet ----------

async function serve(pool: Pool, withAccount: boolean) {
    const gpaCalls: unknown[] = [];
    const connection = {
        async getAccountInfo(pk: PublicKey) {
            if (pk.equals(SYSVAR_CLOCK_PUBKEY)) {
                const d = Buffer.alloc(40); d.writeBigInt64LE(BigInt(T0 + DAY), 32);
                return { data: d, owner: SYSVAR_CLOCK_PUBKEY };
            }
            if (withAccount && pk.equals(reputationPda(WALLET))) return { data: reputationBytes(liquidatedOnce()), owner: TRUSTTRAIL_PROGRAM_ID };
            return null;
        },
        async getProgramAccounts(program: PublicKey, config: unknown) {
            assert.ok(program.equals(SAS_PROGRAM_ID));
            gpaCalls.push(config);
            return withAccount ? [{ pubkey: Keypair.generate().publicKey, account: { data: attestationBytes() } }] : [];
        },
    } as any;
    const app = express();
    app.use(scoreRouter({ pool, connection }));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, close: () => server.close(), gpaCalls };
}

test("GET /score/:wallet: live score, factors, coverage and records in one answer", async () => {
    const s = await serve(await poolWithImport(), true);
    try {
        const body = await (await fetch(`${s.base}/score/${WALLET.toBase58()}`)).json();
        assert.equal(body.exists, true);
        assert.equal(body.asOf, T0 + DAY);
        assert.equal(body.tierName, "bronze");          // still inside the 90-day block
        assert.equal(body.factors.imported, 600);
        assert.equal(body.factors.nextTier.tier, "silver");
        assert.equal(body.coverage.protocols.length, 3);
        assert.equal(body.coverage.nextImportAt, T0 - 30 * DAY + IMPORT_COOLDOWN_SECS);
        assert.equal(body.attestations.length, 1);
        assert.equal(body.attestations[0].principalUsdc, "740000000");
        // filtered on schema, borrower and signer
        const filters = (s.gpaCalls[0] as { filters: { memcmp: { offset: number; bytes: string } }[] }).filters;
        assert.deepEqual(filters.map((f) => [f.memcmp.offset, f.memcmp.bytes]), [
            [65, REPAYMENT_SCHEMA.toBase58()], [105, WALLET.toBase58()], [217, SAS_SIGNER.toBase58()],
        ]);
    } finally {
        s.close();
    }
});

test("GET /score/:wallet: no score account reads as Unproven with zeros; a bad wallet is 400", async () => {
    const { Pool } = newDb().adapters.createPg();
    const pool = new Pool() as Pool;
    await migrate(pool);
    const s = await serve(pool, false);
    try {
        const body = await (await fetch(`${s.base}/score/${WALLET.toBase58()}`)).json();
        assert.equal(body.exists, false);
        assert.equal(body.score, 0);
        assert.equal(body.tier, TIER_UNPROVEN);
        assert.deepEqual(body.coverage.protocols, []);
        assert.deepEqual(body.attestations, []);
        assert.equal((await fetch(`${s.base}/score/not-a-wallet`)).status, 400);
    } finally {
        s.close();
    }
});

