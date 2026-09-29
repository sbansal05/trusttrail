use crate::*;

#[derive(Accounts)]
pub struct InitScoreV2<'info> {
    /// Pays rent for the new account (the borrower, or the pool on first borrow).
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: only used as a PDA seed; never read or written.
    pub wallet: UncheckedAccount<'info>,

    #[account(
        init,                                          
        payer = payer,
        space = 8 + UserReputationV2::INIT_SPACE,      
        seeds = [USER_REPUTATION_V2_SEED, wallet.key().as_ref()],
        bump
    )]
    pub reputation: Account<'info, UserReputationV2>,

    pub system_program: Program<'info, System>,
}

pub fn handle_init_score_v2(ctx: Context<InitScoreV2>) -> Result<()> {
    let rep = &mut ctx.accounts.reputation;
    rep.wallet = ctx.accounts.wallet.key();
    rep.tier = TIER_UNPROVEN;
    rep.last_update = Clock::get()?.unix_timestamp;
    rep.bump = ctx.bumps.reputation;
    
    Ok(())
}