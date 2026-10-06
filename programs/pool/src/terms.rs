//! Loan terms: limits, collateral value, debt scaling, liquidation. Pure functions, tested on the host.

use crate::constants::*;
use crate::rates::{BPS, WAD};
use trusttrail::{OUTCOME_DEFAULTED, OUTCOME_LATE, OUTCOME_ON_TIME};
/// Biggest loan allowed: the tier's maximum, and at most double the largest loan
/// this wallet has repaid (but always at least 100 USDC).
pub fn max_loan(tier: u8, largest_repaid: u64) -> u64 {
    let growth_cap = largest_repaid.saturating_mul(2).max(MIN_LOAN_CAP);
    TIER_MAX_LOAN[tier as usize].min(growth_cap)
}

/// Value of `amount` base units of a token in micro-USDC, at `price × 10^expo` USD per token.
/// None if the numbers don't fit.
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

/// True if collateral covers the loan at the given ratio: value ≥ loan × ratio.
pub fn enough_collateral(value: u64, loan: u64, ratio_bps: u64) -> bool {
    value as u128 * BPS as u128 >= loan as u128 * ratio_bps as u128
}

/// Loan amount in "index units", rounded UP so rounding never favours the borrower.
pub fn scaled_debt(amount: u64, index: u128) -> u128 {
    let a = amount as u128 * WAD;
    let b = index;
    (a + b - 1) / b
}

/// USDC owed now for `scaled` index units at `index`, rounded UP (the mirror of `scaled_debt`).
pub fn debt_now(scaled: u128, index: u128) -> Option<u64> {
    let debt = scaled.checked_mul(index)?.checked_add(WAD - 1)? / WAD;
    u64::try_from(debt).ok()
}

//// On time if repaid by the due date, late during the grace period, defaulted after it.
pub fn repay_outcome(now: i64, due_at: i64) -> u8 {
    if now <= due_at {
        OUTCOME_ON_TIME
    } else if in_default(now, due_at) {
        OUTCOME_DEFAULTED
    } else {
        OUTCOME_LATE
    }
}

/// Unhealthy = collateral worth less than the asset's liquidation threshold of the debt.
pub fn is_liquidatable(value: u64, debt: u64, threshold_bps: u16) -> bool {
    !enough_collateral(value, debt, threshold_bps as u64)
}

/// In default once the grace period after the due date has passed.
pub fn in_default(now: i64, due_at: i64) -> bool {
    now > due_at.saturating_add(DEFAULT_GRACE_SECS)
}

/// A collateral's threshold and bonus make sense together:
/// the threshold leaves room for the bonus above 100%, and it sits below every tier's required
/// collateral (so no loan is liquidatable the moment it opens).
pub fn valid_risk_params(threshold_bps: u16, bonus_bps: u16) -> bool {
    let lowest_tier_ratio = *TIER_COLLATERAL_BPS.iter().min().unwrap();
    (threshold_bps as u64) > BPS as u64 + bonus_bps as u64 && (threshold_bps as u64) < lowest_tier_ratio
}

/// Inverse of `collateral_value`: base units of the token worth `value` micro-USDC. Rounds down.
pub fn collateral_for_value(value: u64, decimals: u8, price: u64, expo: i32) -> Option<u64> {
    let shift = decimals as i32 - expo - 6;
    let raw = if shift >= 0 {
        (value as u128).checked_mul(10u128.checked_pow(shift as u32)?)? / price as u128
    } else {
        value as u128 / 10u128.checked_pow((-shift) as u32)? / price as u128
    };
    u64::try_from(raw).ok()
}

/// Who pays and gets what when a loan is liquidated.
#[derive(Debug, PartialEq, Eq)]
pub struct Split {
    /// USDC the liquidator pays into the pool.
    pub pay: u64,
    /// Collateral to the liquidator.
    pub seize: u64,
    /// Collateral back to the borrower.
    pub back: u64,
    /// Debt nobody pays: written off, lenders take the loss.
    pub bad_debt: u64,
}

