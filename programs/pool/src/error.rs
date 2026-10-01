use anchor_lang::prelude::*;

#[error_code]
pub enum PoolError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Deposit too small to mint any shares")]
    ZeroShares,
    #[msg("Not enough idle USDC in the pool")]
    InsufficientLiquidity,
    #[msg("Math overflow")]
    MathOverflow,
}