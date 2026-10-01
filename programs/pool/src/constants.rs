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