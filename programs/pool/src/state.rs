use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PoolConfig {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub vault: Pubkey,
    pub lp_mint: Pubkey,
    /// USDC currently lent out, including accrued interest. 0 until borrow exists.
    pub total_borrowed: u64,
    /// Last time interest was accrued (used from the rate-model step).
    pub last_accrual: i64,
    pub bump: u8,
    pub vault_bump: u8,
    pub lp_mint_bump: u8,
}

impl PoolConfig {
    /// Everything lenders own: idle USDC in the vault plus what borrowers owe.
    pub fn total_assets(&self, vault_balance: u64) -> Option<u64> {
        vault_balance.checked_add(self.total_borrowed)
    }
}