//! Read-only TrustTrail lookups: the wallet's score account and the cluster time.

import { createHash } from "node:crypto";
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";

export const TRUSTTRAIL_PROGRAM_ID = new PublicKey("BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s");
const USER_REPUTATION_V2_SEED = Buffer.from("trust-v2");
const WRITER_WHITELIST_SEED = Buffer.from("writer_whitelist");

/** Anchor account discriminator: first 8 bytes of sha256("account:<Name>"). */
const REPUTATION_DISCRIMINATOR = createHash("sha256").update("account:UserReputationV2").digest().subarray(0, 8);

/** UserReputationV2 layout: 8 discriminator, wallet (32), score, native_score, imported_score (u16 each), import_date (i64). */
const IMPORT_DATE_OFFSET = 8 + 32 + 2 + 2 + 2;

/** Clock sysvar layout: slot, epoch_start_timestamp, epoch, leader_schedule_epoch (8 bytes each), unix_timestamp (i64). */
const CLOCK_UNIX_TIMESTAMP_OFFSET = 32;

export function reputationPda(wallet: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([USER_REPUTATION_V2_SEED, wallet.toBuffer()], TRUSTTRAIL_PROGRAM_ID)[0];
}

export function whitelistPda(): PublicKey {
    return PublicKey.findProgramAddressSync([WRITER_WHITELIST_SEED], TRUSTTRAIL_PROGRAM_ID)[0];
}

function assertReputation(data: Buffer, minLength: number): void {
    if (data.length < minLength || !data.subarray(0, 8).equals(REPUTATION_DISCRIMINATOR)) {
        throw new Error("not a UserReputationV2 account");
    }
}

/** import_date from raw UserReputationV2 data. */
export function parseImportDate(data: Buffer): number {
    assertReputation(data, IMPORT_DATE_OFFSET + 8);
    return Number(data.readBigInt64LE(IMPORT_DATE_OFFSET));
}

/** Every UserReputationV2 field the score needs, in account order. */
export type Reputation = {
    wallet: string;
    score: number;
    nativeScore: number;
    importedScore: number;
    importDate: number;
    tier: number;
    loansRepaidOnTime: number;
    lateRepaidLoans: number;
    liquidatedLoans: number;
    currentOnTimeStreak: number;
    lastLiquidationDate: number;
    totalUsdcRepaid: bigint;
    lastUpdate: number;
    sPlusBps: bigint;
    sMinusBps: bigint;
    sMinusAt: number;
    exposureBps: bigint;
    meaningfulOnTime: number;
    meaningfulWeightBps: bigint;
};

/** Account size: 8 discriminator + 122 bytes of fields (bump last). */
export const REPUTATION_LEN = 130;

/** Reads the whole UserReputationV2 account (Borsh, little-endian, no padding). */
export function parseReputation(data: Buffer): Reputation {
    assertReputation(data, REPUTATION_LEN);
    let o = 8;
    const u8 = () => data.readUInt8(o++);
    const u16 = () => { const v = data.readUInt16LE(o); o += 2; return v; };
    const i64 = () => { const v = Number(data.readBigInt64LE(o)); o += 8; return v; };
    const u64 = () => { const v = data.readBigUInt64LE(o); o += 8; return v; };
    const wallet = new PublicKey(data.subarray(o, o + 32)).toBase58();
    o += 32;
    return {
        wallet,
        score: u16(), nativeScore: u16(), importedScore: u16(), importDate: i64(), tier: u8(),
        loansRepaidOnTime: u16(), lateRepaidLoans: u16(), liquidatedLoans: u16(), currentOnTimeStreak: u16(),
        lastLiquidationDate: i64(), totalUsdcRepaid: u64(), lastUpdate: i64(),
        sPlusBps: u64(), sMinusBps: u64(), sMinusAt: i64(), exposureBps: u64(),
        meaningfulOnTime: u16(), meaningfulWeightBps: u64(),
    };
}

/** The wallet's score account, or null if it has none. */
export async function fetchReputation(connection: ChainReader, wallet: PublicKey): Promise<Reputation | null> {
    const info = await connection.getAccountInfo(reputationPda(wallet));
    if (!info) return null;
    if (!info.owner.equals(TRUSTTRAIL_PROGRAM_ID)) throw new Error("reputation account has the wrong owner");
    return parseReputation(info.data);
}

/** unix_timestamp from raw Clock sysvar data: the same value the program's Clock::get() sees. */
export function parseClockTime(data: Buffer): number {
    return Number(data.readBigInt64LE(CLOCK_UNIX_TIMESTAMP_OFFSET));
}

/** Only the reads the import needs, so tests can pass a fake. */
export type ChainReader = Pick<Connection, "getAccountInfo">;

/** Whether the wallet's reputation account exists, and its import_date (0 = never imported). */
export async function readReputation(connection: ChainReader, wallet: PublicKey): Promise<{ exists: boolean; importDate: number }> {
    const info = await connection.getAccountInfo(reputationPda(wallet));
    if (!info) return { exists: false, importDate: 0 };
    if (!info.owner.equals(TRUSTTRAIL_PROGRAM_ID)) throw new Error("reputation account has the wrong owner");
    return { exists: true, importDate: parseImportDate(info.data) };
}

/** Cluster time from the Clock sysvar, so the decay uses the clock the program uses for import_date. */
export async function clusterTime(connection: ChainReader): Promise<number> {
    const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    if (!info) throw new Error("clock sysvar not found");
    return parseClockTime(info.data);
}
