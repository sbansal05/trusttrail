//! The devnet pool: program id, PDAs, collateral feeds, and the instructions the admin scripts send.
//! Seeds and account order follow programs/pool (init_pool, add_collateral, deposit).

import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { discriminator } from "../history/importTx";
import { TRUSTTRAIL_PROGRAM_ID, reputationPda, whitelistPda } from "../history/chain";
import { REPAYMENT_SCHEMA, SAS_CREDENTIAL, SAS_PROGRAM_ID, SAS_SIGNER, attestationPda } from "../score/attestations";

export const POOL_PROGRAM_ID = new PublicKey("Eg1s6qF3UhrUYuccyKy9pMBqDQd4beQjYYYZdGs4EkWL");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const TUSDC_DECIMALS = 6;

const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, POOL_PROGRAM_ID)[0];
export const poolPda = () => pda(Buffer.from("pool"));
export const vaultPda = () => pda(Buffer.from("vault"), poolPda().toBuffer());
export const lpMintPda = () => pda(Buffer.from("lp"), poolPda().toBuffer());
export const collateralConfigPda = (mint: PublicKey) => pda(Buffer.from("collateral"), mint.toBuffer());
export const collateralVaultPda = (mint: PublicKey) => pda(Buffer.from("coll"), poolPda().toBuffer(), mint.toBuffer());
export const borrowerStatePda = (borrower: PublicKey) => pda(Buffer.from("borrower"), borrower.toBuffer());
export function loanPda(borrower: PublicKey, loanId: bigint): PublicKey {
    const id = Buffer.alloc(8);
    id.writeBigUInt64LE(loanId);
    return pda(Buffer.from("loan"), borrower.toBuffer(), id);
}

/** BorrowerState: 8 discriminator, wallet 32, largest_repaid u64, next_loan_id u64, open_loans u16, bump. */
export function parseBorrowerState(data: Buffer): { largestRepaid: bigint; nextLoanId: bigint; openLoans: number } {
    return { largestRepaid: data.readBigUInt64LE(40), nextLoanId: data.readBigUInt64LE(48), openLoans: data.readUInt16LE(56) };
}

// ---------- Pyth ----------

/** Pyth's push-oracle program: it keeps the sponsored price feed accounts updated. */
export const PYTH_PUSH_ORACLE_ID = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
/** Pyth's receiver program: owner of every PriceUpdateV2 account (the pool checks this owner). */
export const PYTH_RECEIVER_ID = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");

export const FEED_IDS = {
    SOL_USD: Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex"),
    USDC_USD: Buffer.from("eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", "hex"),
};

/** The sponsored feed account for a feed: PDA [shard u16 LE, feed id] of the push oracle (shard 0). */
export function sponsoredFeedAccount(feedId: Buffer, shard = 0): PublicKey {
    const s = Buffer.alloc(2);
    s.writeUInt16LE(shard);
    return PublicKey.findProgramAddressSync([s, feedId], PYTH_PUSH_ORACLE_ID)[0];
}

export type PriceUpdate = { feedId: Buffer; price: bigint; conf: bigint; exponent: number; publishTime: number };

/**
 * PriceUpdateV2 (same layout the pool reads): 8 discriminator, 32 write_authority, verification level
 * (1 byte; the pool accepts only Full = 1), feed_id 32, price i64, conf u64, exponent i32, publish_time i64.
 */
const PRICE_UPDATE_V2_DISCRIMINATOR = Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]);

export function parsePriceUpdate(data: Buffer): PriceUpdate | null {
    if (data.length < 101 || !data.subarray(0, 8).equals(PRICE_UPDATE_V2_DISCRIMINATOR) || data[40] !== 1) return null;
    return {
        feedId: Buffer.from(data.subarray(41, 73)),
        price: data.readBigInt64LE(73),
        conf: data.readBigUInt64LE(81),
        exponent: data.readInt32LE(89),
        publishTime: Number(data.readBigInt64LE(93)),
    };
}

// ---------- Instructions ----------

const ro = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: false });
const rw = (pubkey: PublicKey) => ({ pubkey, isSigner: false, isWritable: true });

export function initPoolIx(authority: PublicKey, usdcMint: PublicKey): TransactionInstruction {
    return new TransactionInstruction({
        programId: POOL_PROGRAM_ID,
        keys: [
            { pubkey: authority, isSigner: true, isWritable: true },
            rw(poolPda()), ro(usdcMint), rw(vaultPda()), rw(lpMintPda()),
            ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId),
        ],
        data: discriminator("init_pool"),
    });
}

