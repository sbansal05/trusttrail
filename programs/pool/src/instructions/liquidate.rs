use crate::error::PoolError;
use crate::oracle::collateral_price;
use crate::terms::{collateral_value, is_liquidatable, liquidation_split};
use crate::transfers::{pool_transfer, user_transfer};
use crate::*;
use anchor_spl::token::{Token, TokenAccount};

#[derive(Accounts)]
pub struct Liquidate<'info> {
    /// Anyone can liquidate an unhealthy loan; they pay the debt and get the collateral at a bonus.
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

    // 1. Debt today vs collateral value today
    let debt = a.loan.debt(&a.pool).ok_or(PoolError::MathOverflow)?;
    let decimals = a.collateral_config.decimals;
    let (price, expo) = collateral_price(&a.price_update, &a.collateral_config, now)?;
    let value = collateral_value(a.loan.collateral_amount, decimals, price, expo).ok_or(PoolError::MathOverflow)?;
    require!(is_liquidatable(value, debt), PoolError::NotLiquidatable);

    // 2. Who gets how much collateral
    let (to_liquidator, to_borrower) =
        liquidation_split(debt, a.loan.collateral_amount, decimals, price, expo).ok_or(PoolError::MathOverflow)?;

    // 3. Liquidator pays the debt; collateral goes out in two parts
    let token = a.token_program.key();
    user_transfer(token, a.liquidator_usdc.to_account_info(), a.vault.to_account_info(), a.liquidator.to_account_info(), debt)?;
    pool_transfer(
        token,
        a.collateral_vault.to_account_info(),
        a.liquidator_collateral.to_account_info(),
        a.pool.to_account_info(),
        a.pool.bump,
        to_liquidator,
    )?;
    if to_borrower > 0 {
        pool_transfer(
            token,
            a.collateral_vault.to_account_info(),
            a.borrower_collateral.to_account_info(),
            a.pool.to_account_info(),
            a.pool.bump,
            to_borrower,
        )?;
    }

    // 4. TrustTrail records the liquidation (score penalty + 90-day tier block)
    let parties = Parties {
        pool: a.pool.to_account_info(),
        pool_bump: a.pool.bump,
        borrower: a.borrower.to_account_info(),
        payer: a.liquidator.to_account_info(),
        system_program: a.system_program.to_account_info(),
    };
    let interest = debt.saturating_sub(a.loan.principal);
    a.score.record(parties, a.loan.key(), &a.loan, trusttrail::OUTCOME_LIQUIDATED, interest)?;

    // 5. Books
    let a = &mut *ctx.accounts;
    close_loan(&mut a.pool, &mut a.loan, &mut a.borrower_state, debt, LOAN_LIQUIDATED)
}