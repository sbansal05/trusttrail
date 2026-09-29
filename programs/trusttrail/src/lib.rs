pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod scoring;
pub mod attestation;
use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s");

#[program]
pub mod trusttrail {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx)
    }
    

    pub fn update_score(
        ctx: Context<UpdateScore>,
        new_score: u16,
        mask: u64,
        new_flags: u8

    ) -> Result<()> {
        crate::instructions::initialize::handle_update_score(ctx, new_score, mask, new_flags)
    }
    pub fn init_score_v2(ctx: Context<InitScoreV2>) -> Result<()> {
        crate::instructions::init_score_v2::handle_init_score_v2(ctx)
    }

    pub fn init_writer_whitelist(ctx: Context<InitWriterWhitelist>) -> Result<()> {
        crate::instructions::handle_init_writer_whitelist(ctx)
    }

    pub fn add_writer(
        ctx: Context<AddWriter>,
        writer: Pubkey
    ) -> Result<()> {
        crate::instructions::handle_add_writer(ctx, writer)
    }

    pub fn record_event(
        ctx: Context<RecordEvent>,
        principal_usdc: u64,
        opened_at: i64,
        due_at: i64,
        outcome: u8,
        loan: Pubkey,
        interest_paid_usdc: u64,
        collateral_ratio_bps: u16,
        tier_at_open: u8,
    ) -> Result<()> {
        crate::instructions::handle_record_event(ctx, principal_usdc, opened_at, due_at, outcome, loan, interest_paid_usdc, collateral_ratio_bps, tier_at_open)
    }



    
}
