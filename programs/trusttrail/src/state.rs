use anchor_lang::prelude::*;
use crate::scoring::{blend, compute_tier, decay_bps, native_component};
#[account]
pub struct GlobalConfig {
    pub authority: Pubkey,
}

#[account]
pub struct UserReputation {
    pub score: u16,
    pub last_update: i64,
    pub claims_bitmask: u64,
    pub flags: u8,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UserReputationV2 {
    pub wallet: Pubkey,
    pub score: u16,
    pub native_score: u16,
    pub imported_score: u16,
    pub import_date: i64,
    pub tier: u8,
    pub loans_repaid_on_time: u16,
    pub late_repaid_loans: u16,
    pub liquidated_loans: u16,
    pub current_on_time_streak: u16,
    pub last_liquidation_date: i64,
    pub total_usdc_repaid: u64,
    pub last_update: i64,
    pub s_plus_bps: u64,            // Σc over closed, non-liquidated loans (uncapped)
    pub s_minus_bps: u64,           // penalty total, decayed as of s_minus_at
    pub s_minus_at: i64,            // when s_minus_bps was last decayed
    pub exposure_bps: u64,          // E: Σw over all closed loans ≥ $100
    pub meaningful_on_time: u16,    // count for the 3 / 8 gates
    pub meaningful_weight_bps: u64, // Σw for the 3.0 / 8.0 gates
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]

pub struct WriterWhitelist {
    #[max_len(10)]
    pub signers: Vec<Pubkey>,
    pub bump: u8,
}
impl UserReputationV2 {
    /// (native score, final score, tier) as of `now`, with the penalty decayed to `now`.
    /// Read-only: the pool calls this at borrow time.
    pub fn standing(&self, now: i64) -> (u16, u16, u8) {
    let s_minus = decay_bps(self.s_minus_bps, self.s_minus_at, now);
    let native = native_component(self.s_plus_bps, s_minus);
    let score = blend(native, self.imported_score, self.exposure_bps);
    let tier = compute_tier(score, self.meaningful_on_time, self.meaningful_weight_bps, self.last_liquidation_date, now);
    (native, score, tier)
    }

    /// Stores `standing(now)` in the account (the cached score other apps read).
    pub fn refresh(&mut self, now: i64) {
        let (native, score, tier) = self.standing(now);
        self.native_score = native;
        self.score = score;
        self.tier = tier;
        self.last_update = now;
    }
}