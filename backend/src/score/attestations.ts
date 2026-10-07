//! Native repayment records: the SAS attestations TrustTrail writes when a whitelisted lender's loan closes.
//! Found with one getProgramAccounts call, filtered on our schema, our signer and the borrower.

import { PublicKey, type Connection } from "@solana/web3.js";

export const SAS_PROGRAM_ID = new PublicKey("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
export const REPAYMENT_SCHEMA = new PublicKey("3q96PNm9Dv6wiR6ZkmJJDm9uUQZUKvqPH8su9Born1A9");
/** TrustTrail's PDA ["sas-signer"], the only signer on our credential. */
export const SAS_SIGNER = new PublicKey("H8NYeSriRSJ6BPQuLmtWsmcQutTvt2hVTuHoZBV9Ry6Y");

/**
 * SAS Attestation account: discriminator u8, nonce, credential, schema (32 each), data (u32 length + bytes),
 * signer (32), expiry i64, token_account (32). Our record is 116 bytes, so every offset is fixed.
 */
const SCHEMA_OFFSET = 1 + 32 + 32;
const DATA_OFFSET = SCHEMA_OFFSET + 32 + 4;
export const REPAYMENT_DATA_LEN = 116;
const SIGNER_OFFSET = DATA_OFFSET + REPAYMENT_DATA_LEN;
/** Inside the record, `borrower` is VecU8: a u32 length (32) and then the 32 bytes. */
const BORROWER_OFFSET = DATA_OFFSET + 4;

export type RepaymentRecord = {
    address: string;
    loan: string;            // the nonce: the pool's Loan account
    borrower: string;
    lenderProgram: string;
    principalUsdc: string;   // 6 decimals
    interestPaidUsdc: string;
    openedAt: number;
    dueAt: number;           // 0 = no due date
    closedAt: number;
    outcome: number;         // 0 on time, 1 late, 2 liquidated, 3 defaulted
    collateralRatioBps: number;
    tierAtOpen: number;
};

/** Decodes one attestation account; null if it is not a repayment record of ours. */
export function parseRepayment(address: string, data: Buffer): RepaymentRecord | null {
    if (data.length < SIGNER_OFFSET + 32) return null;
    if (!data.subarray(SCHEMA_OFFSET, SCHEMA_OFFSET + 32).equals(REPAYMENT_SCHEMA.toBuffer())) return null;
    if (!data.subarray(SIGNER_OFFSET, SIGNER_OFFSET + 32).equals(SAS_SIGNER.toBuffer())) return null;
    if (data.readUInt32LE(DATA_OFFSET - 4) !== REPAYMENT_DATA_LEN) return null;

    const key = (at: number) => new PublicKey(data.subarray(at, at + 32)).toBase58();
    let o = DATA_OFFSET;
    const vecKey = () => { const k = key(o + 4); o += 36; return k; };
    const u64 = () => { const v = data.readBigUInt64LE(o); o += 8; return v.toString(); };
    const i64 = () => { const v = Number(data.readBigInt64LE(o)); o += 8; return v; };
    const u8 = () => data.readUInt8(o++);
    const u16 = () => { const v = data.readUInt16LE(o); o += 2; return v; };
    return {
        address,
        loan: key(1),
        borrower: vecKey(), lenderProgram: vecKey(),
        principalUsdc: u64(), interestPaidUsdc: u64(),
        openedAt: i64(), dueAt: i64(), closedAt: i64(),
        outcome: u8(), collateralRatioBps: u16(), tierAtOpen: u8(),
    };
}

/** Every repayment record of a wallet, newest first. */
export async function repaymentsOf(
    connection: Pick<Connection, "getProgramAccounts">, wallet: PublicKey,
): Promise<RepaymentRecord[]> {
    const accounts = await connection.getProgramAccounts(SAS_PROGRAM_ID, {
        filters: [
            { memcmp: { offset: SCHEMA_OFFSET, bytes: REPAYMENT_SCHEMA.toBase58() } },
            { memcmp: { offset: BORROWER_OFFSET, bytes: wallet.toBase58() } },
            { memcmp: { offset: SIGNER_OFFSET, bytes: SAS_SIGNER.toBase58() } },
        ],
    });
    return accounts
        .map((a) => parseRepayment(a.pubkey.toBase58(), a.account.data))
        .filter((r): r is RepaymentRecord => r !== null)
        .sort((a, b) => b.closedAt - a.closedAt);
}
