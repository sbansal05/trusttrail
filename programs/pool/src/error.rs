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
    #[msg("Loan is above this wallet's limit")]
    LoanTooLarge,
    #[msg("This collateral needs a higher tier")]
    CollateralNotAllowed,
    #[msg("Collateral is worth less than the tier requires")]
    InsufficientCollateral,
    #[msg("Price account is not a valid Pyth price update")]
    InvalidPriceAccount,
    #[msg("Price is for a different asset")]
    WrongPriceFeed,
    #[msg("Price is too old")]
    StalePrice,
    #[msg("This loan is already closed")]
    LoanNotOpen,
    #[msg("Account does not belong to this loan")]
    WrongLoan,
    #[msg("Loan is healthy and cannot be liquidated")]
    NotLiquidatable,
}