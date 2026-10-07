import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { instructions, walletEvents, REPAY_ALL, type Tx } from "./common";
import { kamino } from "./kamino";
import { marginfi, MARGINFI_PROGRAM_ID } from "./marginfi";
import { save, SAVE_PROGRAM_ID } from "./save";
import { KAMINO_PROGRAM_ID } from "../../getObligations";
import { buildLoans, repayOutcome, liquidationOutcome } from "../buildLoans";
import { jupiterLend, JUPITER_VAULTS_PROGRAM_ID, MIN_I128, readI128 } from "./jupiterLend";
import { jupiterStateEvents, parsePositionIds, STATE_SIGNATURE_PREFIX, type PositionState } from "./jupiterState";
import { loopscale, LOOPSCALE_PROGRAM_ID } from "./loopscale";
import { durationSecs, termStarts, withLoopscaleDueDates } from "./loopscaleTerms";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WALLET = "Wa11et1111111111111111111111111111111111111";
const WRAPPER = "Wrapper111111111111111111111111111111111111";
const T0 = 1_750_000_000;

type RawIx = { program: string; accounts: string[]; data: Buffer };

/** A transaction shaped like Helius returns it, built from addresses instead of indexes. */
function fakeTx(o: {
    top: RawIx[];
    inner?: { index: number; ixs: RawIx[] }[];
    tokens?: { account: string; mint: string; decimals: number; pre?: string; post?: string }[];
    time?: number;
    sig?: string;
    err?: unknown;
}): Tx {
    const keys: string[] = [WALLET];
    const idx = (k: string) => (keys.includes(k) ? keys.indexOf(k) : keys.push(k) - 1);
    const enc = (ix: RawIx) => ({ programIdIndex: idx(ix.program), accounts: ix.accounts.map(idx), data: bs58.encode(ix.data) });
    const top = o.top.map(enc);
    const inner = (o.inner ?? []).map((g) => ({ index: g.index, instructions: g.ixs.map(enc) }));
    const balance = (t: NonNullable<typeof o.tokens>[number], amount: string) =>
        ({ accountIndex: idx(t.account), mint: t.mint, uiTokenAmount: { decimals: t.decimals, amount } });
    const preBalances = (o.tokens ?? []).map((t) => balance(t, t.pre ?? "0"));
    const postBalances = (o.tokens ?? []).map((t) => balance(t, t.post ?? t.pre ?? "0"));
    return {
        blockTime: o.time ?? T0,
        meta: { err: o.err ?? null, innerInstructions: inner, preTokenBalances: preBalances, postTokenBalances: postBalances, loadedAddresses: { writable: [], readonly: [] } },
        transaction: { signatures: [o.sig ?? "sig"], message: { accountKeys: keys, instructions: top } },
    } as unknown as Tx;
}

