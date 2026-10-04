use anchor_lang::prelude::*;

#[constant]
pub const POOL_SEED: &[u8] = b"pool";
#[constant]
pub const VAULT_SEED: &[u8] = b"vault";
#[constant]
pub const LP_MINT_SEED: &[u8] = b"lp";

/// APR spread over the pool base rate, by tier (Unproven, Bronze, Silver, Gold).
pub const TIER_SPREAD_BPS: [i16; 4] = [400, 200, 0, -150];
/// Share of borrower interest kept by the protocol.
pub const RESERVE_FACTOR_BPS: u16 = 1_000;

#[constant]
pub const LOAN_SEED: &[u8] = b"loan";
#[constant]
pub const BORROWER_SEED: &[u8] = b"borrower";
#[constant]
pub const COLLATERAL_SEED: &[u8] = b"collateral";
#[constant]
pub const COLL_VAULT_SEED: &[u8] = b"coll";

/// Collateral needed, in bps of the loan, by tier (Unproven, Bronze, Silver, Gold).
pub const TIER_COLLATERAL_BPS: [u64; 4] = [15_000, 14_000, 13_000, 11_500];
/// Largest loan a tier can take, in micro-USDC.
pub const TIER_MAX_LOAN: [u64; 4] = [100_000_000, 250_000_000, 1_000_000_000, 5_000_000_000];
/// Floor for the growth cap: anyone may borrow up to 100 USDC (if their tier allows).
pub const MIN_LOAN_CAP: u64 = 100_000_000;
/// Every loan is due 30 days after it opens.
pub const LOAN_TERM_SECS: i64 = 30 * 86_400;
/// Pyth's Solana receiver program; it owns every PriceUpdateV2 account.
pub const PYTH_RECEIVER_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
/// A loan can be liquidated once its collateral is worth less than 110% of the debt.
pub const LIQ_THRESHOLD_BPS: u64 = 11_000;
/// The liquidator receives collateral worth the debt plus 5%.
pub const LIQ_BONUS_BPS: u64 = 500;