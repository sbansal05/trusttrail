use crate::error::PoolError;
use crate::math::assets_for_shares;
use crate::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub lender: Signer<'info>,

    #[account(seeds = [POOL_SEED], bump = pool.bump, has_one = vault, has_one = lp_mint)]
    pub pool: Account<'info, PoolConfig>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub lp_mint: Account<'info, Mint>,

    #[account(mut, token::mint = pool.usdc_mint, token::authority = lender)]
    pub lender_usdc: Account<'info, TokenAccount>,

    #[account(mut, token::mint = lp_mint, token::authority = lender)]
    pub lender_lp: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
    require!(shares > 0, PoolError::ZeroAmount);
    let a = &ctx.accounts;

    let total_assets = a.pool.total_assets(a.vault.amount).ok_or(PoolError::MathOverflow)?;
    let amount = assets_for_shares(shares, total_assets, a.lp_mint.supply).ok_or(PoolError::MathOverflow)?;

    require!(amount <= a.vault.amount, PoolError::InsufficientLiquidity);
    // Burn the lender's shares (lender signs)
    token::burn(
        CpiContext::new(
            a.token_program.key(),
            Burn {
                mint: a.lp_mint.to_account_info(),
                from: a.lender_lp.to_account_info(),
                authority: a.lender.to_account_info(),
            },
        ),
        shares,
    )?;

    // USDC: vault → lender (pool PDA signs)
    let seeds: &[&[&[u8]]] = &[&[POOL_SEED, &[a.pool.bump]]];
    token::transfer(
        CpiContext::new_with_signer(
            a.token_program.key(),
            Transfer {
                from: a.vault.to_account_info(),
                to: a.lender_usdc.to_account_info(),
                authority: a.pool.to_account_info(),
            },
            seeds,
        ),
        amount,
    )?;
    Ok(())
}