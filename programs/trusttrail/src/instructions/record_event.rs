use crate::*;
use crate::error::ErrorCode;
use crate::scoring::*;

#[derive(Accounts)]
pub struct RecordEvent<'info> {
    pub writer: Signer<'info>,

    #[account(
        seeds = [WRITER_WHITELIST_SEED],
        bump = whitelist.bump,
        constraint = whitelist.signers.contains(&writer.key()) @ ErrorCode::SignerNotApproved
    )]
    pub whitelist: Account<'info, WriterWhitelist>,

    /// CHECK: only used as a PDA seed for `reputation`; never read or written.
    pub wallet: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [USER_REPUTATION_V2_SEED, wallet.key().as_ref()],
        bump = reputation.bump
    )]
    pub reputation: Account<'info, UserReputationV2>,
}

pub fn handle_record_event(
    ctx: Context<RecordEvent>,
    principal_usdc: u64,
    opened_at: i64,
    due_at: i64,
    outcome: u8,
) -> Result<()> {
    require!(outcome <= OUTCOME_DEFAULTED, ErrorCode::InvalidOutcome);
    let now = Clock::get()?.unix_timestamp;
    let rep = &mut ctx.accounts.reputation;
    rep.s_minus_bps = decay_bps(rep.s_minus_bps, rep.s_minus_at, now);
    rep.s_minus_at = now;

    let (plus, minus) = loan_contribution_bps(principal_usdc, opened_at, now, due_at, outcome);
    rep.s_plus_bps = rep.s_plus_bps.saturating_add(plus);
    rep.s_minus_bps = rep.s_minus_bps.saturating_add(minus);

    let w = principal_weight_bps(principal_usdc);
    rep.exposure_bps = rep.exposure_bps.saturating_add(w);

    if outcome == OUTCOME_ON_TIME && meaningful_loan(principal_usdc, opened_at, now, outcome) {
        rep.meaningful_on_time = rep.meaningful_on_time.saturating_add(1);
        rep.meaningful_weight_bps = rep.meaningful_weight_bps.saturating_add(w);
    }

    match outcome {
        OUTCOME_ON_TIME => {
            rep.loans_repaid_on_time = rep.loans_repaid_on_time.saturating_add(1);
            rep.current_on_time_streak = rep.current_on_time_streak.saturating_add(1);
            rep.total_usdc_repaid = rep.total_usdc_repaid.saturating_add(principal_usdc);
        }
        OUTCOME_LATE => {
            rep.late_repaid_loans = rep.late_repaid_loans.saturating_add(1);
            rep.current_on_time_streak = 0;
            rep.total_usdc_repaid = rep.total_usdc_repaid.saturating_add(principal_usdc);
        }
        _ => {
            rep.liquidated_loans = rep.liquidated_loans.saturating_add(1);
            rep.current_on_time_streak = 0;
            rep.last_liquidation_date = now;
        }
    }

    let native = native_component(rep.s_plus_bps, rep.s_minus_bps);
    rep.native_score = native;
    rep.score = blend(native, rep.imported_score, rep.exposure_bps);
    rep.tier = compute_tier(
        rep.score,
        rep.meaningful_on_time,
        rep.meaningful_weight_bps,
        rep.last_liquidation_date,
        now,
    );
    rep.last_update = now;

    Ok(())
}