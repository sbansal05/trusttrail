import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import bs58 from "bs58";
import { instructions, walletEvents, REPAY_ALL, type Tx } from "./common";
import { kamino } from "./kamino";
import { marginfi, MARGINFI_PROGRAM_ID } from "./marginfi";
import { save, SAVE_PROGRAM_ID } from "./save";
import { KAMINO_PROGRAM_ID } from "../../getObligations";
import { buildLoans } from "../buildLoans";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WALLET = "Wa11et1111111111111111111111111111111111111";
const WRAPPER = "Wrapper111111111111111111111111111111111111";
const T0 = 1_750_000_000;

type RawIx = { program: string; accounts: string[]; data: Buffer };

/** A transaction shaped like Helius returns it, built from addresses instead of indexes. */
function fakeTx(o: {
    top: RawIx[];
    inner?: { index: number; ixs: RawIx[] }[];
    tokens?: { account: string; mint: string; decimals: number }[];
    time?: number;
    sig?: string;
    err?: unknown;
}): Tx {
    const keys: string[] = [WALLET];
    const idx = (k: string) => (keys.includes(k) ? keys.indexOf(k) : keys.push(k) - 1);
    const enc = (ix: RawIx) => ({ programIdIndex: idx(ix.program), accounts: ix.accounts.map(idx), data: bs58.encode(ix.data) });
    const top = o.top.map(enc);
    const inner = (o.inner ?? []).map((g) => ({ index: g.index, instructions: g.ixs.map(enc) }));
    const balances = (o.tokens ?? []).map((t) => ({ accountIndex: idx(t.account), mint: t.mint, uiTokenAmount: { decimals: t.decimals } }));
    return {
        blockTime: o.time ?? T0,
        meta: { err: o.err ?? null, innerInstructions: inner, preTokenBalances: balances, postTokenBalances: balances, loadedAddresses: { writable: [], readonly: [] } },
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
