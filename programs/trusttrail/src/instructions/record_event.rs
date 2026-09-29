use crate::*;
use crate::error::ErrorCode;
use crate::scoring::*;
use crate::attestation::encode_repayment;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
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

        #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: PDA verified by seeds; signs the SAS CPI via invoke_signed.
    #[account(
        seeds = [SAS_SIGNER_SEED],
        bump
    )]
    pub sas_signer: UncheckedAccount<'info>,

    /// CHECK: address pinned to our credential.
    #[account(address = SAS_CREDENTIAL)]
    pub credential: UncheckedAccount<'info>,

    /// CHECK: address pinned to our repayment schema.
    #[account(address = SAS_REPAYMENT_SCHEMA)]
    pub schema: UncheckedAccount<'info>,

    ///CHECK: created and validated by the SAS program.
    #[account(mut)]
    pub attestation: UncheckedAccount<'info>,

    ///CHECK: address pinned to the SAS program id.
    #[account(address = SAS_PROGRAM_ID)]
    pub sas_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

}

pub fn handle_record_event(
    ctx: Context<RecordEvent>,
    principal_usdc: u64,
    opened_at: i64,
    due_at: i64,
    outcome: u8,
    loan: Pubkey,
    interest_paid_usdc: u64,
    collateral_ratio_bps: u16,
    tier_at_open: u8,
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

    let a  = &ctx.accounts;

    let record = encode_repayment(
        &a.wallet.key(),
        &a.writer.key(),
        principal_usdc,
        interest_paid_usdc,
        opened_at,
        due_at,
        now,
        outcome,
        collateral_ratio_bps,
        tier_at_open,
    );

    let mut ix_data = Vec::with_capacity(1 + 32 + 4 + record.len() + 8);
    ix_data.push(SAS_IX_CREATE_ATTESTATION);
    ix_data.extend_from_slice(loan.as_ref());
    ix_data.extend_from_slice(&(record.len() as u32).to_le_bytes());
    ix_data.extend_from_slice(&record);
    ix_data.extend_from_slice(&0i64.to_be_bytes());

    let ix = Instruction {
        program_id: SAS_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(a.payer.key(), true),
            AccountMeta::new_readonly(a.sas_signer.key(), true),
            AccountMeta::new_readonly(a.credential.key(), false),
            AccountMeta::new_readonly(a.schema.key(), false),
            AccountMeta::new(a.attestation.key(), false),
            AccountMeta::new(a.system_program.key(), false),
        ],
        data: ix_data,
    };

    let bump = ctx.bumps.sas_signer;
    let signer_seeds: &[&[&[u8]]] = &[&[SAS_SIGNER_SEED, &[bump]]];

    invoke_signed(
        &ix,
        &[
            a.payer.to_account_info(),
            a.sas_signer.to_account_info(),
            a.credential.to_account_info(),
            a.schema.to_account_info(),
            a.attestation.to_account_info(),
            a.system_program.to_account_info(),
            a.sas_program.to_account_info(),
        ],
         signer_seeds,
    )?;
    Ok(())
}