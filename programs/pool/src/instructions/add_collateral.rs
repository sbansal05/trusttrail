use crate::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

/// Admin adds a collateral token: its Pyth feed, which tiers may use it, and its vault.
#[derive(Accounts)]
pub struct AddCollateral<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(seeds = [POOL_SEED], bump = pool.bump, has_one = authority)]
    pub pool: Account<'info, PoolConfig>,

    pub mint: Account<'info, Mint>,

    #[account(
        init, payer = authority, space = 8 + CollateralConfig::INIT_SPACE,
        seeds = [COLLATERAL_SEED, mint.key().as_ref()], bump
    )]
    pub config: Account<'info, CollateralConfig>,

    #[account(
        init, payer = authority,
        seeds = [COLL_VAULT_SEED, pool.key().as_ref(), mint.key().as_ref()], bump,
        token::mint = mint, token::authority = pool
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_add_collateral(ctx: Context<AddCollateral>, feed_id: [u8; 32], min_tier: u8, max_age_secs: u32) -> Result<()> {
    let c = &mut ctx.accounts.config;
    c.mint = ctx.accounts.mint.key();
    c.vault = ctx.accounts.vault.key();
    c.feed_id = feed_id;
    c.min_tier = min_tier;
    c.max_age_secs = max_age_secs;
    c.decimals = ctx.accounts.mint.decimals;
    c.bump = ctx.bumps.config;
    Ok(())
}