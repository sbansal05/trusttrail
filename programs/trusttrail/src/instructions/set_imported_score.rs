use crate::*;
use crate::error::ErrorCode;

/// The backend (a whitelisted writer) writes a wallet's score from its DeFi history.
/// Allowed once every 15 days.
#[derive(Accounts)]
pub struct SetImportedScore<'info> {
    pub writer: Signer<'info>,

    #[account(
        seeds = [WRITER_WHITELIST_SEED],
        bump = whitelist.bump,
        constraint = whitelist.signers.contains(&writer.key()) @ ErrorCode::SignerNotApproved
    )]
    pub whitelist: Account<'info, WriterWhitelist>,

    pub wallet: Signer<'info>,

    #[account(
        mut,
        seeds = [USER_REPUTATION_V2_SEED, wallet.key().as_ref()],
        bump = reputation.bump
    )]
    pub reputation: Account<'info, UserReputationV2>,
}

pub fn handle_set_imported_score(
    ctx: Context<SetImportedScore>,
    score: u16,
    meaningful_on_time: u16,
    meaningful_weight_bps: u64,
) -> Result<()> {
    require!(score as u64 <= SCORE_MAX, ErrorCode::InvalidImportedScore);
    let now = Clock::get()?.unix_timestamp;
    let rep = &mut ctx.accounts.reputation;

    require!(rep.import_date == 0 || now - rep.import_date >= IMPORT_COOLDOWN_SECS, ErrorCode::ImportTooSoon);

    let now = Clock::get()?.unix_timestamp;
    rep.imported_score = score;
    rep.import_date = now;
    
    rep.meaningful_on_time = rep.meaningful_on_time.saturating_add(meaningful_on_time);
    rep.meaningful_weight_bps = rep.meaningful_weight_bps.saturating_add(meaningful_weight_bps);
    rep.refresh(now);
    Ok(())
}