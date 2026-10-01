pub mod constants;
pub mod error;
pub mod instructions;
pub mod math;
pub mod state;

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

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        crate::instructions::handle_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        crate::instructions::handle_withdraw(ctx, shares)
    }
}