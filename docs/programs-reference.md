# Programs Reference

Both programs are Anchor 1.1 programs on Solana devnet. Amounts are in base units (USDC and tUSDC have 6 decimals); times are Unix seconds from the on-chain clock; `bps` means 1/10,000.

| Program | ID |
| --- | --- |
| TrustTrail | `BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s` |
| Pool | `Eg1s6qF3UhrUYuccyKy9pMBqDQd4beQjYYYZdGs4EkWL` |

## TrustTrail program

### PDAs

| Account | Seeds |
| --- | --- |
| GlobalConfig | `["global-config"]` |
| Score account (UserReputationV2) | `["trust-v2", wallet]` |
| Writer whitelist | `["writer_whitelist"]` |
| SAS signer | `["sas-signer"]` |
| v1 score (legacy) | `["trust-v1", wallet]` |

### Instructions

| Instruction | Arguments | Signers | What it does |
| --- | --- | --- | --- |
| `initialize` | | authority | Creates GlobalConfig; the signer becomes the admin. |
| `init_score_v2` | | payer | Creates the score account for `wallet` (anyone may pay the rent). Tier starts at Unproven. |
| `init_writer_whitelist` | | admin | Creates the empty whitelist. |
| `add_writer` | `writer: Pubkey` | admin | Adds a writer. At most 10; no duplicates. |
| `remove_writer` | `writer: Pubkey` | admin | Removes a writer, for example a leaked key. |
| `record_event` | `principal_usdc: u64, opened_at: i64, due_at: i64, outcome: u8, loan: Pubkey, interest_paid_usdc: u64, collateral_ratio_bps: u16, tier_at_open: u8` | writer, payer | Scores one closed loan (closed now) and writes its SAS attestation with `loan` as the nonce. `due_at = 0` means no due date. |
| `set_imported_score` | `score: u16, meaningful_on_time: u16, meaningful_weight_bps: u64` | writer, wallet | Sets the imported score (0–1000) and adds the meaningful counts. Once every 15 days per wallet. |
| `update_score` | `new_score: u16, mask: u64, new_flags: u8` | admin | v1 only. Writes the legacy v1 account; nothing in the current app reads it. |

`record_event` outcomes: `0` on time, `1` late, `2` liquidated, `3` defaulted.

### Score account: UserReputationV2

130 bytes including the 8-byte discriminator. Borsh, little-endian, fixed offsets:

| Offset | Field | Type | Meaning |
| --- | --- | --- | --- |
| 8 | `wallet` | Pubkey | Owner of this record |
| 40 | `score` | u16 | Final score 0–1000, cached at `last_update` |
| 42 | `native_score` | u16 | Score from TrustTrail loans only |
| 44 | `imported_score` | u16 | Score from imported history |
| 46 | `import_date` | i64 | Last import, 0 if never |
| 54 | `tier` | u8 | 0 Unproven, 1 Bronze, 2 Silver, 3 Gold, cached |
| 55 | `loans_repaid_on_time` | u16 | Count |
| 57 | `late_repaid_loans` | u16 | Count |
| 59 | `liquidated_loans` | u16 | Count of liquidations **and** defaults |
| 61 | `current_on_time_streak` | u16 | Resets on any late, liquidated or defaulted loan |
| 63 | `last_liquidation_date` | i64 | 0 if never; starts the 90-day block |
| 71 | `total_usdc_repaid` | u64 | Principal repaid (on time or late) |
| 79 | `last_update` | i64 | When the cached fields were last written |
| 87 | `s_plus_bps` | u64 | S⁺, uncapped |
| 95 | `s_minus_bps` | u64 | S⁻ as of `s_minus_at` |
| 103 | `s_minus_at` | i64 | When S⁻ was last decayed |
| 111 | `exposure_bps` | u64 | E, Σw of every closed native loan |
| 119 | `meaningful_on_time` | u16 | Native + imported meaningful on-time loans |
| 121 | `meaningful_weight_bps` | u64 | Σw of those loans |
| 129 | `bump` | u8 | |

### Writer whitelist

`signers: Vec<Pubkey>` (max 10) and `bump`. Today it holds the pool program's PDA (`["pool"]` under the pool program) and the backend's import key.

### Repayment attestation

Written through the Solana Attestation Service (`22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG`).

| | Address |
| --- | --- |
| Credential `trusttrail` | `HqhwM4J9UoJBq2HGBPn32QN1y7gkASPdX5nxBLCY5sje` |
| Schema `trusttrail-repayment` v1 | `3q96PNm9Dv6wiR6ZkmJJDm9uUQZUKvqPH8su9Born1A9` |
| Signer (TrustTrail PDA `["sas-signer"]`) | `H8NYeSriRSJ6BPQuLmtWsmcQutTvt2hVTuHoZBV9Ry6Y` |
| Attestation PDA | `["attestation", credential, schema, loan]` under SAS |

Record data, 116 bytes, in schema order:

| Field | Type |
| --- | --- |
| `borrower` | 32 bytes (u32 length + Pubkey) |
| `lender_program` | 32 bytes (u32 length + Pubkey), the writer |
| `principal_usdc` | u64 |
| `interest_paid_usdc` | u64 |
| `opened_at`, `due_at`, `closed_at` | i64 each |
| `outcome` | u8 |
| `collateral_ratio_bps` | u16 |
| `tier_at_open` | u8 |

Attestations never expire (expiry 0).

### TrustTrail errors

