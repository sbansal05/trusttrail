use crate::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
pub struct InitPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(init, payer = authority, space = 8 + PoolConfig::INIT_SPACE, seeds = [POOL_SEED], bump)]
    pub pool: Account<'info, PoolConfig>,

    pub usdc_mint: Account<'info, Mint>,

    /// USDC vault, owned by the pool PDA.
    #[account(
        init, payer = authority,
        seeds = [VAULT_SEED, pool.key().as_ref()], bump,
        token::mint = usdc_mint, token::authority = pool
    )]
    pub vault: Account<'info, TokenAccount>,

    /// Lender share token. Same decimals as USDC so 1 share starts at 1 USDC.
    #[account(
        init, payer = authority,
        seeds = [LP_MINT_SEED, pool.key().as_ref()], bump,
        mint::decimals = usdc_mint.decimals, mint::authority = pool
    )]
    pub lp_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_pool(ctx: Context<InitPool>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.authority = ctx.accounts.authority.key();
    pool.usdc_mint = ctx.accounts.usdc_mint.key();
    pool.vault = ctx.accounts.vault.key();
    pool.lp_mint = ctx.accounts.lp_mint.key();
    pool.total_borrowed = 0;
    pool.last_accrual = Clock::get()?.unix_timestamp;
    pool.bump = ctx.bumps.pool;
    pool.vault_bump = ctx.bumps.vault;
    pool.lp_mint_bump = ctx.bumps.lp_mint;
    Ok(())
}