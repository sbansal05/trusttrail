use anchor_lang::prelude::*;

#[constant]
pub const GLOBAL_CONFIG_SEED: &[u8] = b"global-config";

#[constant]
pub const HELLO_WORLD_LAMPORTS: u64 = 1;

#[constant]
pub const USER_REPUTATION_SEED: &[u8] = b"trust-v1";

#[constant]
pub const USER_REPUTATION_V2_SEED: &[u8] = b"trust-v2";

/// The SAS program. Same address on devnet and mainnet.
pub const SAS_PROGRAM_ID: Pubkey = pubkey!("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");

/// Seed for our PDA ["sas-signer"], the only authorized signer on our credential.
/// MUST match SAS_SIGNER_SEED in scripts/sas/setup-sas.ts.
#[constant]
pub const SAS_SIGNER_SEED: &[u8] = b"sas-signer";

/// Created by scripts/sas/setup-sas.ts on devnet (authority = my wallet 8ZLr5y...).
pub const SAS_CREDENTIAL: Pubkey = pubkey!("HqhwM4J9UoJBq2HGBPn32QN1y7gkASPdX5nxBLCY5sje");

/// "trusttrail-repayment" schema, version 1.
pub const SAS_REPAYMENT_SCHEMA: Pubkey = pubkey!("3q96PNm9Dv6wiR6ZkmJJDm9uUQZUKvqPH8su9Born1A9");

/// CreateAttestation instruction number in the SAS program (program/src/instructions.rs).
pub const SAS_IX_CREATE_ATTESTATION: u8 = 6;

// Values for the `outcome` field in a repayment attestation.
pub const OUTCOME_ON_TIME: u8 = 0;
pub const OUTCOME_LATE: u8 = 1;
pub const OUTCOME_LIQUIDATED: u8 = 2;
pub const OUTCOME_DEFAULTED: u8 = 3;


// Tier codes (UserReputationV2.tier and the attestation's tier_at_open)
pub const TIER_UNPROVEN: u8 = 0;
pub const TIER_BRONZE: u8 = 1;
pub const TIER_SILVER: u8 = 2;
pub const TIER_GOLD: u8 = 3;

pub const SILVER_MIN_SCORE: u16 = 500;
pub const GOLD_MIN_SCORE: u16 = 750;

// Meaningful on-time loans needed for each tier
pub const SILVER_MIN_ON_TIME: u16 = 3;
pub const GOLD_MIN_ON_TIME: u16 = 8;

/// After a liquidation, Silver/Gold are blocked for 90 days.
pub const LIQUIDATION_COOLDOWN_SECS: i64 = 90 * 86_400;

#[constant]
pub const WRITER_WHITELIST_SEED: &[u8] = b"writer_whitelist";

pub const MAX_WRITERS: usize = 10;


pub const BPS: u64 = 10_000;             
pub const USDC_UNIT: u64 = 1_000_000;    

/// Loans below $100 get weight 0 and never count toward tiers.  MEASURED
pub const MIN_PRINCIPAL_USDC: u64 = 100 * USDC_UNIT;
/// A loan must stay open 24 h to count; D reaches 1.0 at 24 h.  POLICY (bot filter)
pub const MIN_HOLD_SECS: i64 = 86_400;

/// (principal in micro-USDC, weight in bps), computed exactly from the report's formula.
/// Straight-line interpolation between rows is within 0.016 of the exact curve.
/// Below the first row → 0. Above the last row → 11_000 (the 1.10 cap).
pub const WEIGHT_TABLE: [(u64, u64); 10] = [
    (100 * USDC_UNIT, 0),
    (150 * USDC_UNIT, 2_026),
    (200 * USDC_UNIT, 3_463),
    (300 * USDC_UNIT, 5_489),
    (500 * USDC_UNIT, 8_041),
    (740 * USDC_UNIT, 10_000),      
    (2_500 * USDC_UNIT, 10_244),
    (10_000 * USDC_UNIT, 10_522),
    (50_000 * USDC_UNIT, 10_845),
    (108_000 * USDC_UNIT, 11_000),  
];

pub const O_ON_TIME_BPS: u64 = 10_000;         
pub const O_LATE_BPS: u64 = 5_000;            
pub const O_LIQUIDATED_BPS: u64 = 20_000;      
pub const O_DEFAULTED_BPS: u64 = 30_000;       

/// Penalties (S⁻) halve every 90 days.  POLICY (matches the 90-day tier block)
pub const PENALTY_HALF_LIFE_SECS: i64 = 90 * 86_400;
/// 0.5^(k/8) in bps for k = 0..8, for the fraction of a half-life left after whole halvings.
/// Linear interpolation between rows: max error 9 bps.
pub const HALF_STEP_TABLE: [u64; 9] = [10_000, 9_170, 8_409, 7_711, 7_071, 6_484, 5_946, 5_453, 5_000];
/// "8 median loans' worth": the cap on S⁺, the score divisor, and the E where α = 1.
pub const FULL_WEIGHT_BPS: u64 = 80_000;
pub const SCORE_MAX: u64 = 1_000;
/// Due-date weighting. A loan with a due date counts 1.0; without one, 0.5.
pub const DUE_DATE_FACTOR_BPS: u64 = 10_000;
pub const NO_DUE_DATE_FACTOR_BPS: u64 = 5_000;
pub const SILVER_MIN_WEIGHT_BPS: u64 = 30_000; 
pub const GOLD_MIN_WEIGHT_BPS: u64 = 80_000;   