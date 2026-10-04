use crate::error::PoolError;
use crate::terms::repay_outcome;
use crate::transfers::{pool_transfer, user_transfer};
use crate::*;
use anchor_spl::token::{Token, TokenAccount};

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

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

    #[account(mut, seeds = [BORROWER_SEED, borrower.key().as_ref()], bump = borrower_state.bump)]
    pub borrower_state: Box<Account<'info, BorrowerState>>,

    #[account(seeds = [COLLATERAL_SEED, loan.collateral_mint.as_ref()], bump = collateral_config.bump)]
    pub collateral_config: Box<Account<'info, CollateralConfig>>,

    #[account(mut, address = collateral_config.vault)]
    pub collateral_vault: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = loan.collateral_mint, token::authority = borrower)]
    pub borrower_collateral: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = pool.usdc_mint, token::authority = borrower)]
    pub borrower_usdc: Box<Account<'info, TokenAccount>>,

    pub score: ScoreAccounts<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_repay(ctx: Context<Repay>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.pool.accrue_now(ctx.accounts.vault.amount)?;
    let a = &ctx.accounts;

    // 1. What is owed today, and was it on time?
    let debt = a.loan.debt(&a.pool).ok_or(PoolError::MathOverflow)?;
    let interest = debt.saturating_sub(a.loan.principal);
    let outcome = repay_outcome(now, a.loan.due_at);

    // 2. USDC in (borrower signs), collateral back out (pool signs)
    let token = a.token_program.key();
    user_transfer(token, a.borrower_usdc.to_account_info(), a.vault.to_account_info(), a.borrower.to_account_info(), debt)?;
    pool_transfer(
        token,
        a.collateral_vault.to_account_info(),
        a.borrower_collateral.to_account_info(),
        a.pool.to_account_info(),
        a.pool.bump,
        a.loan.collateral_amount,
    )?;

    // 3. Tell TrustTrail: score update + SAS attestation
    let parties = Parties {
        pool: a.pool.to_account_info(),
        pool_bump: a.pool.bump,
        borrower: a.borrower.to_account_info(),
        payer: a.borrower.to_account_info(),
        system_program: a.system_program.to_account_info(),
    };
    a.score.record(parties, a.loan.key(), &a.loan, outcome, interest)?;

    // 4. Books: close the loan; an on-time repayment raises the next loan's limit
    let principal = a.loan.principal;
    let a = &mut *ctx.accounts;
        close_loan(&mut a.pool, &mut a.loan, &mut a.borrower_state, debt, LOAN_REPAID)?;
    if outcome == trusttrail::OUTCOME_ON_TIME {
        a.borrower_state.largest_repaid = a.borrower_state.largest_repaid.max(principal);
    }
    
    Ok(())
}