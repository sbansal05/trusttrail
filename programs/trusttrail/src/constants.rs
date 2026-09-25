use anchor_lang::prelude::*;

#[constant]
pub const GLOBAL_CONFIG_SEED: &[u8] = b"global-config";

#[constant]
pub const HELLO_WORLD_LAMPORTS: u64 = 1;

#[constant]
pub const USER_REPUTATION_SEED: &[u8] = b"trust-v1";


/// The SAS program. Same address on devnet and mainnet.
pub const SAS_PROGRAM_ID: Pubkey = pubkey!("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");

/// Seed for our PDA ["sas-signer"]. It's the only authorized signer on our credential.
/// MUST be the same bytes as SAS_SIGNER_SEED in scripts/sas/setup-sas.ts,
/// otherwise the PDA address changes and SAS rejects our signature.
#[constant]
pub const SAS_SIGNER_SEED: &[u8] = b"sas-signer";

/// Created by scripts/sas/setup-sas.ts on devnet (authority = my wallet 8ZLr5y...).
pub const SAS_CREDENTIAL: Pubkey = pubkey!("HqhwM4J9UoJBq2HGBPn32QN1y7gkASPdX5nxBLCY5sje");

/// "trusttrail-repayment" schema, version 1.
pub const SAS_REPAYMENT_SCHEMA: Pubkey = pubkey!("3q96PNm9Dv6wiR6ZkmJJDm9uUQZUKvqPH8su9Born1A9");

/// Instruction number for CreateAttestation in the SAS program
/// (see `CreateAttestation { ... } = 6` in the SAS repo's program/src/instructions.rs).
/// Needed on Day 3 because we build that CPI by hand.
pub const SAS_IX_CREATE_ATTESTATION: u8 = 6;

// Values for the `outcome` field in a repayment attestation.
pub const OUTCOME_ON_TIME: u8 = 0;
pub const OUTCOME_LATE: u8 = 1;
pub const OUTCOME_LIQUIDATED: u8 = 2;
pub const OUTCOME_DEFAULTED: u8 = 3;