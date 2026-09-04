use crate::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 16,
        seeds = [GLOBAL_CONFIG_SEED],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(ctx: Context<Initialize>) -> Result<()> {

        ctx.accounts.global_config.authority = ctx.accounts.authority.key();
    
    Ok(())
}
#[derive(Accounts)]
pub struct UpdateScore<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump
    )]

    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + 2 + 8 + 8 + 1 + 1,
        seeds = [USER_REPUTATION_SEED, user.key().as_ref()],
        bump
    )]
    pub user_reputation: Account<'info, UserReputation>,

    pub user: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>, 

}

pub fn handle_update_score(
    ctx: Context<UpdateScore>,
    new_score: u16,
    mask: u64,
    new_flags: u8,
) -> Result<()> {

    require_keys_eq!(
        ctx.accounts.authority.key(), ctx.accounts.global_config.authority
    );

    let rep = &mut ctx.accounts.user_reputation;
    rep.score = new_score;
    rep.claims_bitmask = mask;
    rep.flags = new_flags;
    rep.last_update = Clock::get()?.unix_timestamp;
    rep.bump = ctx.bumps.user_reputation;



    Ok(())
}
