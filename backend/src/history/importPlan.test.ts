import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { planImport, isNewSince } from "./importPlan";
import { importSummary } from "./scoring";
import { parseImportDate, parseClockTime, reputationPda, TRUSTTRAIL_PROGRAM_ID } from "./chain";
import type { PricedLoan } from "./prices";
import type { Loan } from "./types";

const DAY = 86_400;
const T0 = 1_735_689_600;
const USD = 1_000_000n;

const loan = (principalUsd: bigint, closedAt: number, outcome: Loan["outcome"] = 0): Loan => ({
    protocol: "kamino", wallet: "W", position: "P", mint: "M", decimals: 6, principal: principalUsd * USD,
    openedAt: closedAt - 10 * DAY, closedAt, dueAt: 0, outcome,
    peakAt: closedAt - 5 * DAY, openSignature: "o", peakSignature: "p", endSignature: "e",
});
const priced = (l: Loan): PricedLoan => ({
    ...l, rawAmount: l.principal, price: 1_000_000_000_000n, priceSource: "binance", priceAt: l.peakAt, priceGapSecs: 0,
});

const oldGood = priced(loan(500n, T0));
const oldLiquidation = priced(loan(1_000n, T0 + 1 * DAY, 2));
const newGood = priced(loan(800n, T0 + 40 * DAY));
const unpriced = loan(300n, T0 + 41 * DAY, 2);
const IMPORT_1 = T0 + 30 * DAY;
const NOW = T0 + 60 * DAY;

test("first import: every priced loan is counted", () => {
    const plan = planImport([oldGood, oldLiquidation, newGood], [], 0, NOW);
    assert.equal(plan.meaningfulOnTime, 2);
    assert.equal(plan.newLoans, 3);
    assert.equal(plan.previousImportDate, 0);
});

test("re-import: counts come only from loans closed after the previous import", () => {
    const plan = planImport([oldGood, oldLiquidation, newGood], [], IMPORT_1, NOW);
    const onlyNew = importSummary([newGood], NOW);
    assert.equal(plan.newLoans, 1);
    assert.equal(plan.meaningfulOnTime, 1);
    assert.equal(plan.meaningfulWeightBps, onlyNew.meaningfulWeightBps);
});

test("re-import: the score is rebuilt from the whole history", () => {
    const plan = planImport([oldGood, oldLiquidation, newGood], [], IMPORT_1, NOW);
    assert.equal(plan.score, importSummary([oldGood, oldLiquidation, newGood], NOW).score);
    assert.notEqual(plan.score, importSummary([newGood], NOW).score);
});

test("a loan closed in the same second as the previous import is not counted again", () => {
    assert.equal(isNewSince(loan(500n, IMPORT_1), IMPORT_1), false);
    assert.equal(isNewSince(loan(500n, IMPORT_1 + 1), IMPORT_1), true);
});

test("re-import with no new loans is allowed: counts stay, the score rises as the penalty fades", () => {
    const goods = [1, 2, 3, 4, 5].map((i) => priced(loan(5_000n, T0 + i * DAY)));
    const history = [...goods, priced(loan(300n, T0 + 6 * DAY, 2))];
    const early = planImport(history, [], 0, T0 + 30 * DAY);
    const later = planImport(history, [], T0 + 30 * DAY, T0 + 210 * DAY);
    assert.equal(later.newLoans, 0);
    assert.equal(later.meaningfulOnTime, 0);
    assert.ok(later.score > early.score);
});

test("unpriced loans are kept in the plan for the public history but never scored", () => {
    const withUnpriced = planImport([oldGood], [unpriced], 0, NOW);
    const without = planImport([oldGood], [], 0, NOW);
    assert.deepEqual(withUnpriced.dropped, [unpriced]);
    assert.equal(withUnpriced.score, without.score);
    assert.equal(withUnpriced.newLoans, 1);
});

test("import_date is read from UserReputationV2 bytes", () => {
    const data = Buffer.alloc(8 + 32 + 2 + 2 + 2 + 8 + 16);
    createHash("sha256").update("account:UserReputationV2").digest().copy(data, 0, 0, 8);
    data.writeBigInt64LE(BigInt(IMPORT_1), 46);
    assert.equal(parseImportDate(data), IMPORT_1);
});

test("other accounts are refused", () => {
    assert.throws(() => parseImportDate(Buffer.alloc(80)), /not a UserReputationV2 account/);
});

test("cluster time is read from the Clock sysvar bytes", () => {
    const data = Buffer.alloc(40);
    data.writeBigInt64LE(BigInt(NOW), 32);
    assert.equal(parseClockTime(data), NOW);
});

test("the reputation PDA uses the program's seeds", () => {
    const wallet = new PublicKey("So11111111111111111111111111111111111111112");
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from("trust-v2"), wallet.toBuffer()], TRUSTTRAIL_PROGRAM_ID);
    assert.ok(reputationPda(wallet).equals(expected));
});