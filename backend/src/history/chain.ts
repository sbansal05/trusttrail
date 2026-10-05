//! Read-only TrustTrail lookups the import needs: the wallet's previous import date and the cluster time.

import { createHash } from "node:crypto";
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";

export const TRUSTTRAIL_PROGRAM_ID = new PublicKey("BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s");
const USER_REPUTATION_V2_SEED = Buffer.from("trust-v2");

/** Anchor account discriminator: first 8 bytes of sha256("account:<Name>"). */
const REPUTATION_DISCRIMINATOR = createHash("sha256").update("account:UserReputationV2").digest().subarray(0, 8);

/** UserReputationV2 layout: 8 discriminator, wallet (32), score, native_score, imported_score (u16 each), import_date (i64). */
const IMPORT_DATE_OFFSET = 8 + 32 + 2 + 2 + 2;

/** Clock sysvar layout: slot, epoch_start_timestamp, epoch, leader_schedule_epoch (8 bytes each), unix_timestamp (i64). */
const CLOCK_UNIX_TIMESTAMP_OFFSET = 32;

export function reputationPda(wallet: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync([USER_REPUTATION_V2_SEED, wallet.toBuffer()], TRUSTTRAIL_PROGRAM_ID)[0];
}

/** import_date from raw UserReputationV2 data. */
export function parseImportDate(data: Buffer): number {
    if (data.length < IMPORT_DATE_OFFSET + 8 || !data.subarray(0, 8).equals(REPUTATION_DISCRIMINATOR)) {
        throw new Error("not a UserReputationV2 account");
    }
    return Number(data.readBigInt64LE(IMPORT_DATE_OFFSET));
}

/** unix_timestamp from raw Clock sysvar data: the same value the program's Clock::get() sees. */
export function parseClockTime(data: Buffer): number {
    return Number(data.readBigInt64LE(CLOCK_UNIX_TIMESTAMP_OFFSET));
}

/** The wallet's previous import date, or 0 if it has never imported (or has no reputation account yet). */
export async function readImportDate(connection: Connection, wallet: PublicKey): Promise<number> {
    const info = await connection.getAccountInfo(reputationPda(wallet));
    if (!info) return 0;
    if (!info.owner.equals(TRUSTTRAIL_PROGRAM_ID)) throw new Error("reputation account has the wrong owner");
    return parseImportDate(info.data);
}

/** Cluster time from the Clock sysvar, so the decay uses the clock the program uses for import_date. */
export async function clusterTime(connection: Connection): Promise<number> {
    const info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY);
    if (!info) throw new Error("clock sysvar not found");
    return parseClockTime(info.data);
}