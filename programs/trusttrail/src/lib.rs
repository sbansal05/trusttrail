pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

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

    
}
