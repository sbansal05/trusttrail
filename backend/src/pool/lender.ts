//! The lender side of the pool: every loan the pool has made (open ones with their health, closed ones
//! counted by tier), a wallet's share of the pool, and the deposit and withdraw transactions
//! (built here, signed by the wallet, sent by the frontend).

import { PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { TIER_NAMES } from "../history/scoring";
import { POOL_PROGRAM_ID, depositIx, lpMintPda, withdrawIx } from "./accounts";
import {
    BPS, LOAN_DEFAULTED, LOAN_DISCRIMINATOR, LOAN_LIQUIDATED, LOAN_OPEN, LOAN_REPAID, assetsForShares, parseLoan,
    sharesForDeposit, sharesForWithdraw, totalAssets,
} from "./state";
import { PoolRequestError, b64, loanView, readMarket, tokenAmount, versioned, type Market, type PoolDeps } from "./service";

/** SPL Mint: mint_authority COption<Pubkey> (36 bytes), then supply u64. */
const mintSupply = (data: Buffer | undefined) => (data && data.length >= 44 ? data.readBigUInt64LE(36) : 0n);

// ---------- GET /pool/loans ----------

/** Every loan the pool has made, in one read: Loan accounts stay on chain after they close, with their status. */
export async function getPoolLoansView(deps: PoolDeps) {
    const m = await readMarket(deps);
    const accounts = await deps.connection.getProgramAccounts(POOL_PROGRAM_ID, {
        filters: [{ memcmp: { offset: 0, bytes: bs58.encode(LOAN_DISCRIMINATOR) } }],
    });
    const loans = accounts.map((a) => ({ address: a.pubkey, loan: parseLoan(a.account.data) }));
    const open = loans.filter((x) => x.loan.status === LOAN_OPEN).sort((a, b) => a.loan.openedAt - b.loan.openedAt);
    return {
        asOf: m.now,
        open: open.map(({ address, loan }) => ({ borrower: loan.borrower.toBase58(), ...loanView(m, address, loan) })),
        byTier: TIER_NAMES.map((name, tier) => {
            const of = loans.filter((x) => x.loan.tierAtOpen === tier);
            const count = (status: number) => of.filter((x) => x.loan.status === status).length;
            return {
                tier,
                name,
                loans: of.length,
                lentUsdc: of.reduce((sum, x) => sum + x.loan.principal, 0n).toString(),
                open: count(LOAN_OPEN),
                repaid: count(LOAN_REPAID),
                liquidated: count(LOAN_LIQUIDATED),
                defaulted: count(LOAN_DEFAULTED),
            };
        }),
    };
}

// ---------- GET /lender/:wallet ----------

type Position = { m: Market; usdcAta: PublicKey; lpAta: PublicKey; tusdc: bigint; shares: bigint; supply: bigint; assets: bigint };

/** The pool as the next instruction will see it, and this wallet's tUSDC and pool shares. */
async function readPosition(deps: PoolDeps, wallet: PublicKey): Promise<Position> {
    const m = await readMarket(deps);
    const usdcAta = getAssociatedTokenAddressSync(deps.usdcMint, wallet);
    const lpAta = getAssociatedTokenAddressSync(lpMintPda(), wallet);
    const [mintInfo, lpInfo, usdcInfo] = await deps.connection.getMultipleAccountsInfo([lpMintPda(), lpAta, usdcAta]);
    return {
        m, usdcAta, lpAta,
        tusdc: tokenAmount(usdcInfo?.data),
        shares: tokenAmount(lpInfo?.data),
        supply: mintSupply(mintInfo?.data),
        assets: totalAssets(m.pool, m.idle),
    };
}

export async function getLenderView(deps: PoolDeps, walletAddress: string) {
    const p = await readPosition(deps, new PublicKey(walletAddress));
    const value = assetsForShares(p.shares, p.assets, p.supply);
    return {
        wallet: walletAddress,
        asOf: p.m.now,
        tusdc: p.tusdc.toString(),
        shares: p.shares.toString(),
        valueUsdc: value.toString(),
        shareOfPoolBps: p.supply === 0n ? 0 : Number((p.shares * BPS) / p.supply),
        // A withdraw is paid from idle tUSDC only; what is lent out comes back as loans are repaid.
        withdrawableUsdc: (value < p.m.idle ? value : p.m.idle).toString(),
    };
}

// ---------- POST /deposit/prepare ----------

export async function prepareDeposit(deps: PoolDeps, walletAddress: string, amount: bigint) {
    const wallet = new PublicKey(walletAddress);
    if (amount <= 0n) throw new PoolRequestError(400, "amount must be above zero");
    const p = await readPosition(deps, wallet);
    if (p.tusdc < amount) throw new PoolRequestError(400, "not enough tUSDC to deposit", { need: amount.toString(), have: p.tusdc.toString() });
    const shares = sharesForDeposit(amount, p.assets, p.supply);
    if (shares === 0n) throw new PoolRequestError(400, "amount is too small for one share");
    const tx = await versioned(deps.connection, wallet, [
        createAssociatedTokenAccountIdempotentInstruction(wallet, p.lpAta, wallet, lpMintPda()),
        depositIx(wallet, p.usdcAta, p.lpAta, amount),
    ]);
    // The program accrues interest first, so the shares minted can be a hair fewer than this estimate.
    return { amountUsdc: amount.toString(), shares: shares.toString(), transactions: [b64(tx)] };
}

// ---------- POST /withdraw/prepare ----------

/** Either a tUSDC amount (turned into shares, rounded down) or every share the wallet holds. */
export type WithdrawRequest = { amount: bigint } | { all: true };

export async function prepareWithdraw(deps: PoolDeps, walletAddress: string, req: WithdrawRequest) {
    const wallet = new PublicKey(walletAddress);
    if ("amount" in req && req.amount <= 0n) throw new PoolRequestError(400, "amount must be above zero");
    const p = await readPosition(deps, wallet);
    if (p.shares === 0n) throw new PoolRequestError(400, "this wallet has no pool shares");
    const value = assetsForShares(p.shares, p.assets, p.supply);
    const shares = "all" in req ? p.shares : sharesForWithdraw(req.amount, p.assets, p.supply);
    if (shares === 0n) throw new PoolRequestError(400, "amount is too small for one share");
    if (shares > p.shares) throw new PoolRequestError(400, "more than this wallet's shares are worth", { valueUsdc: value.toString() });
    const payout = assetsForShares(shares, p.assets, p.supply);
    if (payout > p.m.idle) {
        throw new PoolRequestError(400, "the pool does not have that much idle tUSDC right now", { idleUsdc: p.m.idle.toString() });
    }
    const tx = await versioned(deps.connection, wallet, [
        createAssociatedTokenAccountIdempotentInstruction(wallet, p.usdcAta, wallet, deps.usdcMint),
        withdrawIx(wallet, p.usdcAta, p.lpAta, shares),
    ]);
    return { shares: shares.toString(), amountUsdc: payout.toString(), transactions: [b64(tx)] };
}