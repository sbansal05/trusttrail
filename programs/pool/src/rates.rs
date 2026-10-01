//! Interest rate model. Pure functions, tested on the host.

pub const BPS: u64 = 10_000;
pub const YEAR_SECS: u64 = 365 * 86_400;
/// Fixed-point 1.0 for borrow indices (18 decimals).
pub const WAD: u128 = 1_000_000_000_000_000_000;

/// Base APR curve: 2% at 0% utilization, 8% at the 80% kink, 50% at 100%.
pub const BASE_RATE_BPS: u64 = 200;
pub const KINK_RATE_BPS: u64 = 800;
pub const MAX_RATE_BPS: u64 = 5_000;
pub const KINK_UTIL_BPS: u64 = 8_000;

/// Utilization in bps: borrowed ÷ (borrowed + idle). An empty pool is 0%.
pub fn utilization_bps(borrowed: u64, idle: u64) -> u64 {
    let total = borrowed as u128 + idle as u128;
    if total == 0 {
        return 0;
    }
    (borrowed as u128 * BPS as u128 / total) as u64
}

/// Pool base APR in bps from utilization: two straight lines that meet at the kink.
pub fn base_rate_bps(util_bps: u64) -> u64 {
    let u = util_bps.min(BPS);

    if u <= KINK_UTIL_BPS {
        BASE_RATE_BPS + u * (KINK_RATE_BPS - BASE_RATE_BPS) / KINK_UTIL_BPS
    } else {
        KINK_RATE_BPS + (u - KINK_UTIL_BPS) * (MAX_RATE_BPS - KINK_RATE_BPS) / (BPS - KINK_UTIL_BPS)
    }


}

/// Tier APR = base + spread, never below 0.
pub fn tier_rate_bps(base_bps: u64, spread_bps: i64) -> u64 {
    (base_bps as i64 + spread_bps).max(0) as u64
}

/// Index after `dt` seconds at `rate_bps` APR: index × (1 + rate × dt ÷ year).
pub fn grow_index(index: u128, rate_bps: u64, dt_secs: u64) -> u128 {
    index + index * rate_bps as u128 * dt_secs as u128 / (BPS as u128 * YEAR_SECS as u128)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utilization() {
        assert_eq!(utilization_bps(0, 0), 0);
        assert_eq!(utilization_bps(0, 100), 0);
        assert_eq!(utilization_bps(80, 20), 8_000);
        assert_eq!(utilization_bps(100, 0), 10_000);
        assert_eq!(utilization_bps(u64::MAX, u64::MAX), 5_000);
    }

    #[test]
    fn base_rate_curve() {
        assert_eq!(base_rate_bps(0), 200);
        assert_eq!(base_rate_bps(4_000), 500);
        assert_eq!(base_rate_bps(8_000), 800);
        assert_eq!(base_rate_bps(9_000), 2_900);
        assert_eq!(base_rate_bps(10_000), 5_000);
        assert_eq!(base_rate_bps(12_000), 5_000);
    }

    #[test]
    fn tier_spread() {
        assert_eq!(tier_rate_bps(800, 400), 1_200);
        assert_eq!(tier_rate_bps(800, -150), 650);
        assert_eq!(tier_rate_bps(100, -150), 0);
    }

    #[test]
    fn index_growth() {
        assert_eq!(grow_index(WAD, 1_000, YEAR_SECS), WAD * 11 / 10);
        assert_eq!(grow_index(WAD, 1_000, YEAR_SECS / 2), WAD * 105 / 100);
        assert_eq!(grow_index(WAD, 1_000, 0), WAD);
        assert_eq!(grow_index(WAD, 0, YEAR_SECS), WAD);
    }
}