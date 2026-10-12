# Lender Integration

TrustTrail is meant to be read by more than one lender. Any app can price a wallet from its TrustTrail record with one RPC call and no API key. A lender that wants its own loans to count can also become a writer.

Northwind, the demo lender at [`/partner`](https://trusttrail-ten.vercel.app/partner), does exactly what this page describes, in about 90 lines (`app/src/partner.ts`).

## Read a wallet's record

### 1. Derive the score account

```ts
import { PublicKey } from "@solana/web3.js";

const TRUSTTRAIL = new PublicKey("BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s");

const scoreAccount = (wallet: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("trust-v2"), wallet.toBuffer()], TRUSTTRAIL)[0];
```

### 2. Fetch and check it

```ts
const info = await connection.getAccountInfo(scoreAccount(wallet));
if (!info) return null; // never used TrustTrail: treat as Unproven
if (!info.owner.equals(TRUSTTRAIL) || info.data.length < 130) throw new Error("not a TrustTrail score account");
```

Only the TrustTrail program can create an account at that address, so the owner check is a second guard, not the main one.

### 3. Decode the fields you need

```ts
const v = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
const record = {
    score: v.getUint16(40, true),           // 0–1000
    tier: v.getUint8(54),                   // 0 Unproven, 1 Bronze, 2 Silver, 3 Gold
    onTime: v.getUint16(55, true),
    late: v.getUint16(57, true),
    liquidated: v.getUint16(59, true),      // liquidations and defaults
    lastLiquidation: Number(v.getBigInt64(63, true)),
    totalRepaidUsdc: v.getBigUint64(71, true),
    updatedAt: Number(v.getBigInt64(79, true)),
};
```

The full layout is in the [Programs Reference](programs-reference.md#score-account-userreputationv2).

### 4. Price it your own way

TrustTrail does not tell lenders what to charge. Northwind, for example, starts from its own base per tier and then adjusts from the counts:

| Tier | Northwind base APR | Base collateral |
| --- | --- | --- |
| Unproven | 9.0% | 160% |
| Bronze | 7.0% | 145% |
| Silver | 5.0% | 130% |
| Gold | 3.5% | 115% |

Then −0.5% APR per 3 on-time repays (at most −1.5%), +0.5% per late repay (at most +2%), +10% collateral after any liquidation, and a 2% APR floor.

## Cached or live?

`score` and `tier` in the account are cached at `updatedAt`. Two things can change them without a transaction: penalties keep fading, and the 90-day Silver/Gold block ends. The TrustTrail pool always recomputes at borrow time.

- For most pricing, the cached values are fine: they can only be **too strict**, never too generous (penalties only fade; blocks only end).
- To get the exact value for this second, recompute from the raw fields (`s_plus_bps`, `s_minus_bps`, `s_minus_at`, `exposure_bps`, `imported_score`, `meaningful_*`, `last_liquidation_date`) with the formulas in the [Scoring Model](scoring-model.md). `backend/src/history/scoring.ts` is a ready TypeScript version.
- Or call [`GET /score/:wallet`](api-reference.md#get-scorewallet), which does the recompute for you.

## Read individual repayment records

Each closed loan is a Solana Attestation Service attestation with fixed offsets. All of a wallet's TrustTrail records come back from one `getProgramAccounts` call on the SAS program:

```ts
const SAS = new PublicKey("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
const SCHEMA = new PublicKey("3q96PNm9Dv6wiR6ZkmJJDm9uUQZUKvqPH8su9Born1A9");
const SIGNER = new PublicKey("H8NYeSriRSJ6BPQuLmtWsmcQutTvt2hVTuHoZBV9Ry6Y"); // TrustTrail's ["sas-signer"] PDA

const SCHEMA_OFFSET = 1 + 32 + 32;           // discriminator, nonce, credential
const DATA_OFFSET = SCHEMA_OFFSET + 32 + 4;  // schema, data length
const accounts = await connection.getProgramAccounts(SAS, {
    filters: [
        { memcmp: { offset: SCHEMA_OFFSET, bytes: SCHEMA.toBase58() } },
        { memcmp: { offset: DATA_OFFSET + 4, bytes: wallet.toBase58() } },   // borrower
        { memcmp: { offset: DATA_OFFSET + 116, bytes: SIGNER.toBase58() } }, // signed by TrustTrail
    ],
});
```

Filtering on the signer matters: the TrustTrail credential's only authorized signer is TrustTrail's PDA, and only program code can sign for a PDA, so a record that passes all three filters was written by the TrustTrail program. The record fields are listed in the [Programs Reference](programs-reference.md#repayment-attestation). `backend/src/score/attestations.ts` has a full decoder.

## Write records as a lender

A lender's own loans can count toward the same score. The flow is the one the TrustTrail pool uses (`programs/pool/src/instructions/settle.rs`):

1. **Get whitelisted.** The TrustTrail admin calls `add_writer` with your writer key. For a program, use a PDA, so only your program code can sign. The whitelist holds at most 10 writers.
2. **When a loan closes, call `record_event`** in the same transaction, signed by your writer:

   | Argument | Value |
   | --- | --- |
   | `principal_usdc` | principal in micro-USDC |
   | `opened_at`, `due_at` | Unix seconds; `due_at = 0` if the loan has no due date (it then counts half) |
   | `outcome` | 0 on time, 1 late, 2 liquidated, 3 defaulted |
   | `loan` | a unique address for this loan; it is the attestation nonce, so it can be used once |
   | `interest_paid_usdc` | interest paid |
   | `collateral_ratio_bps`, `tier_at_open` | your loan's terms, stored in the attestation |

   Accounts: `writer` (signer), `whitelist`, `wallet` (the borrower), its score account, `payer` (signer, pays the attestation rent), TrustTrail's `sas_signer` PDA, the credential, the schema, the attestation PDA `["attestation", credential, schema, loan]` under SAS, the SAS program and the system program.
3. **Create the score account first** if the wallet has none: `init_score_v2` can be paid by anyone.

`record_event` uses the on-chain clock as the close time, so a writer cannot backdate a repayment. Everything else (principal, open date, outcome) comes from the writer, and the program does not check that the loan existed: the whitelist is the trust boundary, which is why only lenders the admin approves can write. See the [Security Model](security-model.md).