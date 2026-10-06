//! MarginFi v2: borrow, repay and liquidation, from top-level and inner instructions.
//! Two liquidation styles exist: `lending_account_liquidate` (classic), and the newer receivership one,
//! where `start_liquidation` opens a window in which the liquidator repays the account's debt itself.

import type { CreditEvent } from "../types";
import { discriminator } from "../importTx";
import { REPAY_ALL, instructions, signatureOf, timeOf, tokenAccountMint, type Adapter, type Tx } from "./common";

export const MARGINFI_PROGRAM_ID = "MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA";

/** Anchor discriminators (first 8 data bytes), as in the MarginFi IDL 0.1.8. */
const BORROW = discriminator("lending_account_borrow");
const REPAY = discriminator("lending_account_repay");
const LIQUIDATE = discriminator("lending_account_liquidate");
const START_LIQUIDATION = discriminator("start_liquidation");

/** Account positions from the IDL. */
const ACCOUNT = 1;            // borrow, repay: marginfi_account
const USER_TOKEN = 4;         // borrow: destination_token_account; repay: signer_token_account
const BORROW_VAULT = 6;       // borrow: liquidity_vault (the bank's, always listed)
const REPAY_VAULT = 5;        // repay: liquidity_vault
const LIQUIDATEE = 5;         // lending_account_liquidate: liquidatee_marginfi_account
const LIAB_VAULT = 7;         // lending_account_liquidate: the debt bank's liquidity vault
const START_ACCOUNT = 0;      // start_liquidation: marginfi_account

const is = (data: Buffer, d: Buffer) => data.subarray(0, 8).equals(d);

/** repay(amount: u64, repay_all: Option<bool>): Some(true) means "repay the whole debt". */
function repayAmount(data: Buffer): bigint {
    const repayAll = data.length >= 18 && data[16] === 1 && data[17] === 1;
    return repayAll ? REPAY_ALL : data.readBigUInt64LE(8);
}

export const marginfi: Adapter = {
    protocol: "marginfi",
    events(wallet: string, tx: Tx): CreditEvent[] {
        const out: CreditEvent[] = [];
        // Accounts under receivership liquidation in this transaction: their repays are liquidations.
        const inLiquidation = new Set<string>();
        const push = (kind: CreditEvent["kind"], position: string, tokenAccounts: string[], amount: bigint) => {
            const token = tokenAccountMint(tx, ...tokenAccounts);
            if (!token) return; // mint unknown: nothing we can price
            out.push({
                protocol: "marginfi", wallet, position, kind, mint: token.mint, amount, decimals: token.decimals,
                timestamp: timeOf(tx), signature: signatureOf(tx), dueAt: 0,
            });
        };

        for (const ix of instructions(tx)) {
            if (ix.program !== MARGINFI_PROGRAM_ID) continue;
            if (is(ix.data, START_LIQUIDATION)) {
                inLiquidation.add(ix.accounts[START_ACCOUNT]);
            } else if (is(ix.data, BORROW)) {
                push("borrow", ix.accounts[ACCOUNT], [ix.accounts[USER_TOKEN], ix.accounts[BORROW_VAULT]], ix.data.readBigUInt64LE(8));
            } else if (is(ix.data, REPAY)) {
                const position = ix.accounts[ACCOUNT];
                const kind = inLiquidation.has(position) ? "liquidation" : "repay";
                push(kind, position, [ix.accounts[USER_TOKEN], ix.accounts[REPAY_VAULT]], repayAmount(ix.data));
            } else if (is(ix.data, LIQUIDATE)) {
                push("liquidation", ix.accounts[LIQUIDATEE], [ix.accounts[LIAB_VAULT]], ix.data.readBigUInt64LE(8));
            }
        }
        return out;
    },
};
