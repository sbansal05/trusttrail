use anchor_lang::prelude::*;

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
    pub bump: u8,
}