| Code | Name | When |
| --- | --- | --- |
| 6000 | `Unauthorized` | unused (admin checks fail with Anchor's own `has_one` / `require_keys_eq` errors) |
| 6001 | `CounterOverflow` | unused |
| 6002 | `WriterWhiteListOverflow` | an 11th writer |
| 6003 | `NameAlreadyInWhiteWriterList` | adding a writer twice |
| 6004 | `SignerNotApproved` | the writer is not on the whitelist |
| 6005 | `InvalidOutcome` | outcome above 3 |
| 6006 | `InvalidImportedScore` | imported score above 1000 |
| 6007 | `AlreadyImported` | unused |
| 6008 | `ImportTooSoon` | less than 15 days since the last import |
| 6009 | `WriterNotFound` | removing a writer that is not listed |

## Pool program

### PDAs

| Account | Seeds |
| --- | --- |
| PoolConfig | `["pool"]` |
| USDC vault | `["vault", pool]` |
| LP mint | `["lp", pool]` |
| CollateralConfig | `["collateral", mint]` |
| Collateral vault | `["coll", pool, mint]` |
| BorrowerState | `["borrower", wallet]` |
| Loan | `["loan", wallet, loan_id as u64 little-endian]` |

### Instructions

| Instruction | Arguments | Signers | What it does |
| --- | --- | --- | --- |
| `init_pool` | | authority | Creates the pool, vault and LP mint (same decimals as USDC). All tier indexes start at 1.0. |
| `add_collateral` | `feed_id: [u8; 32], min_tier: u8, max_age_secs: u32, liq_threshold_bps: u16, liq_bonus_bps: u16` | pool authority | Accepts a collateral mint and creates its vault. Refuses threshold/bonus pairs that do not fit. |
| `accrue_interest` | | none | Grows every tier index to now. Every other instruction does this first anyway. |
| `deposit` | `amount: u64` | lender | USDC in, LP shares out. |
| `withdraw` | `shares: u64` | lender | Burns shares, USDC out from idle cash. |
| `borrow` | `amount: u64, collateral_amount: u64` | borrower | Opens a Loan at the wallet's current tier (checks in [Lending Pool](lending-pool.md#checks-at-borrow-in-order)). Needs a fresh Pyth `PriceUpdateV2` account. |
| `repay` | | borrower | Pays the full debt, returns all collateral, writes the record through `record_event`. |
| `liquidate` | | liquidator | Closes an unhealthy or defaulted loan; writes it as liquidated or defaulted. Needs a fresh Pyth update. |

`repay` and `liquidate` pass the eight accounts `record_event` needs (whitelist, score account, SAS signer, credential, schema, attestation, SAS program, TrustTrail program) straight through; TrustTrail checks each of them. On repay the borrower pays the attestation rent; on liquidation the liquidator does.

### Accounts

**PoolConfig**: `authority`, `usdc_mint`, `vault`, `lp_mint`, `total_borrowed`, `protocol_fees`, `last_accrual`, `tier_index[4]` (u128, WAD), `tier_scaled_debt[4]` (u128), `tier_spread_bps[4]` (i16), `reserve_factor_bps`, `bad_debt`, bumps.

**CollateralConfig**: `mint`, `vault`, `feed_id`, `min_tier`, `max_age_secs`, `decimals`, `liq_threshold_bps`, `liq_bonus_bps`, `bump`.

**BorrowerState**: `wallet`, `largest_repaid` (biggest on-time repay), `next_loan_id`, `open_loans`, `bump`.

**Loan**: `borrower`, `loan_id`, `tier_at_open`, `principal`, `index_at_open`, `scaled_debt`, `collateral_mint`, `collateral_amount`, `collateral_ratio_bps`, `opened_at`, `due_at`, `status` (0 open, 1 repaid, 2 liquidated, 3 defaulted), `bump`. The Loan's address is the attestation nonce.

### Pool errors

| Code | Name | When |
| --- | --- | --- |
| 6000 | `ZeroAmount` | amount, collateral or shares is 0 |
| 6001 | `ZeroShares` | deposit too small to mint a share |
| 6002 | `InsufficientLiquidity` | borrow or withdraw above idle USDC |
| 6003 | `MathOverflow` | arithmetic overflow |
| 6004 | `LoanTooLarge` | amount above `max_loan` |
| 6005 | `CollateralNotAllowed` | tier below the collateral's `min_tier` |
| 6006 | `InsufficientCollateral` | collateral worth less than the tier ratio |
| 6007 | `InvalidPriceAccount` | not a verified Pyth PriceUpdateV2 |
| 6008 | `WrongPriceFeed` | price for another asset |
| 6009 | `StalePrice` | price older than `max_age_secs` |
| 6010 | `LoanNotOpen` | loan already closed |
| 6011 | `WrongLoan` | loan belongs to another wallet |
| 6012 | `NotLiquidatable` | loan is healthy and not in default |
| 6013 | `InvalidRiskParams` | threshold and bonus do not fit together |
| 6014 | `BorrowCapReached` | loan would pass 90% utilization |

## Constants

| Constant | Value |
| --- | --- |
| `TIER_COLLATERAL_BPS` | 15,000 / 14,000 / 13,000 / 12,000 |
| `TIER_SPREAD_BPS` | +400 / +200 / 0 / −150 |
| `TIER_MAX_LOAN` | 200 / 250 / 1,000 / 5,000 USDC |
| `MIN_LOAN_CAP` | 200 USDC |
| `LOAN_TERM_SECS` | 30 days |
| `DEFAULT_GRACE_SECS` | 3 days |
| `RESERVE_FACTOR_BPS` | 1,000 (10%) |
| `MAX_BORROW_UTIL_BPS` | 9,000 (90%) |
| Base rate | 200 bps at 0%, 550 at the 9,500 bps kink, 3,600 at 100% |
| `PYTH_RECEIVER_ID` | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` |

Scoring constants are listed in the [Scoring Model](scoring-model.md#where-the-numbers-live).