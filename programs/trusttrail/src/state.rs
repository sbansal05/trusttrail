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
