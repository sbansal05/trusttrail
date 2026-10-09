//! What the frontend needs from the pool: its rates and limits, a wallet's offer and open loans with
//! their health, and the borrow and repay transactions (built here, signed by the wallet, sent by the frontend).

import {
    PublicKey, SystemProgram, SYSVAR_CLOCK_PUBKEY, TransactionMessage, VersionedTransaction,
    type Connection, type TransactionInstruction,
} from "@solana/web3.js";
import {
    ACCOUNT_SIZE, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction,
    createInitializeAccount3Instruction, createSyncNativeInstruction, createTransferInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { fetchReputation, parseClockTime } from "../history/chain";
import { initScoreV2Ix } from "../history/importTx";
import { TIER_NAMES } from "../history/scoring";
import { standing } from "../score/standing";
import {
    POOL_PROGRAM_ID, WSOL_MINT, borrowIx, borrowerStatePda, collateralConfigPda, loanPda, parseBorrowerState,
    parsePriceUpdate, poolPda, repayIx, sponsoredFeedAccount,
} from "./accounts";
import type { HermesUpdate } from "./freshPrice";
import {
    BPS, DEFAULT_GRACE_SECS, LOAN_BORROWER_OFFSET, LOAN_DISCRIMINATOR, LOAN_OPEN, LOAN_STATUS_OFFSET, TIER_COLLATERAL_BPS,
    TIER_MAX_LOAN, accrue, collateralValue, debtNow, lenderApyBps, maxLoan, minCollateral, parseCollateral, parseLoan,
    parsePool, tierRatesBps, utilizationBps, type CollateralState, type LoanState, type PoolState,
} from "./state";

export const COLLATERAL_BUFFER_BPS = 500n;
export const COLLATERAL_ACCOUNT_SEED = "trusttrail-collateral";
export const SOL_FEE_RESERVE = 20_000_000n;
export const REPAY_MARGIN = 10_000n;

export const SYMBOLS = ["SOL", "tUSDC"] as const;
export type CollateralSymbol = (typeof SYMBOLS)[number];

export class PoolRequestError extends Error {
    status: number;
    details: Record<string, unknown>;
    constructor(status: number, message: string, details: Record<string, unknown> = {}) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

export type PoolDeps = {
    connection: Connection;
    usdcMint: PublicKey;
    latest: (feedId: Buffer) => Promise<HermesUpdate>;
    buildWithPrice: (
        connection: Connection, payer: PublicKey, feedId: Buffer, data: string, build: (priceUpdate: PublicKey) => TransactionInstruction[],
    ) => Promise<VersionedTransaction[]>;
};

const mintOf = (deps: PoolDeps, s: CollateralSymbol) => (s === "SOL" ? WSOL_MINT : deps.usdcMint);
export const collateralAccount = (wallet: PublicKey) => PublicKey.createWithSeed(wallet, COLLATERAL_ACCOUNT_SEED, TOKEN_PROGRAM_ID);
const tokenAmount = (data: Buffer | undefined) => (data && data.length >= 72 ? data.readBigUInt64LE(64) : 0n);
const b64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");

type Collateral = CollateralState & { symbol: CollateralSymbol; price: number | null; lowPrice: bigint | null; expo: number; publishTime: number | null };

type Market = { now: number; pool: PoolState; idle: bigint; rates: bigint[]; collaterals: Collateral[] };

async function readMarket(deps: PoolDeps): Promise<Market> {
    const mints = SYMBOLS.map((s) => mintOf(deps, s));
    const [poolInfo, clock, ...cfgInfos] = await deps.connection.getMultipleAccountsInfo([
        poolPda(), SYSVAR_CLOCK_PUBKEY, ...mints.map(collateralConfigPda),
    ]);
    if (!poolInfo || !clock) throw new Error("pool or clock account not found");
    const stored = parsePool(poolInfo.data);
    const cfgs = cfgInfos.map((info, i) => {
        if (!info) throw new Error(`collateral ${SYMBOLS[i]} is not configured`);
        return parseCollateral(info.data);
    });
    const [vaultInfo, ...feedInfos] = await deps.connection.getMultipleAccountsInfo([
        stored.vault, ...cfgs.map((c) => sponsoredFeedAccount(c.feedId)),
    ]);
    const now = parseClockTime(clock.data);
    const idle = tokenAmount(vaultInfo?.data);
    const pool = accrue(stored, now, idle);
    const collaterals = cfgs.map((c, i): Collateral => {
        const p = feedInfos[i] ? parsePriceUpdate(feedInfos[i]!.data) : null;
        return {
            ...c,
            symbol: SYMBOLS[i],
            price: p ? Number(p.price) * 10 ** p.exponent : null,
            lowPrice: p ? p.price - p.conf : null,
            expo: p ? p.exponent : 0,
            publishTime: p ? p.publishTime : null,
        };
    });
    return { now, pool, idle, rates: tierRatesBps(pool, idle), collaterals };
}

// ---------- GET /pool ----------

export async function getPoolView(deps: PoolDeps) {
    const m = await readMarket(deps);
    return {
        pool: poolPda().toBase58(),
        asOf: m.now,
        idleUsdc: m.idle.toString(),
        totalBorrowedUsdc: m.pool.totalBorrowed.toString(),
        totalAssetsUsdc: (m.idle + m.pool.totalBorrowed - m.pool.protocolFees).toString(),
        badDebtUsdc: m.pool.badDebt.toString(),
        utilizationBps: Number(utilizationBps(m.pool.totalBorrowed, m.idle)),
        lenderApyBps: Number(lenderApyBps(m.pool, m.idle)),
        reserveFactorBps: Number(m.pool.reserveFactorBps),
        tiers: TIER_NAMES.map((name, t) => ({
            tier: t,
            name,
            aprBps: Number(m.rates[t]),
            maxLoanUsdc: TIER_MAX_LOAN[t].toString(),
            collateralBps: Number(TIER_COLLATERAL_BPS[t]),
        })),
        collaterals: m.collaterals.map(collateralView),
    };
}

function collateralView(c: Collateral) {
    return {
        symbol: c.symbol,
        mint: c.mint.toBase58(),
        decimals: c.decimals,
        minTier: c.minTier,
        liqThresholdBps: c.liqThresholdBps,
        liqBonusBps: c.liqBonusBps,
        maxAgeSecs: c.maxAgeSecs,
        price: c.price,
        priceAt: c.publishTime,
    };
}

// ---------- GET /loans/:wallet ----------

type Borrower = { tier: number; hasScoreAccount: boolean; largestRepaid: bigint; nextLoanId: bigint };

async function readBorrower(deps: PoolDeps, wallet: PublicKey, now: number): Promise<Borrower> {
    const [rep, stateInfo] = await Promise.all([
        fetchReputation(deps.connection, wallet),
        deps.connection.getAccountInfo(borrowerStatePda(wallet)),
    ]);
    const bs = stateInfo ? parseBorrowerState(stateInfo.data) : null;
    return {
        tier: rep ? standing(rep, now).tier : 0,
        hasScoreAccount: rep !== null,
        largestRepaid: bs?.largestRepaid ?? 0n,
        nextLoanId: bs?.nextLoanId ?? 0n,
    };
}

async function openLoans(deps: PoolDeps, wallet: PublicKey): Promise<{ address: PublicKey; loan: LoanState }[]> {
    const accounts = await deps.connection.getProgramAccounts(POOL_PROGRAM_ID, {
        filters: [
            { memcmp: { offset: 0, bytes: bs58.encode(LOAN_DISCRIMINATOR) } },
            { memcmp: { offset: LOAN_BORROWER_OFFSET, bytes: wallet.toBase58() } },
            { memcmp: { offset: LOAN_STATUS_OFFSET, bytes: bs58.encode(Buffer.from([LOAN_OPEN])) } },
        ],
    });
    return accounts
        .map((a) => ({ address: a.pubkey, loan: parseLoan(a.account.data) }))
        .sort((a, b) => a.loan.openedAt - b.loan.openedAt);
}

function loanView(m: Market, address: PublicKey, l: LoanState) {
    const debt = debtNow(l.scaledDebt, m.pool.tierIndex[l.tierAtOpen]);
    const c = m.collaterals.find((x) => x.mint.equals(l.collateralMint));
    const value = c && c.lowPrice !== null ? collateralValue(l.collateralAmount, c.decimals, c.lowPrice, c.expo) : null;
    const threshold = c ? BigInt(c.liqThresholdBps) : null;
    // Price per collateral token at which value = debt × threshold.
    const liquidationPrice =
        c && threshold !== null && l.collateralAmount > 0n
            ? (Number(debt) * Number(threshold)) / Number(BPS) / 1e6 / (Number(l.collateralAmount) / 10 ** c.decimals)
            : null;
    const graceEndsAt = l.dueAt + DEFAULT_GRACE_SECS;
    return {
        address: address.toBase58(),
        loanId: l.loanId.toString(),
        tierAtOpen: l.tierAtOpen,
        principalUsdc: l.principal.toString(),
        debtUsdc: debt.toString(),
        aprBps: Number(m.rates[l.tierAtOpen]),
        collateral: {
            symbol: c?.symbol ?? l.collateralMint.toBase58(),
            mint: l.collateralMint.toBase58(),
            amount: l.collateralAmount.toString(),
            decimals: c?.decimals ?? 0,
            valueUsdc: value?.toString() ?? null,
            price: c?.price ?? null,
        },
        collateralRatioBps: l.collateralRatioBps,
        healthBps: value !== null && debt > 0n ? Number((value * BPS) / debt) : null,
        liqThresholdBps: c?.liqThresholdBps ?? null,
        liquidationPrice,
        openedAt: l.openedAt,
        dueAt: l.dueAt,
        graceEndsAt,
        state: m.now <= l.dueAt ? "active" : m.now <= graceEndsAt ? "late" : "defaulted",
    };
}

export async function getLoansView(deps: PoolDeps, walletAddress: string) {
    const wallet = new PublicKey(walletAddress);
    const m = await readMarket(deps);
    const usdcAta = getAssociatedTokenAddressSync(deps.usdcMint, wallet);
    const [b, loans, lamports, usdcInfo] = await Promise.all([
        readBorrower(deps, wallet, m.now),
        openLoans(deps, wallet),
        deps.connection.getBalance(wallet),
        deps.connection.getAccountInfo(usdcAta),
    ]);
    const limit = maxLoan(b.tier, b.largestRepaid);
    return {
        wallet: walletAddress,
        asOf: m.now,
        balances: { solLamports: String(lamports), tusdc: tokenAmount(usdcInfo?.data).toString() },
        offer: {
            tier: b.tier,
            tierName: TIER_NAMES[b.tier],
            hasScoreAccount: b.hasScoreAccount,
            maxLoanUsdc: (limit < m.idle ? limit : m.idle).toString(),
            tierMaxLoanUsdc: TIER_MAX_LOAN[b.tier].toString(),
            largestRepaidUsdc: b.largestRepaid.toString(),
            collateralBps: Number(TIER_COLLATERAL_BPS[b.tier]),
            aprBps: Number(m.rates[b.tier]),
            collateralBufferBps: Number(COLLATERAL_BUFFER_BPS),
            collaterals: m.collaterals.filter((c) => c.minTier <= b.tier).map(collateralView),
        },
        loans: loans.map(({ address, loan }) => loanView(m, address, loan)),
    };
}

// ---------- POST /borrow/prepare ----------

export type BorrowRequest = { wallet: string; collateral: CollateralSymbol; amount: bigint; collateralAmount?: bigint };

async function versioned(connection: Connection, payer: PublicKey, instructions: TransactionInstruction[]): Promise<VersionedTransaction> {
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    return new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message());
}

export async function prepareBorrow(deps: PoolDeps, req: BorrowRequest) {
    const wallet = new PublicKey(req.wallet);
    const m = await readMarket(deps);
    const c = m.collaterals.find((x) => x.symbol === req.collateral);
    if (!c) throw new PoolRequestError(400, "unknown collateral");
    const b = await readBorrower(deps, wallet, m.now);
    if (c.minTier > b.tier) throw new PoolRequestError(400, `${c.symbol} collateral needs a higher tier`);

    const limit = maxLoan(b.tier, b.largestRepaid);
    if (req.amount <= 0n) throw new PoolRequestError(400, "amount must be above zero");
    if (req.amount > limit) throw new PoolRequestError(400, "amount is above this wallet's limit", { maxLoanUsdc: limit.toString() });
    if (req.amount > m.idle) throw new PoolRequestError(400, "the pool does not have that much to lend", { idleUsdc: m.idle.toString() });

    // The pool values collateral at price − confidence of the update posted with this borrow, so size it from that same update.
    const update = await deps.latest(c.feedId);
    const ratio = TIER_COLLATERAL_BPS[b.tier];
    const minimum = minCollateral(req.amount, ratio, c.decimals, update.lowPrice, update.expo);
    const collateralAmount = req.collateralAmount ?? (minimum * (BPS + COLLATERAL_BUFFER_BPS)) / BPS;
    if (collateralAmount < minimum) {
        throw new PoolRequestError(400, "not enough collateral for this tier", { minCollateral: minimum.toString() });
    }

    const usdcAta = getAssociatedTokenAddressSync(deps.usdcMint, wallet);
    const setup: TransactionInstruction[] = [];
    if (!b.hasScoreAccount) setup.push(initScoreV2Ix(wallet));
    setup.push(createAssociatedTokenAccountIdempotentInstruction(wallet, usdcAta, wallet, deps.usdcMint));

    let borrowerCollateral: PublicKey;
    if (c.symbol === "SOL") {
        const lamports = BigInt(await deps.connection.getBalance(wallet));
        if (lamports < collateralAmount + SOL_FEE_RESERVE) {
            throw new PoolRequestError(400, "not enough SOL for this collateral and the fees", {
                needLamports: (collateralAmount + SOL_FEE_RESERVE).toString(), haveLamports: lamports.toString(),
            });
        }
        borrowerCollateral = getAssociatedTokenAddressSync(WSOL_MINT, wallet);
        setup.push(
            createAssociatedTokenAccountIdempotentInstruction(wallet, borrowerCollateral, wallet, WSOL_MINT),
            SystemProgram.transfer({ fromPubkey: wallet, toPubkey: borrowerCollateral, lamports: collateralAmount }),
            createSyncNativeInstruction(borrowerCollateral),
        );
    } else {
        // The wallet's own collateral account, kept apart from the account the loan is paid into.
        borrowerCollateral = await collateralAccount(wallet);
        const [ataInfo, accInfo] = await deps.connection.getMultipleAccountsInfo([usdcAta, borrowerCollateral]);
        const have = tokenAmount(ataInfo?.data);
        if (have < collateralAmount) {
            throw new PoolRequestError(400, "not enough tUSDC for this collateral", { need: collateralAmount.toString(), have: have.toString() });
        }
        if (!accInfo) {
            setup.push(
                SystemProgram.createAccountWithSeed({
                    fromPubkey: wallet, basePubkey: wallet, seed: COLLATERAL_ACCOUNT_SEED, newAccountPubkey: borrowerCollateral,
                    lamports: await deps.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE), space: ACCOUNT_SIZE,
                    programId: TOKEN_PROGRAM_ID,
                }),
                createInitializeAccount3Instruction(borrowerCollateral, deps.usdcMint, wallet),
            );
        }
        setup.push(createTransferInstruction(usdcAta, borrowerCollateral, wallet, collateralAmount));
    }

    const loan = loanPda(wallet, b.nextLoanId);
    const txs = await deps.buildWithPrice(deps.connection, wallet, c.feedId, update.data, (priceUpdate) => [
        ...setup,
        borrowIx({
            borrower: wallet, loanId: b.nextLoanId, collateralMint: c.mint, priceUpdate,
            borrowerCollateral, borrowerUsdc: usdcAta, amount: req.amount, collateralAmount,
        }),
    ]);
    return {
        loan: loan.toBase58(),
        amountUsdc: req.amount.toString(),
        collateral: c.symbol,
        collateralAmount: collateralAmount.toString(),
        minCollateral: minimum.toString(),
        price: update.price,
        transactions: txs.map(b64),
    };
}

