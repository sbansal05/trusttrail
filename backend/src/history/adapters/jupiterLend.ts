//! Jupiter Lend (borrow vaults): every deposit, withdraw, borrow and repay is one `operate(new_col, new_debt)`.
//! Liquidations are tick-based and never name a position, so they are found two ways:
//!   - a repay-everything that moved less than was borrowed (the rest was cleared by a liquidation), here;
//!   - the position's current state from the Jupiter SDK, in jupiterState.ts.

import type { CreditEvent } from "../types";
import { discriminator } from "../importTx";
import { REPAY_ALL, instructions, mintDecimals, signatureOf, timeOf, tokenBalanceChange, type Adapter, type Tx } from "./common";

export const JUPITER_VAULTS_PROGRAM_ID = "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi";

const OPERATE = discriminator("operate");

/** Account positions of `operate` from the vaults IDL. */
const SIGNER = 0;
const BORROW_TOKEN = 9;            // the borrowed mint
const POSITION = 11;
const VAULT_BORROW_TOKEN_ACCOUNT = 25;  // the liquidity layer's account for the borrowed token

/** i128::MIN = "repay the whole debt". */
export const MIN_I128 = -(2n ** 127n);

/** Little-endian i128 at `offset`. */
export function readI128(data: Buffer, offset: number): bigint {
    const lo = data.readBigUInt64LE(offset);
    const hi = data.readBigUInt64LE(offset + 8);
    return BigInt.asIntN(128, (hi << 64n) | lo);
}

export const jupiterLend: Adapter = {
    protocol: "jupiter_lend",
    events(wallet: string, tx: Tx): CreditEvent[] {
        const out: CreditEvent[] = [];
        for (const ix of instructions(tx)) {
            if (ix.program !== JUPITER_VAULTS_PROGRAM_ID || ix.data.length < 40) continue;
            if (!ix.data.subarray(0, 8).equals(OPERATE) || ix.accounts[SIGNER] !== wallet) continue;

            const newDebt = readI128(ix.data, 24); // after new_col (offset 8)
            if (newDebt === 0n) continue;          // collateral only
            const mint = ix.accounts[BORROW_TOKEN];
            const base = {
                protocol: "jupiter_lend" as const, wallet, position: ix.accounts[POSITION], mint,
                decimals: mintDecimals(tx, mint), timestamp: timeOf(tx), signature: signatureOf(tx), dueAt: 0,
            };
            if (newDebt > 0n) {
                out.push({ ...base, kind: "borrow", amount: newDebt });
            } else if (newDebt === MIN_I128) {
                // What actually reached the vault is the debt that was left, interest included.
                const paid = tokenBalanceChange(tx, ix.accounts[VAULT_BORROW_TOKEN_ACCOUNT]);
                out.push({ ...base, kind: "repay", amount: REPAY_ALL, ...(paid !== null && paid > 0n ? { paid } : {}) });
            } else {
                out.push({ ...base, kind: "repay", amount: -newDebt });
            }
        }
        return out;
    },
};
