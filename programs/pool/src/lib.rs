pub mod constants;
pub mod error;
pub mod instructions;
pub mod math;
pub mod oracle;
pub mod state;
pub mod rates;
pub mod terms;
pub mod transfers;
use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("Eg1s6qF3UhrUYuccyKy9pMBqDQd4beQjYYYZdGs4EkWL");

#[program]
pub mod pool {
    use super::*;

    pub fn init_pool(ctx: Context<InitPool>) -> Result<()> {
        crate::instructions::handle_init_pool(ctx)
    }
    pub fn accrue_interest(ctx: Context<AccrueInterest>) -> Result<()> {
        crate::instructions::handle_accrue_interest(ctx)
    }

    pub fn add_collateral(ctx: Context<AddCollateral>, feed_id: [u8; 32], min_tier: u8, max_age_secs: u32) -> Result<()> {
    crate::instructions::handle_add_collateral(ctx, feed_id, min_tier, max_age_secs)
    }

    pub fn borrow(ctx: Context<Borrow>, amount: u64, collateral_amount: u64) -> Result<()> {
        crate::instructions::handle_borrow(ctx, amount, collateral_amount)
    }

    pub fn repay(ctx: Context<Repay>) -> Result<()> {
        crate::instructions::handle_repay(ctx)
    }
    
    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        crate::instructions::handle_liquidate(ctx)
    }


    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        crate::instructions::handle_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        crate::instructions::handle_withdraw(ctx, shares)
    }
}