// ---------- POST /repay/prepare ----------

export async function prepareRepay(deps: PoolDeps, walletAddress: string, loanAddress: string) {
    const wallet = new PublicKey(walletAddress);
    const loanKey = new PublicKey(loanAddress);
    const m = await readMarket(deps);
    const usdcAta = getAssociatedTokenAddressSync(deps.usdcMint, wallet);
    const [loanInfo, ataInfo] = await deps.connection.getMultipleAccountsInfo([loanKey, usdcAta]);
    if (!loanInfo || !loanInfo.owner.equals(POOL_PROGRAM_ID) || !loanInfo.data.subarray(0, 8).equals(LOAN_DISCRIMINATOR)) {
        throw new PoolRequestError(404, "loan not found");
    }
    const l = parseLoan(loanInfo.data);
    if (!l.borrower.equals(wallet)) throw new PoolRequestError(403, "this loan belongs to another wallet");
    if (l.status !== LOAN_OPEN) throw new PoolRequestError(400, "this loan is already closed");

    const debt = debtNow(l.scaledDebt, m.pool.tierIndex[l.tierAtOpen]);
    const have = tokenAmount(ataInfo?.data);
    if (have < debt + REPAY_MARGIN) {
        throw new PoolRequestError(400, "not enough tUSDC to repay", { need: (debt + REPAY_MARGIN).toString(), have: have.toString() });
    }

    const isSol = l.collateralMint.equals(WSOL_MINT);
    const borrowerCollateral = isSol ? getAssociatedTokenAddressSync(WSOL_MINT, wallet) : await collateralAccount(wallet);
    const ixs: TransactionInstruction[] = [];
    if (isSol) ixs.push(createAssociatedTokenAccountIdempotentInstruction(wallet, borrowerCollateral, wallet, WSOL_MINT));
    ixs.push(repayIx({ borrower: wallet, loan: loanKey, collateralMint: l.collateralMint, borrowerCollateral, borrowerUsdc: usdcAta }));
    // Hand the returned collateral back to the wallet: unwrap SOL, or move tUSDC back to its usual account.
    ixs.push(
        isSol
            ? createCloseAccountInstruction(borrowerCollateral, wallet, wallet)
            : createTransferInstruction(borrowerCollateral, usdcAta, wallet, l.collateralAmount),
    );
    return { loan: loanAddress, debtUsdc: debt.toString(), transactions: [b64(await versioned(deps.connection, wallet, ixs))] };
}