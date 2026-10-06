use crate::rates::*;
use anchor_lang::prelude::*;
use crate::error::PoolError;
pub const TIERS: usize = 4;

#[account]
#[derive(InitSpace)]
pub struct PoolConfig {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub lp_mint: Pubkey,
    /// USDC owed by all borrowers right now, including accrued interest.
    pub total_borrowed: u64,
    /// Protocol's cut of interest (reserve factor). Not owned by lenders.
    pub protocol_fees: u64,
    /// Last time interest was accrued.
    pub last_accrual: i64,
    /// One borrow index per tier, WAD = 1.0. Debt = scaled_debt × index.
    pub tier_index: [u128; TIERS],
    /// Σ principal × WAD ÷ index_at_open, per tier.
    pub tier_scaled_debt: [u128; TIERS],
    pub tier_spread_bps: [i16; TIERS],
    pub reserve_factor_bps: u16,
    /// Total debt written off because the collateral could not cover it (lenders took this loss).
    pub bad_debt: u64,
    pub bump: u8,
    pub vault_bump: u8,
    pub lp_mint_bump: u8,
}

impl PoolConfig {
    /// What lenders own: idle USDC plus what borrowers owe, minus the protocol's fees.
    pub fn total_assets(&self, vault_balance: u64) -> Option<u64> {
        vault_balance.checked_add(self.total_borrowed)?.checked_sub(self.protocol_fees)
    }

    /// Current APR in bps for each tier, from current utilization.
    pub fn tier_rates_bps(&self, vault_balance: u64) -> [u64; TIERS] {
        let base = base_rate_bps(utilization_bps(self.total_borrowed, vault_balance));
        let mut rates = [0u64; TIERS];
        for t in 0..TIERS {
            rates[t] = tier_rate_bps(base, self.tier_spread_bps[t] as i64);
        }
        rates
    }

    /// Grows every tier's index to `now`, then re-prices total debt and takes the fee.
    pub fn accrue(&mut self, now: i64, vault_balance: u64) -> Option<()> {
        let dt = now.checked_sub(self.last_accrual)?;
        if dt <= 0 {
            return Some(());
        }
        let rates = self.tier_rates_bps(vault_balance);

        let mut new_total: u128 = 0;
        for t in 0..TIERS {
            self.tier_index[t] = grow_index(self.tier_index[t], rates[t], dt as u64);
            new_total = new_total.checked_add(self.tier_scaled_debt[t].checked_mul(self.tier_index[t])? / WAD)?;
        }
        let new_total = u64::try_from(new_total).ok()?;

        let interest = new_total.saturating_sub(self.total_borrowed);
        let fee  = (interest as u128 * self.reserve_factor_bps as u128 / BPS as u128) as u64;
        self.protocol_fees = self.protocol_fees.checked_add(fee)?;
        self.total_borrowed = new_total;
        self.last_accrual = now;
        Some(())
    }

    /// Takes a closed loan out of the books: its index units leave the tier, its debt leaves the total.
    pub fn remove_debt(&mut self, tier: usize, scaled: u128, debt: u64) -> Option<()> {
        self.tier_scaled_debt[tier] = self.tier_scaled_debt[tier].checked_sub(scaled)?;
        self.total_borrowed = self.total_borrowed.saturating_sub(debt);
        Some(())
    }

