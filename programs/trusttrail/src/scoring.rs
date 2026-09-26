use crate::constants::*;

/// 1. Anti-farming: a loan only counts toward tiers if it paid enough interest.
pub fn loan_counts(interest_paid_usdc: u64) -> bool {
    interest_paid_usdc >= MIN_INTEREST_TO_COUNT_USDC
}

/// 2. Native component (0..=1000), from our own attestations only.
///    - no loans at all → 0 (thin file: "no history → 0", the mentor's rule)
///    - otherwise: on-time rate × 1000, minus LIQUIDATION_PENALTY per liquidation
///    - clamped to 0..=1000
pub fn native_component(on_time: u16, late: u16, liquidations: u16) -> u16 {
    let total = on_time as u32 + late as u32 + liquidations as u32;
    if total == 0 {
        return 0; 
    }

    let rate = on_time as u32 * 1000 / total;                    
    let penalty = liquidations as u32 * LIQUIDATION_PENALTY as u32;

    rate.saturating_sub(penalty) 
        .min(1000)               
        as u16                   
}

/// 3. Hybrid score: blend native and imported.
///    The more of OUR loans a wallet has, the more we trust native over imported:
///      w = min(counted_loans, 8)
///      score = (native * w + import * (8 - w)) / 8
///    0 native loans → 100% import.  8+ native loans → 100% native.
pub fn combined_score(native: u16, import: u16, counted_loans: u16) -> u16 {
    let full = NATIVE_FULL_WEIGHT_LOANS as u32;               // 8
    let w = (counted_loans as u32).min(full);                 // cap the weight at 8
    ((native as u32 * w + import as u32 * (full - w)) / full) as u16
}

/// 4. Tier from score + gates.
///    `on_time` = COUNTED on-time loans (the ones that passed loan_counts).
pub fn compute_tier(score: u16, on_time: u16, last_liquidation_at: i64, now: i64) -> u8 {
    if score == 0 {
        return TIER_UNPROVEN;
    }

    let clean = last_liquidation_at == 0 || now - last_liquidation_at >= LIQUIDATION_COOLDOWN_SECS;

    if score >= GOLD_MIN_SCORE && on_time >= GOLD_MIN_ON_TIME && clean {
        TIER_GOLD
    } else if score >= SILVER_MIN_SCORE && on_time >= SILVER_MIN_ON_TIME && clean {
        TIER_SILVER
    } else {
        TIER_BRONZE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400;

    #[test]
    fn a_anti_farming() {
        assert!(!loan_counts(0));
        assert!(!loan_counts(MIN_INTEREST_TO_COUNT_USDC - 1));
        assert!(loan_counts(MIN_INTEREST_TO_COUNT_USDC));
        assert!(loan_counts(5_000_000));
    }

    #[test]
    fn b_native_component() {
        assert_eq!(native_component(0, 0, 0), 0);        // thin file
        assert_eq!(native_component(3, 0, 0), 1000);     // perfect record
        assert_eq!(native_component(3, 1, 0), 750);      // 3 of 4 on time
        assert_eq!(native_component(1, 2, 0), 333);      // integer division rounds down
        assert_eq!(native_component(4, 0, 1), 800 - LIQUIDATION_PENALTY); // 4/5, then penalty
        assert_eq!(native_component(0, 0, 5), 0);        // can't go negative
    }

    #[test]
    fn c_combined_score() {
        assert_eq!(combined_score(0, 600, 0), 600);      // no native loans → import only
        assert_eq!(combined_score(1000, 600, 4), 800);   // half and half
        assert_eq!(combined_score(1000, 600, 8), 1000);  // fully native
        assert_eq!(combined_score(1000, 600, 50), 1000); // weight capped at 8
        assert_eq!(combined_score(0, 0, 0), 0);
    }

    #[test]
    fn d_tiers() {
        let now = 1_800_000_000;
        assert_eq!(compute_tier(0, 0, 0, now), TIER_UNPROVEN);
        assert_eq!(compute_tier(400, 10, 0, now), TIER_BRONZE);   // score too low
        assert_eq!(compute_tier(600, 2, 0, now), TIER_BRONZE);    // not enough on-time loans
        assert_eq!(compute_tier(600, 3, 0, now), TIER_SILVER);
        assert_eq!(compute_tier(800, 5, 0, now), TIER_SILVER);    // Gold score, Silver count
        assert_eq!(compute_tier(800, 8, 0, now), TIER_GOLD);
        assert_eq!(compute_tier(900, 20, now - 10 * DAY, now), TIER_BRONZE); // liquidated 10 days ago
        assert_eq!(compute_tier(900, 20, now - 90 * DAY, now), TIER_GOLD);   // exactly 90 days: clean again
    }
}