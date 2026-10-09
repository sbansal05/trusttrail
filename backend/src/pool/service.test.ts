import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, SystemProgram, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { FEED_IDS, POOL_PROGRAM_ID, WSOL_MINT, collateralConfigPda, loanPda, poolPda, sponsoredFeedAccount } from "./accounts";
import { LOAN_DISCRIMINATOR, WAD, accountDiscriminator } from "./state";
import { TRUSTTRAIL_PROGRAM_ID } from "../history/chain";
import {
    COLLATERAL_BUFFER_BPS, PoolRequestError, collateralAccount, getLoansView, getPoolView, prepareBorrow, prepareRepay, type PoolDeps,
} from "./service";

const U = 1_000_000n;
const NOW = 1_800_000_000;
const USDC = Keypair.generate().publicKey;
const VAULT = Keypair.generate().publicKey;
const SOL_PRICE = { price: 11_552_000_000n, conf: 0n, expo: -8 }; // $115.52, no confidence band, to keep the numbers round

type Info = { data: Buffer; owner: PublicKey; lamports: number; executable: boolean };
const info = (data: Buffer, owner = POOL_PROGRAM_ID): Info => ({ data, owner, lamports: 1, executable: false });

function poolData(o: { totalBorrowed?: bigint; silverScaled?: bigint; unprovenScaled?: bigint } = {}): Buffer {
    const d = Buffer.alloc(309);
    accountDiscriminator("PoolConfig").copy(d, 0);
    USDC.toBuffer().copy(d, 40);
    VAULT.toBuffer().copy(d, 72);
    d.writeBigUInt64LE(o.totalBorrowed ?? 0n, 136);
    d.writeBigInt64LE(BigInt(NOW), 152); // already accrued to now
    for (let t = 0; t < 4; t++) {
        d.writeBigUInt64LE(WAD & ((1n << 64n) - 1n), 160 + 16 * t);
        d.writeBigUInt64LE(WAD >> 64n, 168 + 16 * t);
    }
    d.writeBigUInt64LE(o.unprovenScaled ?? 0n, 224);
    d.writeBigUInt64LE(o.silverScaled ?? 0n, 224 + 32);
    [400, 200, 0, -150].forEach((s, t) => d.writeInt16LE(s, 288 + 2 * t));
    d.writeUInt16LE(1_000, 296);
    return d;
}

function collateralData(mint: PublicKey, feed: Buffer, decimals: number, threshold: number, bonus: number): Buffer {
    const d = Buffer.alloc(115);
    mint.toBuffer().copy(d, 8);
    feed.copy(d, 72);
    d[104] = 0;
    d.writeUInt32LE(60, 105);
    d[109] = decimals;
    d.writeUInt16LE(threshold, 110);
    d.writeUInt16LE(bonus, 112);
    return d;
}

function priceData(feed: Buffer, p: { price: bigint; conf: bigint; expo: number }): Buffer {
    const d = Buffer.alloc(134);
    Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]).copy(d, 0);
    d[40] = 1;
    feed.copy(d, 41);
    d.writeBigInt64LE(p.price, 73);
    d.writeBigUInt64LE(p.conf, 81);
    d.writeInt32LE(p.expo, 89);
    d.writeBigInt64LE(BigInt(NOW - 20), 93);
    return d;
}

const tokenData = (amount: bigint) => {
    const d = Buffer.alloc(165);
    d.writeBigUInt64LE(amount, 64);
    return d;
};

function loanData(o: { borrower: PublicKey; mint: PublicKey; collateral: bigint; scaled: bigint; dueAt: number; status?: number }): Buffer {
    const d = Buffer.alloc(149);
    LOAN_DISCRIMINATOR.copy(d, 0);
    o.borrower.toBuffer().copy(d, 8);
    d[48] = 0; // Unproven
    d.writeBigUInt64LE(100n * U, 49);
    d.writeBigUInt64LE(o.scaled, 73);
    o.mint.toBuffer().copy(d, 89);
    d.writeBigUInt64LE(o.collateral, 121);
    d.writeUInt16LE(15_000, 129);
    d.writeBigInt64LE(BigInt(o.dueAt - 30 * 86_400), 131);
    d.writeBigInt64LE(BigInt(o.dueAt), 139);
    d[147] = o.status ?? 0;
    return d;
}