/// Collateral covers debt + bonus: the liquidator pays the whole debt and gets collateral worth
/// debt + bonus; the rest goes back to the borrower.
/// Collateral covers the debt but not the bonus: the liquidator pays the whole debt and gets all
/// the collateral (a smaller bonus, but lenders lose nothing).
/// Collateral is worth less than the debt: the liquidator gets all of it and pays its value ÷ (1 + bonus),
/// rounded up; the rest of the debt is bad debt.
pub fn liquidation_split(debt: u64, collateral: u64, decimals: u8, price: u64, expo: i32, bonus_bps: u16) -> Option<Split> {
    let with_bonus = BPS as u128 + bonus_bps as u128;
    let reward_value = u64::try_from(debt as u128 * with_bonus / BPS as u128).ok()?;
    let value = collateral_value(collateral, decimals, price, expo)?;
    if value >= reward_value {
        let seize = collateral_for_value(reward_value, decimals, price, expo)?.min(collateral);
        return Some(Split { pay: debt, seize, back: collateral - seize, bad_debt: 0 });
    }
    if value >= debt {
        return Some(Split { pay: debt, seize: collateral, back: 0, bad_debt: 0 });
    }
    let pay = u64::try_from((value as u128 * BPS as u128 + with_bonus - 1) / with_bonus).ok()?.min(debt);
    Some(Split { pay, seize: collateral, back: 0, bad_debt: debt - pay })
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
        assert!(enough_collateral(120 * U, 100 * U, 12_000));     // Gold
        assert!(!enough_collateral(149 * U, 100 * U, 15_000));    // Unproven needs 150
    }

    #[test]
    fn scaled_debt_rounds_up() {
        assert_eq!(scaled_debt(100 * U, WAD), 100 * U as u128);
        assert_eq!(scaled_debt(54 * U, WAD * 108 / 100), 50 * U as u128);
        assert_eq!(scaled_debt(1, 3 * WAD), 1);                           // 1/3 → rounds up to 1
    }

    #[test]
    fn debt_rounds_up_and_mirrors_scaled_debt() {
        assert_eq!(debt_now(100 * U as u128, WAD), Some(100 * U));
        assert_eq!(debt_now(50 * U as u128, WAD * 108 / 100), Some(54 * U));
        assert_eq!(debt_now(1, WAD + 1), Some(2));                 // 1.000…001 → 2
        let s = scaled_debt(77 * U, WAD * 103 / 100);
        assert!(debt_now(s, WAD * 103 / 100).unwrap() >= 77 * U); // never less than borrowed
    }

    #[test]
    fn on_time_then_late_then_defaulted() {
        assert_eq!(repay_outcome(100, 100), OUTCOME_ON_TIME);
        assert_eq!(repay_outcome(101, 100), OUTCOME_LATE);
        assert_eq!(repay_outcome(100 + 3 * 86_400, 100), OUTCOME_LATE);         // last second of grace
        assert_eq!(repay_outcome(100 + 3 * 86_400 + 1, 100), OUTCOME_DEFAULTED);
    }

    #[test]
    fn liquidatable_below_the_asset_threshold() {
        assert!(!is_liquidatable(110 * U, 100 * U, 11_000));      // SOL: exactly 110% is safe
        assert!(is_liquidatable(110 * U - 1, 100 * U, 11_000));
        assert!(!is_liquidatable(105 * U, 100 * U, 10_500));      // USDC: 105%
        assert!(is_liquidatable(105 * U - 1, 100 * U, 10_500));
    }

    #[test]
    fn default_starts_after_three_days_of_grace() {
        let due = 1_000_000;
        assert!(!in_default(due, due));
        assert!(!in_default(due + 3 * 86_400, due));             // last second of grace
        assert!(in_default(due + 3 * 86_400 + 1, due));
    }

    #[test]
    fn threshold_and_bonus_must_fit_together() {
        assert!(valid_risk_params(11_000, 500));    // SOL: 110% / 5%
        assert!(valid_risk_params(10_500, 200));    // USDC: 105% / 2%
        assert!(!valid_risk_params(10_300, 500));   // 103% leaves no room for a 5% bonus
        assert!(!valid_risk_params(10_500, 500));   // exactly the bonus is not enough
        assert!(!valid_risk_params(12_000, 500));   // at Gold's 120%: liquidatable on day one
        assert!(!valid_risk_params(10_000, 0));     // 100% is never safe
    }

    #[test]
    fn collateral_for_value_inverts_value() {
        // 150 USDC at $150/SOL = 1 SOL
        assert_eq!(collateral_for_value(150 * U, 9, 15_000_000_000, -8), Some(1_000_000_000));
        // 10 USDC at $1 = 10 USDC (6 decimals)
        assert_eq!(collateral_for_value(10 * U, 6, 100_000_000, -8), Some(10 * U));
    }

    #[test]
    fn liquidator_gets_debt_plus_the_bonus() {
        // debt 100, 1 SOL at $109, 5% bonus: liquidator pays 100 and gets $105 of SOL, borrower the rest
        let s = liquidation_split(100 * U, 1_000_000_000, 9, 10_900_000_000, -8, 500).unwrap();
        assert_eq!(s, Split { pay: 100 * U, seize: 963_302_752, back: 1_000_000_000 - 963_302_752, bad_debt: 0 });
    }

    #[test]
    fn short_collateral_becomes_bad_debt() {
        // debt 100, collateral worth $70 (0.5 SOL at $140), 5% bonus:
        // liquidator takes it all and pays 70 / 1.05 = 66.666667 (rounded up); 33.333333 is bad debt
        let s = liquidation_split(100 * U, 500_000_000, 9, 14_000_000_000, -8, 500).unwrap();
        assert_eq!(s, Split { pay: 66_666_667, seize: 500_000_000, back: 0, bad_debt: 33_333_333 });
    }

    #[test]
    fn collateral_between_debt_and_debt_plus_bonus_pays_the_whole_debt() {
        // debt 100, collateral worth $103, 5% bonus: liquidator pays 100 and takes all of it ($3 bonus)
        let s = liquidation_split(100 * U, 1_000_000_000, 9, 10_300_000_000, -8, 500).unwrap();
        assert_eq!(s, Split { pay: 100 * U, seize: 1_000_000_000, back: 0, bad_debt: 0 });
    }
}