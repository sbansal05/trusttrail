use crate::*;
use crate::error::ErrorCode;

/// The admin lowers one wallet's stored exposure (E) to what the current rule gives,
/// computed off-chain from the wallet's repayment attestations. Works until EXPOSURE_FIX_DEADLINE.
#[derive(Accounts)]
pub struct SetExposure<'info> {
    pub authority: Signer<'info>,

    #[account(seeds = [GLOBAL_CONFIG_SEED], bump, has_one = authority)]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(mut, seeds = [USER_REPUTATION_V2_SEED, reputation.wallet.as_ref()], bump = reputation.bump)]
    pub reputation: Account<'info, UserReputationV2>,
}

pub fn handle_set_exposure(ctx: Context<SetExposure>, exposure_bps: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(now <= EXPOSURE_FIX_DEADLINE, ErrorCode::ExposureFixClosed);
    let rep = &mut ctx.accounts.reputation;
    require!(exposure_bps <= rep.exposure_bps, ErrorCode::ExposureCanOnlyDecrease);
    rep.exposure_bps = exposure_bps;
    rep.refresh(now);
    Ok(())
}