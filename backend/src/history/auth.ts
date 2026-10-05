//! Proof that the caller owns the wallet before the backend spends API credits on it.
//! The wallet signs "TrustTrail import for <wallet> at <unix seconds>"; the signature is valid for 7 minutes.

import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";

export const SIGNED_MESSAGE_MAX_AGE_SECS = 7 * 60;

export function importMessage(wallet: string, timestamp: number): string {
    return `TrustTrail import for ${wallet} at ${timestamp}`;
}

/** True if `signature` (base58) is the wallet's signature of the import message, made within the last 7 minutes. */
export function verifyImportRequest(wallet: string, timestamp: number, signature: string, now: number): boolean {
    if (!Number.isInteger(timestamp) || Math.abs(now - timestamp) > SIGNED_MESSAGE_MAX_AGE_SECS) return false;
    try {
        return nacl.sign.detached.verify(
            new TextEncoder().encode(importMessage(wallet, timestamp)),
            bs58.decode(signature),
            new PublicKey(wallet).toBytes(),
        );
    } catch {
        return false;
    }
}