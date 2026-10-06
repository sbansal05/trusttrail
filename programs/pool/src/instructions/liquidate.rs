use crate::error::PoolError;
use crate::oracle::collateral_price;
use crate::terms::{collateral_value, in_default, is_liquidatable, liquidation_split};
use crate::transfers::{pool_transfer, user_transfer};
use crate::*;
use anchor_spl::token::{Token, TokenAccount};

#[derive(Accounts)]
pub struct Liquidate<'info> {
    /// Anyone can liquidate a loan that is unhealthy or in default; they pay the debt
    /// (or what the collateral covers) and get the collateral at a bonus.
    #[account(mut)]
    pub liquidator: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump, has_one = vault)]
    pub pool: Box<Account<'info, PoolConfig>>,

    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        has_one = borrower @ PoolError::WrongLoan,
        constraint = loan.status == LOAN_OPEN @ PoolError::LoanNotOpen
    )]
    pub loan: Box<Account<'info, Loan>>,

    /// CHECK: the loan's borrower (has_one above); not a signer here.
    pub borrower: UncheckedAccount<'info>,

    #[account(mut, seeds = [BORROWER_SEED, borrower.key().as_ref()], bump = borrower_state.bump)]
    pub borrower_state: Box<Account<'info, BorrowerState>>,

    #[account(seeds = [COLLATERAL_SEED, loan.collateral_mint.as_ref()], bump = collateral_config.bump)]
    pub collateral_config: Box<Account<'info, CollateralConfig>>,

    #[account(mut, address = collateral_config.vault)]
    pub collateral_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: owner checked here, contents in `collateral_price`.
    #[account(owner = PYTH_RECEIVER_ID @ PoolError::InvalidPriceAccount)]
    pub price_update: UncheckedAccount<'info>,

    #[account(mut, token::mint = loan.collateral_mint, token::authority = borrower)]
    pub borrower_collateral: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = loan.collateral_mint, token::authority = liquidator)]
    pub liquidator_collateral: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = pool.usdc_mint, token::authority = liquidator)]
    pub liquidator_usdc: Box<Account<'info, TokenAccount>>,

    pub score: ScoreAccounts<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_liquidate(ctx: Context<Liquidate>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.pool.accrue_now(ctx.accounts.vault.amount)?;
    let a = &ctx.accounts;
    let cfg = &a.collateral_config;

    // 1. Allowed if the loan is in default (grace period over) or unhealthy at this asset's threshold
    let debt = a.loan.debt(&a.pool).ok_or(PoolError::MathOverflow)?;
    let (price, expo) = collateral_price(&a.price_update, cfg, now)?;
    let value = collateral_value(a.loan.collateral_amount, cfg.decimals, price, expo).ok_or(PoolError::MathOverflow)?;
    let defaulted = in_default(now, a.loan.due_at);
    require!(defaulted || is_liquidatable(value, debt, cfg.liq_threshold_bps), PoolError::NotLiquidatable);

    // 2. Who pays what, who gets what (and any bad debt)
    let split = liquidation_split(debt, a.loan.collateral_amount, cfg.decimals, price, expo, cfg.liq_bonus_bps)
        .ok_or(PoolError::MathOverflow)?;

    // 3. Liquidator pays; collateral goes out in two parts
    let token = a.token_program.key();
    user_transfer(token, a.liquidator_usdc.to_account_info(), a.vault.to_account_info(), a.liquidator.to_account_info(), split.pay)?;
    pool_transfer(
        token,
        a.collateral_vault.to_account_info(),
        a.liquidator_collateral.to_account_info(),
        a.pool.to_account_info(),
        a.pool.bump,
        split.seize,
    )?;
    if split.back > 0 {
        pool_transfer(
            token,
            a.collateral_vault.to_account_info(),
            a.borrower_collateral.to_account_info(),
            a.pool.to_account_info(),
            a.pool.bump,
            split.back,
        )?;
    }

    // 4. TrustTrail records it: defaulted (3x penalty) or liquidated (2x); both block Silver and Gold for 90 days
    let parties = Parties {
        pool: a.pool.to_account_info(),
        pool_bump: a.pool.bump,
        borrower: a.borrower.to_account_info(),
        payer: a.liquidator.to_account_info(),
        system_program: a.system_program.to_account_info(),
    };
    let (outcome, status) = if defaulted {
        (trusttrail::OUTCOME_DEFAULTED, LOAN_DEFAULTED)
    } else {
        (trusttrail::OUTCOME_LIQUIDATED, LOAN_LIQUIDATED)
    };
    let interest = split.pay.saturating_sub(a.loan.principal);
    a.score.record(parties, a.loan.key(), &a.loan, outcome, interest)?;

    // 5. Books: the whole debt leaves the pool; whatever was not paid is the lenders' loss
    let a = &mut *ctx.accounts;
    close_loan(&mut a.pool, &mut a.loan, &mut a.borrower_state, debt, status)?;
    a.pool.bad_debt = a.pool.bad_debt.checked_add(split.bad_debt).ok_or(PoolError::MathOverflow)?;
    Ok(())
}