//! The import transaction: optional init_score_v2 (new wallet) + set_imported_score.
//! The wallet pays the fee and the rent; the backend writer key signs here, the wallet signs in the browser.

import { createHash } from "node:crypto";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TRUSTTRAIL_PROGRAM_ID, reputationPda, whitelistPda } from "./chain";
import type { ImportPlan } from "./importPlan";

/** Anchor instruction discriminator: first 8 bytes of sha256("global:<name>"). */
export function discriminator(name: string): Buffer {
    return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

const U16_MAX = 65_535;

/** Accounts in the same order as the program's InitScoreV2. */
export function initScoreV2Ix(wallet: PublicKey): TransactionInstruction {
    return new TransactionInstruction({
        programId: TRUSTTRAIL_PROGRAM_ID,
        keys: [
            { pubkey: wallet, isSigner: true, isWritable: true },             // payer
            { pubkey: wallet, isSigner: false, isWritable: false },           // wallet
            { pubkey: reputationPda(wallet), isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: discriminator("init_score_v2"),
    });
}

/** Accounts in the same order as the program's SetImportedScore; args: score u16, meaningful_on_time u16, meaningful_weight_bps u64. */
export function setImportedScoreIx(writer: PublicKey, wallet: PublicKey, plan: ImportPlan): TransactionInstruction {
    if (plan.meaningfulOnTime > U16_MAX) throw new Error("meaningfulOnTime does not fit in u16");
    const data = Buffer.alloc(8 + 2 + 2 + 8);
    discriminator("set_imported_score").copy(data, 0);
    data.writeUInt16LE(Number(plan.score), 8);
    data.writeUInt16LE(plan.meaningfulOnTime, 10);
    data.writeBigUInt64LE(plan.meaningfulWeightBps, 12);
    return new TransactionInstruction({
        programId: TRUSTTRAIL_PROGRAM_ID,
        keys: [
            { pubkey: writer, isSigner: true, isWritable: false },
            { pubkey: whitelistPda(), isSigner: false, isWritable: false },
            { pubkey: wallet, isSigner: true, isWritable: false },
            { pubkey: reputationPda(wallet), isSigner: false, isWritable: true },
        ],
        data,
    });
}

/** The import transaction, signed by the writer only. The wallet is the fee payer and signs later. */
export function buildImportTx(opts: {
    writer: Keypair;
    wallet: PublicKey;
    plan: ImportPlan;
    needsInit: boolean;
    blockhash: string;
    lastValidBlockHeight: number;
}): Transaction {
    const tx = new Transaction({ feePayer: opts.wallet, blockhash: opts.blockhash, lastValidBlockHeight: opts.lastValidBlockHeight });
    if (opts.needsInit) tx.add(initScoreV2Ix(opts.wallet));
    tx.add(setImportedScoreIx(opts.writer.publicKey, opts.wallet, opts.plan));
    tx.partialSign(opts.writer);
    return tx;
}