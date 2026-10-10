use crate::error::PoolError;
use crate::oracle::collateral_price;
use crate::rates::within_borrow_cap;
use crate::terms::*;
use crate::transfers::{pool_transfer, user_transfer};
use crate::*;
use anchor_spl::token::{Token, TokenAccount};
use trusttrail::state::UserReputationV2;

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,

    #[account(mut, seeds = [POOL_SEED], bump = pool.bump, has_one = vault)]
    pub pool: Box<Account<'info, PoolConfig>>,

    /// Pool's USDC vault (pays out the loan).
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,

    /// The borrower's TrustTrail score account (owned by the TrustTrail program).
    #[account(
        seeds = [trusttrail::USER_REPUTATION_V2_SEED, borrower.key().as_ref()],
        bump = reputation.bump,
        seeds::program = trusttrail::ID
    )]
    pub reputation: Box<Account<'info, UserReputationV2>>,

    #[account(
        init_if_needed, payer = borrower, space = 8 + BorrowerState::INIT_SPACE,
        seeds = [BORROWER_SEED, borrower.key().as_ref()], bump
    )]
    pub borrower_state: Box<Account<'info, BorrowerState>>,

    #[account(
        init, payer = borrower, space = 8 + Loan::INIT_SPACE,
        seeds = [LOAN_SEED, borrower.key().as_ref(), &borrower_state.next_loan_id.to_le_bytes()], bump
    )]
    pub loan: Box<Account<'info, Loan>>,

    #[account(seeds = [COLLATERAL_SEED, collateral_config.mint.as_ref()], bump = collateral_config.bump)]
    pub collateral_config: Box<Account<'info, CollateralConfig>>,

    #[account(mut, address = collateral_config.vault)]
    pub collateral_vault: Box<Account<'info, TokenAccount>>,

    /// CHECK: owner and contents are checked in the handler (Pyth PriceUpdateV2).
    #[account(owner = PYTH_RECEIVER_ID @ PoolError::InvalidPriceAccount)]
    pub price_update: UncheckedAccount<'info>,

    #[account(mut, token::mint = collateral_config.mint, token::authority = borrower)]
    pub borrower_collateral: Box<Account<'info, TokenAccount>>,

    #[account(mut, token::mint = pool.usdc_mint, token::authority = borrower)]
    pub borrower_usdc: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Tier right now: the stored score is a cache, so recompute it with today's penalty decay.
pub fn current_tier(rep: &UserReputationV2, now: i64) -> u8 {
    rep.standing(now).2
}

pub fn handle_borrow(ctx: Context<Borrow>, amount: u64, collateral_amount: u64) -> Result<()> {
    require!(amount > 0 && collateral_amount > 0, PoolError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.pool.accrue_now(ctx.accounts.vault.amount)?;

    let a = &ctx.accounts;

    // 1. Who is this borrower today?
    let tier = current_tier(&a.reputation, now);
    require!( tier >= a.collateral_config.min_tier,PoolError::CollateralNotAllowed);

    // 2. How much may they borrow?
    require!(amount <= max_loan(tier, a.borrower_state.largest_repaid), PoolError::LoanTooLarge);
    require!(amount <= a.vault.amount, PoolError::InsufficientLiquidity);
    require!(within_borrow_cap(a.pool.total_borrowed, a.vault.amount, amount), PoolError::BorrowCapReached);
    
    // 3. What is the collateral worth? (Pyth, low end of the confidence range)
    let (price, expo) = collateral_price(&a.price_update, &a.collateral_config, now)?;
    let value = collateral_value(collateral_amount, a.collateral_config.decimals, price, expo)
        .ok_or(PoolError::MathOverflow)?;
    
    // 4. Is it enough for this tier?
    let ratio = TIER_COLLATERAL_BPS[tier as usize];
    require!(enough_collateral(value, amount, ratio), PoolError::InsufficientCollateral);
    // 5. Lock the collateral (borrower signs)
    let token = a.token_program.key();
    user_transfer(
        token,
        a.borrower_collateral.to_account_info(),
        a.collateral_vault.to_account_info(),
        a.borrower.to_account_info(),
        collateral_amount,
    )?;
    pool_transfer(token, a.vault.to_account_info(), a.borrower_usdc.to_account_info(), a.pool.to_account_info(), a.pool.bump, amount)?;


    // 6. Book the debt: pool totals, the Loan, the borrower's counters
    let index = a.pool.tier_index[tier as usize];
    let scaled = scaled_debt(amount, index);
    let loan_key_bump = ctx.bumps.loan;
    let loan_id = a.borrower_state.next_loan_id;
    let borrower = a.borrower.key();
    let mint = a.collateral_config.mint;

    let pool = &mut ctx.accounts.pool;
    pool.tier_scaled_debt[tier as usize] = pool.tier_scaled_debt[tier as usize].checked_add(scaled).ok_or(PoolError::MathOverflow)?;
    pool.total_borrowed = pool.total_borrowed.checked_add(amount).ok_or(PoolError::MathOverflow)?;

    let loan = &mut ctx.accounts.loan;
    loan.borrower = borrower;
    loan.loan_id = loan_id;
    loan.tier_at_open = tier;
    loan.principal = amount;
    loan.index_at_open = index;
    loan.scaled_debt = scaled;
    loan.collateral_mint = mint;
    loan.collateral_amount = collateral_amount;
    loan.collateral_ratio_bps = ratio as u16;
    loan.opened_at = now;
    loan.due_at = now + LOAN_TERM_SECS;
    loan.status = LOAN_OPEN;
    loan.bump = loan_key_bump;

    let bs = &mut ctx.accounts.borrower_state;
    bs.wallet = borrower;
    bs.next_loan_id = loan_id + 1;
    bs.open_loans = bs.open_loans.saturating_add(1);
    bs.bump = ctx.bumps.borrower_state;
    Ok(())
} 