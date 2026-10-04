//! Shared by repay and liquidate: write the outcome to TrustTrail, then close the loan.

use crate::error::PoolError;
use crate::*;
use trusttrail::program::Trusttrail;

/// Accounts TrustTrail's `record_event` needs. TrustTrail checks every one of them itself,
/// so the pool only passes them through.
#[derive(Accounts)]
pub struct ScoreAccounts<'info> {
    /// CHECK: TrustTrail checks it is its writer whitelist and that the pool PDA is on it.
    pub whitelist: UncheckedAccount<'info>,
    /// CHECK: TrustTrail checks the seeds ["trust-v2", borrower].
    #[account(mut)]
    pub reputation: UncheckedAccount<'info>,
    /// CHECK: TrustTrail's SAS signer PDA, checked by TrustTrail's seeds.
    pub sas_signer: UncheckedAccount<'info>,
    /// CHECK: address pinned by TrustTrail.
    pub credential: UncheckedAccount<'info>,
    /// CHECK: address pinned by TrustTrail.
    pub schema: UncheckedAccount<'info>,
    /// CHECK: created and checked by the SAS program (seeds use the loan address).
    #[account(mut)]
    pub attestation: UncheckedAccount<'info>,
    /// CHECK: address pinned by TrustTrail.
    pub sas_program: UncheckedAccount<'info>,
    pub trusttrail_program: Program<'info, Trusttrail>,
}

/// Who is involved in one settlement, for the CPI.
pub struct Parties<'info> {
    pub pool: AccountInfo<'info>,
    pub pool_bump: u8,
    pub borrower: AccountInfo<'info>,
    pub payer: AccountInfo<'info>,
    pub system_program: AccountInfo<'info>,
}

impl<'info> ScoreAccounts<'info> {
    /// CPI into TrustTrail: update the borrower's score and write the SAS attestation.
    /// The pool PDA signs as the whitelisted writer.
    pub fn record(&self, p: Parties<'info>, loan_key: Pubkey, loan: &Loan, outcome: u8, interest: u64) -> Result<()> {
        let seeds: &[&[&[u8]]] = &[&[POOL_SEED, &[p.pool_bump]]];
        let accounts = trusttrail::cpi::accounts::RecordEvent {
            writer: p.pool,
            whitelist: self.whitelist.to_account_info(),
            wallet: p.borrower,
            reputation: self.reputation.to_account_info(),
            payer: p.payer,
            sas_signer: self.sas_signer.to_account_info(),
            credential: self.credential.to_account_info(),
            schema: self.schema.to_account_info(),
            attestation: self.attestation.to_account_info(),
            sas_program: self.sas_program.to_account_info(),
            system_program: p.system_program,
        };
        trusttrail::cpi::record_event(
            CpiContext::new_with_signer(self.trusttrail_program.key(), accounts, seeds),
            loan.principal,
            loan.opened_at,
            loan.due_at,
            outcome,
            loan_key,
            interest,
            loan.collateral_ratio_bps,
            loan.tier_at_open,
        )
    }
}

/// Book-keeping after the money has moved: debt leaves the pool, the loan is closed,
/// and the borrower has one loan fewer.
pub fn close_loan(pool: &mut PoolConfig, loan: &mut Loan, state: &mut BorrowerState, debt: u64, status: u8) -> Result<()> {
    pool.remove_debt(loan.tier_at_open as usize, loan.scaled_debt, debt).ok_or(PoolError::MathOverflow)?;
    loan.status = status;
    state.open_loans = state.open_loans.saturating_sub(1);
    

    Ok(())
}