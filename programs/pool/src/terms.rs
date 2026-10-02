//! Loan terms: limits, collateral value, debt scaling. Pure functions, tested on the host.

use crate::constants::*;
use crate::rates::{BPS, WAD};

/// Biggest loan allowed: the tier's maximum, and at most double the largest loan
/// this wallet has repaid (but always at least 100 USDC).
pub fn max_loan(tier: u8, largest_repaid: u64) -> u64 {
    let growth_cap = largest_repaid.saturating_mul(2).max(MIN_LOAN_CAP);
    TIER_MAX_LOAN[tier as usize].min(growth_cap)


    
}

/// Value of `amount` base units of a token in micro-USDC, at `price × 10^expo` USD per token.
/// None if the numbers don't fit.  (Ye maine likha hai, neeche samjhaaya hai.)
pub fn collateral_value(amount: u64, decimals: u8, price: u64, expo: i32) -> Option<u64> {
    // value = amount ÷ 10^decimals × price × 10^expo × 10^6
    let shift = 6 + expo - decimals as i32;
    let raw = amount as u128 * price as u128;
    let value = if shift >= 0 {
        raw.checked_mul(10u128.checked_pow(shift as u32)?)?
    } else {
        raw / 10u128.checked_pow((-shift) as u32)?
    };
    u64::try_from(value).ok()
}

/// True if collateral covers the loan at the tier's ratio: value ≥ loan × ratio.
pub fn enough_collateral(value: u64, loan: u64, ratio_bps: u64) -> bool {
    value as u128 * BPS as u128 >= loan as u128 * ratio_bps as u128
    
}

/// Loan amount in "index units", rounded UP so rounding never favours the borrower.
pub fn scaled_debt(amount: u64, index: u128) -> u128 {
    let a = amount as u128 * WAD;
    let b = index;
    (a + b - 1) / b
    
}

#[cfg(test)]
mod tests {
    use super::*;

    const U: u64 = 1_000_000;

    #[test]
    fn limits_by_tier_and_growth() {
        assert_eq!(max_loan(0, 0), 100 * U);              // Unproven: 100
        assert_eq!(max_loan(3, 0), 100 * U);              // Gold with no repaid loan: still 100
        assert_eq!(max_loan(3, 300 * U), 600 * U);        // doubles the largest repaid
        assert_eq!(max_loan(1, 300 * U), 250 * U);        // Bronze tier cap wins
        assert_eq!(max_loan(3, 4_000 * U), 5_000 * U);    // Gold cap wins
    }

    #[test]
    fn sol_value() {
        // 1 SOL (9 decimals) at $150.00 (Pyth: price 15_000_000_000, expo -8) = 150 USDC
        assert_eq!(collateral_value(1_000_000_000, 9, 15_000_000_000, -8), Some(150 * U));
        assert_eq!(collateral_value(500_000_000, 9, 15_000_000_000, -8), Some(75 * U));
    }

    #[test]
    fn usdc_value() {
        assert_eq!(collateral_value(10 * U, 6, 100_000_000, -8), Some(10 * U));
    }

    #[test]
    fn collateral_ratio() {
        assert!(enough_collateral(130 * U, 100 * U, 13_000));     // exactly 130%
        assert!(!enough_collateral(129 * U, 100 * U, 13_000));    // 1 USDC short
        assert!(enough_collateral(115 * U, 100 * U, 11_500));     // Gold
        assert!(!enough_collateral(149 * U, 100 * U, 15_000));    // Unproven needs 150
    }

    #[test]
    fn scaled_debt_rounds_up() {
        assert_eq!(scaled_debt(100 * U, WAD), 100 * U as u128);
        assert_eq!(scaled_debt(54 * U, WAD * 108 / 100), 50 * U as u128); 
        assert_eq!(scaled_debt(1, 3 * WAD), 1);                           // 1/3 → rounds up to 1
    }
}