function setup(o: { accounts?: [PublicKey, Info][]; lamports?: number; loans?: [PublicKey, Buffer][] } = {}) {
    const clock = Buffer.alloc(40);
    clock.writeBigInt64LE(BigInt(NOW), 32);
    const store = new Map<string, Info>([
        [poolPda().toBase58(), info(poolData())],
        [SYSVAR_CLOCK_PUBKEY.toBase58(), info(clock)],
        [VAULT.toBase58(), info(tokenData(10_000n * U), TOKEN_PROGRAM_ID)],
        [collateralConfigPda(WSOL_MINT).toBase58(), info(collateralData(WSOL_MINT, FEED_IDS.SOL_USD, 9, 11_000, 500))],
        [collateralConfigPda(USDC).toBase58(), info(collateralData(USDC, FEED_IDS.USDC_USD, 6, 10_500, 200))],
        [sponsoredFeedAccount(FEED_IDS.SOL_USD).toBase58(), info(priceData(FEED_IDS.SOL_USD, SOL_PRICE))],
        [sponsoredFeedAccount(FEED_IDS.USDC_USD).toBase58(), info(priceData(FEED_IDS.USDC_USD, { price: 100_000_000n, conf: 0n, expo: -8 }))],
    ]);
    for (const [k, v] of o.accounts ?? []) store.set(k.toBase58(), v);
    const built: TransactionInstruction[][] = [];
    const deps: PoolDeps = {
        usdcMint: USDC,
        connection: {
            async getAccountInfo(k: PublicKey) { return store.get(k.toBase58()) ?? null; },
            async getMultipleAccountsInfo(ks: PublicKey[]) { return ks.map((k) => store.get(k.toBase58()) ?? null); },
            async getProgramAccounts() { return (o.loans ?? []).map(([pubkey, data]) => ({ pubkey, account: info(data) })); },
            async getBalance() { return o.lamports ?? 5_000_000_000; },
            async getLatestBlockhash() { return { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 10 }; },
            async getMinimumBalanceForRentExemption() { return 2_039_280; },
        } as unknown as PoolDeps["connection"],
        latest: async (feed) => ({
            data: "UE5BVQ==", price: 115.52, expo: -8,
            lowPrice: feed.equals(FEED_IDS.SOL_USD) ? SOL_PRICE.price : 100_000_000n,
        }),
        buildWithPrice: async (_c, _payer, _feed, _data, build) => {
            built.push(build(Keypair.generate().publicKey));
            return [];
        },
    };
    return { deps, built };
}

const programOf = (ixs: TransactionInstruction[]) => ixs.map((ix) => ix.programId.toBase58());
const borrowArgs = (ix: TransactionInstruction) => [ix.data.readBigUInt64LE(8), ix.data.readBigUInt64LE(16)];

test("GET /pool: rates per tier from utilization, lender APY, collateral prices from the sponsored feeds", async () => {
    const { deps } = setup({ accounts: [[poolPda(), info(poolData({ totalBorrowed: 1_000n * U, unprovenScaled: 1_000n * U }))]] });
    const v = await getPoolView(deps);
    assert.equal(v.utilizationBps, 909); // 1,000 of 11,000
    assert.deepEqual(v.tiers.map((t) => t.aprBps), [633, 433, 233, 83]);
    assert.deepEqual(v.tiers.map((t) => t.maxLoanUsdc), ["100000000", "250000000", "1000000000", "5000000000"]);
    assert.equal(v.lenderApyBps, 51); // 1,000 at 6.33% × 90% ÷ 11,000
    assert.deepEqual(v.collaterals.map((c) => [c.symbol, c.price, c.liqThresholdBps]), [["SOL", 115.52, 11_000], ["tUSDC", 1, 10_500]]);
});

test("GET /loans: offer capped by the tier and the growth rule, open loan health and liquidation price", async () => {
    const me = Keypair.generate().publicKey;
    const loan = loanPda(me, 0n);
    const { deps } = setup({
        loans: [[loan, loanData({ borrower: me, mint: WSOL_MINT, collateral: 1_385_037_350n, scaled: 100n * U, dueAt: NOW - 86_400 })]],
        accounts: [[getAssociatedTokenAddressSync(USDC, me), info(tokenData(42n * U), TOKEN_PROGRAM_ID)]],
    });
    const v = await getLoansView(deps, me.toBase58());
    assert.deepEqual([v.offer.tierName, v.offer.maxLoanUsdc, v.offer.collateralBps, v.offer.aprBps], ["unproven", "100000000", 15_000, 600]);
    assert.equal(v.offer.hasScoreAccount, false);
    assert.equal(v.balances.tusdc, "42000000");
    const l = v.loans[0];
    assert.equal(l.address, loan.toBase58());
    assert.equal(l.debtUsdc, "100000000");
    assert.equal(l.healthBps, 15_999); // $159.9995 of collateral for $100 of debt
    assert.ok(Math.abs(l.liquidationPrice! - 79.42) < 0.01); // 110% of $100 ÷ 1.385 SOL
    assert.equal(l.state, "late", "a day past due, inside the 3-day grace");
});

test("borrow against SOL: default collateral = minimum + 5%, score account created, SOL wrapped, then borrow", async () => {
    const me = Keypair.generate().publicKey;
    const { deps, built } = setup();
    const r = await prepareBorrow(deps, { wallet: me.toBase58(), collateral: "SOL", amount: 100n * U });
    const min = BigInt(r.minCollateral);
    assert.equal(min, 1_298_476_455n); // $150 at $115.52, rounded up
    assert.equal(BigInt(r.collateralAmount), (min * (10_000n + COLLATERAL_BUFFER_BPS)) / 10_000n);
    const ixs = built[0];
    assert.equal(ixs.length, 6); // init score, tUSDC account, wSOL account, transfer, sync, borrow
    assert.ok(ixs[0].programId.equals(TRUSTTRAIL_PROGRAM_ID), "a new wallet gets its score account first");
    assert.equal(programOf(ixs).at(-1), POOL_PROGRAM_ID.toBase58());
    assert.deepEqual(borrowArgs(ixs.at(-1)!), [100n * U, BigInt(r.collateralAmount)]);
    assert.equal(r.loan, loanPda(me, 0n).toBase58());
});