export type CollateralParams = { feedId: Buffer; minTier: number; maxAgeSecs: number; liqThresholdBps: number; liqBonusBps: number };

export function addCollateralIx(authority: PublicKey, mint: PublicKey, p: CollateralParams): TransactionInstruction {
    const args = Buffer.alloc(32 + 1 + 4 + 2 + 2);
    p.feedId.copy(args, 0);
    args.writeUInt8(p.minTier, 32);
    args.writeUInt32LE(p.maxAgeSecs, 33);
    args.writeUInt16LE(p.liqThresholdBps, 37);
    args.writeUInt16LE(p.liqBonusBps, 39);
    return new TransactionInstruction({
        programId: POOL_PROGRAM_ID,
        keys: [
            { pubkey: authority, isSigner: true, isWritable: true },
            ro(poolPda()), ro(mint), rw(collateralConfigPda(mint)), rw(collateralVaultPda(mint)),
            ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId),
        ],
        data: Buffer.concat([discriminator("add_collateral"), args]),
    });
}

export function depositIx(lender: PublicKey, lenderUsdc: PublicKey, lenderLp: PublicKey, amount: bigint): TransactionInstruction {
    const a = Buffer.alloc(8);
    a.writeBigUInt64LE(amount);
    return new TransactionInstruction({
        programId: POOL_PROGRAM_ID,
        keys: [
            { pubkey: lender, isSigner: true, isWritable: false },
            rw(poolPda()), rw(vaultPda()), rw(lpMintPda()), rw(lenderUsdc), rw(lenderLp), ro(TOKEN_PROGRAM_ID),
        ],
        data: Buffer.concat([discriminator("deposit"), a]),
    });
}

const u64s = (...ns: bigint[]) => {
    const b = Buffer.alloc(8 * ns.length);
    ns.forEach((n, i) => b.writeBigUInt64LE(n, 8 * i));
    return b;
};

/** borrow(amount, collateral_amount); `priceUpdate` is a fresh PriceUpdateV2 for the collateral's feed. */
export function borrowIx(o: {
    borrower: PublicKey; loanId: bigint; collateralMint: PublicKey; priceUpdate: PublicKey;
    borrowerCollateral: PublicKey; borrowerUsdc: PublicKey; amount: bigint; collateralAmount: bigint;
}): TransactionInstruction {
    return new TransactionInstruction({
        programId: POOL_PROGRAM_ID,
        keys: [
            { pubkey: o.borrower, isSigner: true, isWritable: true },
            rw(poolPda()), rw(vaultPda()), ro(reputationPda(o.borrower)), rw(borrowerStatePda(o.borrower)),
            rw(loanPda(o.borrower, o.loanId)), ro(collateralConfigPda(o.collateralMint)), rw(collateralVaultPda(o.collateralMint)),
            ro(o.priceUpdate), rw(o.borrowerCollateral), rw(o.borrowerUsdc),
            ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId),
        ],
        data: Buffer.concat([discriminator("borrow"), u64s(o.amount, o.collateralAmount)]),
    });
}

/** repay(): pays the whole debt, returns the collateral, and has TrustTrail write the score and the SAS record. */
export function repayIx(o: {
    borrower: PublicKey; loan: PublicKey; collateralMint: PublicKey; borrowerCollateral: PublicKey; borrowerUsdc: PublicKey;
}): TransactionInstruction {
    return new TransactionInstruction({
        programId: POOL_PROGRAM_ID,
        keys: [
            { pubkey: o.borrower, isSigner: true, isWritable: true },
            rw(poolPda()), rw(vaultPda()), rw(o.loan), rw(borrowerStatePda(o.borrower)),
            ro(collateralConfigPda(o.collateralMint)), rw(collateralVaultPda(o.collateralMint)),
            rw(o.borrowerCollateral), rw(o.borrowerUsdc),
            // ScoreAccounts, in the pool's order
            ro(whitelistPda()), rw(reputationPda(o.borrower)), ro(SAS_SIGNER), ro(SAS_CREDENTIAL), ro(REPAYMENT_SCHEMA),
            rw(attestationPda(o.loan)), ro(SAS_PROGRAM_ID), ro(TRUSTTRAIL_PROGRAM_ID),
            ro(TOKEN_PROGRAM_ID), ro(SystemProgram.programId),
        ],
        data: discriminator("repay"),
    });
}
