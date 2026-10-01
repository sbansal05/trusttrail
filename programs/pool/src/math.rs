//! Share math for lender deposits and withdrawals. Pure functions, tested on the host.

/// LP shares minted for depositing `amount` USDC.
/// First deposit (no shares yet) is 1 : 1. After that, shares = amount × supply ÷ total_assets,
/// rounded down so the pool never gives away value. None on overflow.
pub fn shares_for_deposit(amount: u64, total_assets: u64, lp_supply: u64) -> Option<u64> {
    
    if lp_supply == 0 || total_assets == 0 {
        return Some(amount);
    }
    let shares = amount as u128 * lp_supply as u128 /total_assets as u128;
    u64::try_from(shares).ok()
}

/// USDC paid out for burning `shares`: shares × total_assets ÷ supply, rounded down.
/// None if supply is 0 or on overflow.
pub fn assets_for_shares(shares: u64, total_assets: u64, lp_supply: u64) -> Option<u64> {
    if lp_supply == 0 {
        return None;
    }
    let assets = shares as u128 * total_assets as u128 /lp_supply as u128;
    u64::try_from(assets).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const U: u64 = 1_000_000; // 1 USDC

    #[test]
    fn first_deposit_is_one_to_one() {
        assert_eq!(shares_for_deposit(100 * U, 0, 0), Some(100 * U));
    }

    #[test]
    fn same_price_gives_same_shares() {
        // pool holds 100 USDC for 100 shares → 1 share = 1 USDC
        assert_eq!(shares_for_deposit(50 * U, 100 * U, 100 * U), Some(50 * U));
    }

    #[test]
    fn after_interest_shares_cost_more() {
        // interest grew assets to 110 for 100 shares → 1 share = 1.1 USDC
        assert_eq!(shares_for_deposit(11 * U, 110 * U, 100 * U), Some(10 * U));
        assert_eq!(assets_for_shares(10 * U, 110 * U, 100 * U), Some(11 * U));
    }

    #[test]
    fn rounding_favors_the_pool() {
        assert_eq!(shares_for_deposit(1, 110 * U, 100 * U), Some(0));
        assert_eq!(assets_for_shares(1, 110, 100), Some(1));
    }

    #[test]
    fn round_trip_never_gains() {
        let (assets, supply) = (123_456_789, 98_765_432);
        let shares = shares_for_deposit(10 * U, assets, supply).unwrap();
        let back = assets_for_shares(shares, assets + 10 * U, supply + shares).unwrap();
        assert!(back <= 10 * U);
    }

    #[test]
    fn huge_values_do_not_overflow() {
        assert_eq!(shares_for_deposit(u64::MAX, u64::MAX, u64::MAX), Some(u64::MAX));
        assert_eq!(assets_for_shares(u64::MAX, u64::MAX, u64::MAX), Some(u64::MAX));
    }

    #[test]
    fn empty_supply_cannot_withdraw() {
        assert_eq!(assets_for_shares(10, 100, 0), None);
    }
}