test("borrow is refused below the minimum collateral, above the limit, or without enough SOL", async () => {
    const me = Keypair.generate().publicKey.toBase58();
    const { deps } = setup({ lamports: 100_000_000 });
    const refused = (p: Promise<unknown>, status: number, message: RegExp) =>
        assert.rejects(p, (e: unknown) => e instanceof PoolRequestError && e.status === status && message.test(e.message));
    await refused(prepareBorrow(deps, { wallet: me, collateral: "SOL", amount: 100n * U, collateralAmount: 1_000_000_000n }), 400, /not enough collateral/);
    await refused(prepareBorrow(deps, { wallet: me, collateral: "SOL", amount: 101n * U }), 400, /above this wallet's limit/);
    await refused(prepareBorrow(deps, { wallet: me, collateral: "SOL", amount: 100n * U }), 400, /not enough SOL/);
});

test("borrow against tUSDC: the collateral sits in the wallet's own seeded account, not the account the loan is paid into", async () => {
    const me = Keypair.generate().publicKey;
    const ata = getAssociatedTokenAddressSync(USDC, me);
    const { deps, built } = setup({ accounts: [[ata, info(tokenData(1_000n * U), TOKEN_PROGRAM_ID)]] });
    const r = await prepareBorrow(deps, { wallet: me.toBase58(), collateral: "tUSDC", amount: 100n * U });
    assert.equal(r.minCollateral, "150000000");
    const seeded = await collateralAccount(me);
    const ixs = built[0];
    assert.ok(ixs.some((ix) => ix.programId.equals(SystemProgram.programId) && ix.keys[1]?.pubkey.equals(seeded)), "seeded account created");
    const borrow = ixs.at(-1)!;
    assert.ok(borrow.keys[9].pubkey.equals(seeded) && borrow.keys[10].pubkey.equals(ata));

    const again = setup({ accounts: [[ata, info(tokenData(1_000n * U), TOKEN_PROGRAM_ID)], [seeded, info(tokenData(0n), TOKEN_PROGRAM_ID)]] });
    await prepareBorrow(again.deps, { wallet: me.toBase58(), collateral: "tUSDC", amount: 100n * U });
    assert.ok(!again.built[0].some((ix) => ix.programId.equals(SystemProgram.programId)), "an existing seeded account is reused");
});

test("repay: needs the debt in tUSDC, only the borrower may repay, returned collateral goes back to the wallet", async () => {
    const me = Keypair.generate().publicKey;
    const loan = loanPda(me, 0n);
    const ata = getAssociatedTokenAddressSync(USDC, me);
    const solLoan = info(loanData({ borrower: me, mint: WSOL_MINT, collateral: 1_385_037_350n, scaled: 100n * U, dueAt: NOW + 86_400 }));

    const poor = setup({ accounts: [[loan, solLoan], [ata, info(tokenData(100n * U), TOKEN_PROGRAM_ID)]] });
    await assert.rejects(prepareRepay(poor.deps, me.toBase58(), loan.toBase58()), (e: unknown) => e instanceof PoolRequestError && e.status === 400);
    await assert.rejects(
        prepareRepay(poor.deps, Keypair.generate().publicKey.toBase58(), loan.toBase58()),
        (e: unknown) => e instanceof PoolRequestError && e.status === 403,
    );

    const ok = setup({ accounts: [[loan, solLoan], [ata, info(tokenData(101n * U), TOKEN_PROGRAM_ID)]] });
    const r = await prepareRepay(ok.deps, me.toBase58(), loan.toBase58());
    assert.equal(r.debtUsdc, "100000000");
    const tx = VersionedTransaction.deserialize(Buffer.from(r.transactions[0], "base64"));
    const keys = tx.message.staticAccountKeys;
    const programs = tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex].toBase58());
    assert.equal(programs.length, 3); // wSOL account, repay, close wSOL (unwrap)
    assert.equal(programs[1], POOL_PROGRAM_ID.toBase58());
    assert.ok(keys[0].equals(me), "the wallet pays the fee");

    const usdcLoan = info(loanData({ borrower: me, mint: USDC, collateral: 157n * U, scaled: 100n * U, dueAt: NOW + 86_400 }));
    const t = setup({ accounts: [[loan, usdcLoan], [ata, info(tokenData(101n * U), TOKEN_PROGRAM_ID)]] });
    const rt = await prepareRepay(t.deps, me.toBase58(), loan.toBase58());
    const ttx = VersionedTransaction.deserialize(Buffer.from(rt.transactions[0], "base64"));
    assert.equal(ttx.message.compiledInstructions.length, 2); // repay, move the collateral back to the usual account
});