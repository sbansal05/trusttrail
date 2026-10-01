use crate::*;
use anchor_spl::token::TokenAccount;

#[derive(Accounts)]
pub struct AccrueInterest<'info> {
    #[account(mut, seeds = [POOL_SEED], bump = pool.bump, has_one = vault)]
    pub pool: Account<'info, PoolConfig>,
    pub vault: Account<'info, TokenAccount>,
}

pub fn handle_accrue_interest(ctx: Context<AccrueInterest>) -> Result<()> {
    ctx.accounts.pool.accrue_now(ctx.accounts.vault.amount)
}