    /// Accrue up to the current on-chain time. Every pool instruction calls this first.
    pub fn accrue_now(&mut self, vault_balance: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        self.accrue(now, vault_balance).ok_or(PoolError::MathOverflow)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const U: u64 = 1_000_000;

    fn pool() -> PoolConfig {
        PoolConfig {
            authority: Pubkey::default(),
            usdc_mint: Pubkey::default(),
            vault: Pubkey::default(),
            lp_mint: Pubkey::default(),
            total_borrowed: 0,
            protocol_fees: 0,
            last_accrual: 0,
            tier_index: [WAD; TIERS],
            tier_scaled_debt: [0; TIERS],
            tier_spread_bps: [400, 200, 0, -150],
            reserve_factor_bps: 1_000,
            bad_debt: 0,
            bump: 0,
            vault_bump: 0,
            lp_mint_bump: 0,
        }
    }

    #[test]
    fn no_time_no_interest() {
        let mut p = pool();
        p.accrue(0, 100 * U).unwrap();
        assert_eq!(p.total_borrowed, 0);
        assert_eq!(p.tier_index, [WAD; TIERS]);
    }

    #[test]
    fn silver_loan_at_kink_for_a_year() {
        // 950 borrowed by a Silver wallet, 50 idle → 95% utilization → 5.5% base, Silver +0
        let mut p = pool();
        p.tier_scaled_debt[2] = 950 * U as u128;
        p.total_borrowed = 950 * U;
        p.accrue(YEAR_SECS as i64, 50 * U).unwrap();
        assert_eq!(p.total_borrowed, 1_002_250_000);                // +5.5%
        assert_eq!(p.protocol_fees, 5_225_000);                     // 10% of 52.25 USDC
        assert_eq!(p.total_assets(50 * U), Some(1_047_025_000));    // lenders: 50 + 1,002.25 − 5.225
    }

    #[test]
    fn remove_debt_clears_the_tier() {
        let mut p = pool();
        p.tier_scaled_debt[0] = 100 * U as u128;
        p.total_borrowed = 100 * U;
        p.remove_debt(0, 100 * U as u128, 100 * U + 1).unwrap(); // rounded-up debt
        assert_eq!(p.tier_scaled_debt[0], 0);
        assert_eq!(p.total_borrowed, 0);                          // never below zero
        assert!(p.remove_debt(0, 1, 0).is_none());                // can't remove what isn't there
    }

    #[test]
    fn tiers_pay_different_rates() {
        let mut busy = pool();
        busy.total_borrowed = 950 * U;
        assert_eq!(busy.tier_rates_bps(50 * U), [950, 750, 550, 400]);   // at the kink: Gold 4%
        assert_eq!(pool().tier_rates_bps(100 * U), [600, 400, 200, 50]); // empty pool: 2% floor
    }
}

/// One accepted collateral token, added by the admin.
#[account]
#[derive(InitSpace)]
pub struct CollateralConfig {
    pub mint: Pubkey,
    /// Token account (owned by the pool PDA) that holds this collateral.
    pub vault: Pubkey,
    /// Pyth feed id this collateral is priced with (e.g. SOL/USD).
    pub feed_id: [u8; 32],
    /// Lowest tier allowed to post it (0 = everyone).
    pub min_tier: u8,
    /// A price older than this is refused.
    pub max_age_secs: u32,
    pub decimals: u8,
    /// Liquidatable once the collateral is worth less than this share of the debt (e.g. 11_000 = 110%).
    pub liq_threshold_bps: u16,
    /// The liquidator gets collateral worth the debt plus this share (e.g. 500 = 5%).
    pub liq_bonus_bps: u16,
    pub bump: u8,
}

/// Per-borrower state kept by the pool.
#[account]
#[derive(InitSpace)]
pub struct BorrowerState {
    pub wallet: Pubkey,
    /// Biggest loan repaid on time; the next loan may be at most twice this.
    pub largest_repaid: u64,
    /// Used in the next Loan's seeds; goes up by one per loan.
    pub next_loan_id: u64,
    pub open_loans: u16,
    pub bump: u8,
}

pub const LOAN_OPEN: u8 = 0;
pub const LOAN_REPAID: u8 = 1;
pub const LOAN_LIQUIDATED: u8 = 2;
pub const LOAN_DEFAULTED: u8 = 3;

/// One loan. Its address is also the SAS attestation nonce at repay.
#[account]
#[derive(InitSpace)]
pub struct Loan {
    pub borrower: Pubkey,
    pub loan_id: u64,
    pub tier_at_open: u8,
    pub principal: u64,
    /// Tier's borrow index when the loan opened.
    pub index_at_open: u128,
    /// principal × WAD ÷ index_at_open, rounded up.
    pub scaled_debt: u128,
    pub collateral_mint: Pubkey,
    pub collateral_amount: u64,
    pub collateral_ratio_bps: u16,
    pub opened_at: i64,
    pub due_at: i64,
    pub status: u8,
    pub bump: u8,
}
impl Loan {
    /// What it takes to close this loan now: index units × the tier's current index.
    pub fn debt(&self, pool: &PoolConfig) -> Option<u64> {
        crate::terms::debt_now(self.scaled_debt, pool.tier_index[self.tier_at_open as usize])
    }
}