const disc = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return b; };
const acc = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`.padEnd(44, "1"));

// ---------- MarginFi ----------

/** lending_account_borrow / repay accounts: group, marginfi_account, authority, bank, user token, ... */
const mfiAccounts = (account: string, userToken: string) => {
    const a = acc(8, "mfi");
    a[1] = account; a[2] = WALLET; a[4] = userToken;
    return a;
};
const mfiBorrow = (account: string, token: string, amount: bigint): RawIx =>
    ({ program: MARGINFI_PROGRAM_ID, accounts: mfiAccounts(account, token), data: Buffer.concat([disc("lending_account_borrow"), u64(amount)]) });
const mfiRepay = (account: string, token: string, amount: bigint, repayAll?: boolean): RawIx => ({
    program: MARGINFI_PROGRAM_ID,
    accounts: mfiAccounts(account, token).slice(0, 7),
    data: Buffer.concat([disc("lending_account_repay"), u64(amount), repayAll === undefined ? Buffer.from([0]) : Buffer.from([1, repayAll ? 1 : 0])]),
});

test("instructions(): top-level first, then the inner instructions it made", () => {
    const a = mfiBorrow("ACC", "TOK", 1n), b = mfiRepay("ACC", "TOK", 1n);
    const tx = fakeTx({ top: [{ program: WRAPPER, accounts: [], data: Buffer.from([9]) }], inner: [{ index: 0, ixs: [a, b] }] });
    assert.deepEqual(instructions(tx).map((i) => i.program), [WRAPPER, MARGINFI_PROGRAM_ID, MARGINFI_PROGRAM_ID]);
});

test("MarginFi: borrow and repay with the mint from the user's token account", () => {
    const tokens = [{ account: "TOK", mint: USDC, decimals: 6 }];
    const b = marginfi.events(WALLET, fakeTx({ top: [mfiBorrow("ACC", "TOK", 500_000_000n)], tokens }));
    const r = marginfi.events(WALLET, fakeTx({ top: [mfiRepay("ACC", "TOK", 200_000_000n)], tokens }));
    assert.deepEqual(b.map((e) => [e.kind, e.position, e.mint, e.amount, e.decimals]), [["borrow", "ACC", USDC, 500_000_000n, 6]]);
    assert.deepEqual(r.map((e) => [e.kind, e.amount]), [["repay", 200_000_000n]]);
});

test("MarginFi: repay_all = true closes the loan whatever the amount", () => {
    const tokens = [{ account: "TOK", mint: USDC, decimals: 6 }];
    const [e] = marginfi.events(WALLET, fakeTx({ top: [mfiRepay("ACC", "TOK", 0n, true)], tokens }));
    assert.equal(e.amount, REPAY_ALL);
    const [f] = marginfi.events(WALLET, fakeTx({ top: [mfiRepay("ACC", "TOK", 7n, false)], tokens }));
    assert.equal(f.amount, 7n);
});

test("MarginFi: a borrow made through another program (inner instruction) is found", () => {
    const tx = fakeTx({
        top: [{ program: WRAPPER, accounts: [], data: Buffer.from([1]) }],
        inner: [{ index: 0, ixs: [mfiBorrow("ACC", "TOK", 100n)] }],
        tokens: [{ account: "TOK", mint: USDC, decimals: 6 }],
    });
    assert.equal(marginfi.events(WALLET, tx).length, 1);
});

test("MarginFi: in a receivership liquidation, the repay of the liquidated account is a liquidation", () => {
    const start: RawIx = { program: MARGINFI_PROGRAM_ID, accounts: ["ACC", "REC", "RCV", "SYSVAR"], data: disc("start_liquidation") };
    const end: RawIx = { program: MARGINFI_PROGRAM_ID, accounts: ["ACC", "REC", "RCV", "FEE", "FW", "SYS"], data: disc("end_liquidation") };
    const tx = fakeTx({
        top: [start, mfiRepay("ACC", "LIQTOK", 0n, true), mfiRepay("OTHER", "TOK2", 5n), end],
        tokens: [{ account: "LIQTOK", mint: USDC, decimals: 6 }, { account: "TOK2", mint: USDC, decimals: 6 }],
    });
    const events = marginfi.events(WALLET, tx);
    assert.deepEqual(events.map((e) => [e.position, e.kind]), [["ACC", "liquidation"], ["OTHER", "repay"]]);
});

test("MarginFi: lending_account_liquidate marks the liquidatee's debt token", () => {
    const a = acc(10, "liq");
    a[5] = "VICTIM"; a[7] = "LIABVAULT";
    const ix: RawIx = { program: MARGINFI_PROGRAM_ID, accounts: a, data: Buffer.concat([disc("lending_account_liquidate"), u64(42n), Buffer.from([4, 4])]) };
    const [e] = marginfi.events(WALLET, fakeTx({ top: [ix], tokens: [{ account: "LIABVAULT", mint: USDC, decimals: 6 }] }));
    assert.deepEqual([e.kind, e.position, e.mint], ["liquidation", "VICTIM", USDC]);
});

// ---------- Save ----------

const saveIx = (tag: number, n: number, set: Record<number, string>, amount: bigint): RawIx => {
    const a = acc(n, `s${tag}`);
    for (const [i, v] of Object.entries(set)) a[Number(i)] = v;
    return { program: SAVE_PROGRAM_ID, accounts: a, data: Buffer.concat([Buffer.from([tag]), u64(amount)]) };
};

test("Save: borrow (tag 10) and repay (tag 11) on the obligation", () => {
    const tokens = [{ account: "MYUSDC", mint: USDC, decimals: 6 }];
    const b = save.events(WALLET, fakeTx({ top: [saveIx(10, 9, { 1: "MYUSDC", 4: "OBL" }, 300_000_000n)], tokens }));
    const r = save.events(WALLET, fakeTx({ top: [saveIx(11, 7, { 0: "MYUSDC", 3: "OBL" }, REPAY_ALL)], tokens }));
    assert.deepEqual(b.map((e) => [e.kind, e.position, e.mint, e.amount]), [["borrow", "OBL", USDC, 300_000_000n]]);
    assert.deepEqual(r.map((e) => [e.kind, e.position, e.amount]), [["repay", "OBL", REPAY_ALL]]);
});

test("Save: both liquidation instructions (tags 12 and 17) mark the obligation", () => {
    const tokens = [{ account: "SUPPLY", mint: USDC, decimals: 6 }];
    const old = save.events(WALLET, fakeTx({ top: [saveIx(12, 12, { 3: "SUPPLY", 6: "OBL" }, 1n)], tokens }));
    const now = save.events(WALLET, fakeTx({ top: [saveIx(17, 15, { 4: "SUPPLY", 10: "OBL" }, 1n)], tokens }));
    assert.deepEqual([...old, ...now].map((e) => [e.kind, e.position, e.mint]), [["liquidation", "OBL", USDC], ["liquidation", "OBL", USDC]]);
});

test("Save: a repay-max through the wrapper program (inner instruction) is found", () => {
    const tx = fakeTx({
        top: [{ program: WRAPPER, accounts: [], data: Buffer.from([1]) }],
        inner: [{ index: 0, ixs: [saveIx(11, 7, { 0: "MYUSDC", 3: "OBL" }, REPAY_ALL)] }],
        tokens: [{ account: "MYUSDC", mint: USDC, decimals: 6 }],
    });
    assert.deepEqual(save.events(WALLET, tx).map((e) => e.kind), ["repay"]);
});

test("Save: other instructions (deposit, refresh) are ignored", () => {
    assert.equal(save.events(WALLET, fakeTx({ top: [saveIx(8, 6, {}, 1n), saveIx(7, 3, {}, 0n)] })).length, 0);
});

// ---------- Kamino ----------

test("Kamino: a borrow through another program (e.g. Multiply) is now found", () => {
    const a = acc(7, "kmn");
    a[1] = "OBLIG"; a[5] = USDC;
    const borrow: RawIx = { program: KAMINO_PROGRAM_ID, accounts: a, data: Buffer.concat([disc("borrow_obligation_liquidity"), u64(250n)]) };
    const tx = fakeTx({ top: [{ program: WRAPPER, accounts: [], data: Buffer.from([1]) }], inner: [{ index: 0, ixs: [borrow] }] });
    assert.deepEqual(kamino.events(WALLET, tx).map((e) => [e.kind, e.position, e.mint, e.amount]), [["borrow", "OBLIG", USDC, 250n]]);
});

// ---------- All together ----------

test("walletEvents: failed transactions are skipped, liquidations come from the position's own history", async () => {
    const tokens = [{ account: "TOK", mint: USDC, decimals: 6 }];
    const walletTxs = [
        fakeTx({ top: [mfiBorrow("ACC", "TOK", 500_000_000n)], tokens, time: T0, sig: "b1" }),
        fakeTx({ top: [mfiRepay("ACC", "TOK", 500_000_000n)], tokens, time: T0 + 10, sig: "fail", err: { custom: 1 } }),
    ];
    const a = acc(10, "liq");
    a[5] = "ACC"; a[7] = "LIABVAULT";
    const liquidation = fakeTx({
        top: [{ program: MARGINFI_PROGRAM_ID, accounts: a, data: Buffer.concat([disc("lending_account_liquidate"), u64(1n), Buffer.from([1, 1])]) }],
        tokens: [{ account: "LIABVAULT", mint: USDC, decimals: 6 }],
        time: T0 + 5 * 86_400,
        sig: "liq",
    });
    const history = async (address: string) => (address === WALLET ? walletTxs : address === "ACC" ? [liquidation] : []);
    const events = await walletEvents(WALLET, [kamino, marginfi, save], history as any);
    assert.deepEqual(events.map((e) => [e.signature, e.kind]), [["b1", "borrow"], ["liq", "liquidation"]]);
    const loans = buildLoans(events);
    assert.equal(loans.length, 1);
    assert.equal(loans[0].outcome, 2);
    assert.equal(loans[0].protocol, "marginfi");
});

test("MarginFi borrow then repay_all builds one on-time loan", () => {
    const tokens = [{ account: "TOK", mint: USDC, decimals: 6 }];
    const events = [
        ...marginfi.events(WALLET, fakeTx({ top: [mfiBorrow("ACC", "TOK", 500_000_000n)], tokens, time: T0, sig: "b" })),
        ...marginfi.events(WALLET, fakeTx({ top: [mfiRepay("ACC", "TOK", 0n, true)], tokens, time: T0 + 2 * 86_400, sig: "r" })),
    ];
    const [loan] = buildLoans(events);
    assert.deepEqual([loan.principal, loan.outcome, loan.openSignature, loan.endSignature], [500_000_000n, 0, "b", "r"]);
});

// ---------- Mint fallback: a temporary token account is never in the balances ----------

const WSOL = "So11111111111111111111111111111111111111112";

test("MarginFi: borrow into a temporary wSOL account takes the mint from the bank's vault", () => {
    const ix = mfiBorrow("ACC", "TEMPWSOL", 2_000_000_000n);
    ix.accounts[6] = "SOLVAULT";
    const [e] = marginfi.events(WALLET, fakeTx({ top: [ix], tokens: [{ account: "SOLVAULT", mint: WSOL, decimals: 9 }] }));
    assert.deepEqual([e.kind, e.mint, e.decimals, e.amount], ["borrow", WSOL, 9, 2_000_000_000n]);
});

test("MarginFi: repay from a temporary account takes the mint from the vault; the user's account wins when listed", () => {
    const ix = mfiRepay("ACC", "TEMPWSOL", 0n, true);
    ix.accounts[5] = "SOLVAULT";
    const [e] = marginfi.events(WALLET, fakeTx({ top: [ix], tokens: [{ account: "SOLVAULT", mint: WSOL, decimals: 9 }] }));
    assert.deepEqual([e.kind, e.mint], ["repay", WSOL]);
    const both = [{ account: "TEMPWSOL", mint: USDC, decimals: 6 }, { account: "SOLVAULT", mint: WSOL, decimals: 9 }];
    const [f] = marginfi.events(WALLET, fakeTx({ top: [ix], tokens: both }));
    assert.equal(f.mint, USDC);
});

test("Save: borrow and repay through temporary accounts take the mint from the reserve's liquidity supply", () => {
    const tokens = [{ account: "SUPPLY", mint: WSOL, decimals: 9 }];
    const b = save.events(WALLET, fakeTx({ top: [saveIx(10, 9, { 0: "SUPPLY", 1: "TEMP", 4: "OBL" }, 5n)], tokens }));
    const r = save.events(WALLET, fakeTx({ top: [saveIx(11, 7, { 0: "TEMP", 1: "SUPPLY", 3: "OBL" }, REPAY_ALL)], tokens }));
    assert.deepEqual([...b, ...r].map((e) => [e.kind, e.mint, e.decimals]), [["borrow", WSOL, 9], ["repay", WSOL, 9]]);
});

test("an event is skipped only when neither the user's account nor the vault is listed", () => {
    assert.equal(marginfi.events(WALLET, fakeTx({ top: [mfiBorrow("ACC", "TEMP", 1n)] })).length, 0);
    assert.equal(save.events(WALLET, fakeTx({ top: [saveIx(10, 9, { 1: "TEMP", 4: "OBL" }, 1n)] })).length, 0);
});

// ---------- Jupiter Lend ----------

const i128 = (n: bigint) => { const b = Buffer.alloc(16); const u = BigInt.asUintN(128, n); b.writeBigUInt64LE(u & (2n ** 64n - 1n)); b.writeBigUInt64LE(u >> 64n, 8); return b; };
/** operate(new_col, new_debt, transfer_type None, remaining_accounts_indices empty) */
const jupOperate = (signer: string, position: string, newCol: bigint, newDebt: bigint): RawIx => {
    const a = acc(36, "jup");
    a[0] = signer; a[9] = "USDCMINT"; a[11] = position; a[25] = "JUPVAULT";
    return { program: JUPITER_VAULTS_PROGRAM_ID, accounts: a, data: Buffer.concat([disc("operate"), i128(newCol), i128(newDebt), Buffer.from([0]), Buffer.alloc(4)]) };
};

test("Jupiter Lend: i128 amounts read back, negative and i128::MIN included", () => {
    assert.equal(readI128(i128(-5n), 0), -5n);
    assert.equal(readI128(i128(MIN_I128), 0), MIN_I128);
    assert.equal(readI128(i128(2n ** 100n), 0), 2n ** 100n);
});

test("Jupiter Lend: borrow, a set repay, and collateral-only operates", () => {
    const b = jupiterLend.events(WALLET, fakeTx({ top: [jupOperate(WALLET, "POS", 5_000_000_000n, 1_000_000_000n)] }));
    const r = jupiterLend.events(WALLET, fakeTx({ top: [jupOperate(WALLET, "POS", 0n, -400_000_000n)] }));
    const c = jupiterLend.events(WALLET, fakeTx({ top: [jupOperate(WALLET, "POS", 7n, 0n)] }));
    assert.deepEqual(b.map((e) => [e.kind, e.position, e.mint, e.amount]), [["borrow", "POS", "USDCMINT", 1_000_000_000n]]);
    assert.deepEqual(r.map((e) => [e.kind, e.amount]), [["repay", 400_000_000n]]);
    assert.equal(c.length, 0);
});

test("Jupiter Lend: repay-everything records what actually reached the vault; others' operates are ignored", () => {
    const tokens = [{ account: "JUPVAULT", mint: USDC, decimals: 6, pre: "9000000000", post: "9600000000" }];
    const [e] = jupiterLend.events(WALLET, fakeTx({ top: [jupOperate(WALLET, "POS", 0n, MIN_I128)], tokens }));
    assert.deepEqual([e.kind, e.amount, e.paid], ["repay", REPAY_ALL, 600_000_000n]);
    assert.equal(jupiterLend.events(WALLET, fakeTx({ top: [jupOperate("SOMEONEELSE", "POS", 0n, 5n)] })).length, 0);
});

test("Jupiter Lend: a repay-everything short of what was borrowed is a liquidation; with interest it is on time", () => {
    const borrow = fakeTx({ top: [jupOperate(WALLET, "POS", 1n, 1_000_000_000n)], time: T0, sig: "b" });
    const closeWith = (paid: string) => fakeTx({
        top: [jupOperate(WALLET, "POS", 0n, MIN_I128)], time: T0 + 10 * 86_400, sig: "r",
        tokens: [{ account: "JUPVAULT", mint: USDC, decimals: 6, pre: "0", post: paid }],
    });
    const events = (paid: string) => [...jupiterLend.events(WALLET, borrow), ...jupiterLend.events(WALLET, closeWith(paid))];
    assert.deepEqual(buildLoans(events("600000000")).map((l) => l.outcome), [2]);
    assert.deepEqual(buildLoans(events("1004000000")).map((l) => l.outcome), [0]);
});

test("Jupiter Lend state: a liquidated or debt-free open position becomes a liquidation at the last touch", async () => {
    const borrowA = jupiterLend.events(WALLET, fakeTx({ top: [jupOperate(WALLET, "POSA", 1n, 500_000_000n)], time: T0, sig: "a" }));
    const borrowB = jupiterLend.events(WALLET, fakeTx({ top: [jupOperate(WALLET, "POSB", 1n, 500_000_000n)], time: T0 + 5, sig: "b" }));
    const borrowC = jupiterLend.events(WALLET, fakeTx({ top: [jupOperate(WALLET, "POSC", 1n, 500_000_000n)], time: T0 + 9, sig: "c" }));
    const states: Record<string, PositionState | null> = {
        POSA: { liquidated: true, debtRaw: 0n },    // liquidated, never touched again
        POSB: { liquidated: false, debtRaw: 0n },   // debt gone without a repay we saw
        POSC: { liquidated: false, debtRaw: 1n },   // still open
    };
    const events = [...borrowA, ...borrowB, ...borrowC];
    const extra = await jupiterStateEvents(events, async (p) => states[p] ?? null);
    assert.deepEqual(extra.map((e) => [e.position, e.kind, e.timestamp, e.signature]), [
        ["POSA", "liquidation", T0, `${STATE_SIGNATURE_PREFIX}POSA`],
        ["POSB", "liquidation", T0 + 5, `${STATE_SIGNATURE_PREFIX}POSB`],
    ]);
    const loans = buildLoans([...events, ...extra]);
    assert.deepEqual(loans.map((l) => [l.position, l.outcome, l.closedAt]), [["POSA", 2, T0], ["POSB", 2, T0 + 5]]);
});

test("Jupiter Lend position account: vault id and NFT id", () => {
    const d = Buffer.alloc(80);
    d.writeUInt16LE(7, 8); d.writeUInt32LE(4242, 10);
    assert.deepEqual(parsePositionIds(d), { vaultId: 7, positionId: 4242 });
});

// ---------- Loopscale ----------

/** borrow_principal / repay_principal / liquidate_ledger: borrower is account 2, the loan account 3. */
const lsIx = (name: string, borrower: string, mintAt: number, args: Buffer): RawIx => {
    const a = acc(17, "ls");
    a[2] = borrower; a[3] = "LOAN"; a[mintAt] = "PRINCIPALMINT";
    return { program: LOOPSCALE_PROGRAM_ID, accounts: a, data: Buffer.concat([disc(name), args]) };
};

test("Loopscale: borrow, repay, repay_all and liquidation of the wallet's own loan", () => {
    const one = (ix: RawIx) => loopscale.events(WALLET, fakeTx({ top: [ix] }));
    const borrow = one(lsIx("borrow_principal", WALLET, 6, Buffer.concat([u64(250_000_000n), Buffer.alloc(8)])));
    const repay = one(lsIx("repay_principal", WALLET, 6, Buffer.concat([u64(100n), Buffer.from([0, 0])])));
    const repayAll = one(lsIx("repay_principal", WALLET, 6, Buffer.concat([u64(0n), Buffer.from([0, 1])])));
    const liq = one(lsIx("liquidate_ledger", WALLET, 8, Buffer.from([0, 0, 0, 0, 0, 0])));
    assert.deepEqual([...borrow, ...repay, ...repayAll, ...liq].map((e) => [e.kind, e.position, e.mint, e.amount]), [
        ["borrow", "LOAN", "PRINCIPALMINT", 250_000_000n],
        ["repay", "LOAN", "PRINCIPALMINT", 100n],
        ["repay", "LOAN", "PRINCIPALMINT", REPAY_ALL],
        ["liquidation", "LOAN", "PRINCIPALMINT", 0n],
    ]);
});

test("Loopscale: a liquidation of someone else's loan in the wallet's history is ignored", () => {
    const ix = lsIx("liquidate_ledger", "OTHERBORROWER", 8, Buffer.from([0, 0, 0, 0, 0, 0]));
    assert.equal(loopscale.events(WALLET, fakeTx({ top: [ix] })).length, 0);
});

test("due dates: on time, late within the 2-day Loopscale grace, defaulted after; others have no grace", () => {
    const due = T0 + 30 * 86_400, day = 86_400;
    assert.deepEqual(
        [due, due + day, due + 2 * day + 1].map((t) => repayOutcome("loopscale", due, t)),
        [0, 1, 3],
    );
    assert.deepEqual([liquidationOutcome("loopscale", due, due + day), liquidationOutcome("loopscale", due, due + 3 * day)], [2, 3]);
    assert.deepEqual([repayOutcome("kamino", due, due + 10 * day), liquidationOutcome("kamino", 0, due)], [1, 2]);
});

// ---------- Loopscale terms and rollovers ----------

const DAY = 86_400;
/** borrow_principal(amount, asset_index_guidance bytes, duration u8, expected values, skip_sol_unwrap) */
const lsBorrow = (amount: bigint, durationIndex: number, guidance = Buffer.from([1, 2, 3])) =>
    lsIx("borrow_principal", WALLET, 6, Buffer.concat([u64(amount), u32(guidance.length), guidance, Buffer.from([durationIndex]), Buffer.alloc(8 + 20 + 1)]));
/** refinance_ledger(ledger_index, duration_index, guidance): loan is account 2, principal mint account 9 */
const lsRefinance = (durationIndex: number): RawIx => {
    const a = acc(17, "rf");
    a[2] = "LOAN"; a[9] = "PRINCIPALMINT";
    return { program: LOOPSCALE_PROGRAM_ID, accounts: a, data: Buffer.concat([disc("refinance_ledger"), Buffer.from([0, durationIndex]), u32(0)]) };
};
function u32(n: number) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
const lsRepayAll = () => lsIx("repay_principal", WALLET, 6, Buffer.concat([u64(0n), Buffer.from([0, 1])]));

test("Loopscale terms: the duration index is read after the guidance bytes; refinances restart the term", () => {
    const txs = [
        fakeTx({ top: [lsBorrow(5n, 2, Buffer.alloc(7))], time: T0, sig: "b" }),
        fakeTx({ top: [lsRefinance(1)], time: T0 + 3600, sig: "r" }),
        fakeTx({ top: [lsIx("borrow_principal", "SOMEONEELSE", 6, Buffer.concat([u64(5n), u32(0), Buffer.from([0])]))], time: T0, sig: "x" }),
    ];
    assert.deepEqual(termStarts(WALLET, txs as any).map((s) => [s.loan, s.mint, s.at, s.index]), [
        ["LOAN", "PRINCIPALMINT", T0, 2], ["LOAN", "PRINCIPALMINT", T0 + 3600, 1],
    ]);
    assert.deepEqual([durationSecs(1, 0), durationSecs(1, 1), durationSecs(3, 2), durationSecs(1, 9)], [DAY, 7 * DAY, 90 * DAY, null]);
});

test("Loopscale rollover: a repay after the first term but inside the rolled one is on time", () => {
    const terms = { 0: DAY };
    const borrow = fakeTx({ top: [lsBorrow(300_000_000n, 0)], time: T0, sig: "b" });
    const roll = fakeTx({ top: [lsRefinance(0)], time: T0 + 20 * 3600, sig: "r" });
    const repay = fakeTx({ top: [lsRepayAll()], time: T0 + 36 * 3600, sig: "p" });
    const events = [borrow, repay].flatMap((tx) => loopscale.events(WALLET, tx));
    const withRoll = withLoopscaleDueDates(events, termStarts(WALLET, [borrow, roll, repay] as any), terms);
    const noRoll = withLoopscaleDueDates(events, termStarts(WALLET, [borrow, repay] as any), terms);
    assert.deepEqual(buildLoans(withRoll).map((l) => [l.outcome, l.dueAt]), [[0, T0 + 20 * 3600 + DAY]]);
    assert.deepEqual(buildLoans(noRoll).map((l) => [l.outcome, l.dueAt]), [[1, T0 + DAY]]);
});

test("Loopscale: liquidated after the grace = defaulted, before it = liquidated; an unknown index gets no due date", () => {
    const terms = { 0: DAY };
    const borrow = fakeTx({ top: [lsBorrow(300_000_000n, 0)], time: T0, sig: "b" });
    const liqAt = (t: number) => fakeTx({ top: [lsIx("liquidate_ledger", WALLET, 8, Buffer.from([0, 0, 0, 0, 0, 0]))], time: t, sig: `l${t}` });
    const outcome = (t: number, ts: Record<number, number> = terms) => {
        const txs = [borrow, liqAt(t)];
        const ev = withLoopscaleDueDates(txs.flatMap((tx) => loopscale.events(WALLET, tx)), termStarts(WALLET, txs as any), ts);
        return buildLoans(ev).map((l) => [l.outcome, l.dueAt]);
    };
    assert.deepEqual(outcome(T0 + 2 * DAY), [[2, T0 + DAY]]);
    assert.deepEqual(outcome(T0 + 4 * DAY), [[3, T0 + DAY]]);
    assert.deepEqual(outcome(T0 + 4 * DAY, {}), [[2, 0]]);
});

test("Loopscale: a further borrow into an open ledger keeps its due date; a borrow after a full repay starts a new term", () => {
    const terms = { 0: DAY };
    const txs = [
        fakeTx({ top: [lsBorrow(100_000_000n, 0)], time: T0, sig: "b1" }),
        fakeTx({ top: [lsBorrow(50_000_000n, 0)], time: T0 + 2 * 3600, sig: "b2" }),  // top-up
        fakeTx({ top: [lsRepayAll()], time: T0 + 23 * 3600, sig: "p1" }),
        fakeTx({ top: [lsBorrow(70_000_000n, 0)], time: T0 + 2 * DAY, sig: "b3" }),     // new term
        fakeTx({ top: [lsRepayAll()], time: T0 + 2 * DAY + 3600, sig: "p2" }),
    ];
    const events = txs.flatMap((tx) => loopscale.events(WALLET, tx));
    const loans = buildLoans(withLoopscaleDueDates(events, termStarts(WALLET, txs as any), terms));
    assert.deepEqual(loans.map((l) => [l.outcome, l.dueAt]), [[0, T0 + DAY], [0, T0 + 3 * DAY]]);
});
