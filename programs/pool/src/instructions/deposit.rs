use crate::error::PoolError;
use crate::math::shares_for_deposit;
use crate::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub lender: Signer<'info>,

    #[account(seeds = [POOL_SEED], bump = pool.bump, has_one = vault, has_one = lp_mint)]
    pub pool: Account<'info, PoolConfig>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub lp_mint: Account<'info, Mint>,

    /// Lender's USDC account (source).
    #[account(mut, token::mint = pool.usdc_mint, token::authority = lender)]
    pub lender_usdc: Account<'info, TokenAccount>,

    /// Lender's LP account (receives shares).
    #[account(mut, token::mint = lp_mint, token::authority = lender)]
    pub lender_lp: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, PoolError::ZeroAmount);
    let a = &ctx.accounts;

    let total_assets = a.pool.total_assets(a.vault.amount).ok_or(PoolError::MathOverflow)?;
    
    let shares: u64 = shares_for_deposit(amount, total_assets, a.lp_mint.supply).ok_or(PoolError::MathOverflow)?;
    require!(shares > 0, PoolError::ZeroShares);
    

    // USDC: lender → vault (lender signs)
    token::transfer(
        CpiContext::new(
            a.token_program.key(),
            Transfer {
                from: a.lender_usdc.to_account_info(),
                to: a.vault.to_account_info(),
                authority: a.lender.to_account_info(),
            },
        ),
        amount,
    )?;

    // LP shares: mint → lender (pool PDA signs)
    let seeds: &[&[&[u8]]] = &[&[POOL_SEED, &[a.pool.bump]]];
    token::mint_to(
        CpiContext::new_with_signer(
            a.token_program.key(),
            MintTo {
                mint: a.lp_mint.to_account_info(),
                to: a.lender_lp.to_account_info(),
                authority: a.pool.to_account_info(),
            },
            seeds,
        ),
        shares,
    )?;
    Ok(())
}