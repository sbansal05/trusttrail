use crate::constants::*;

/// Principal weight w(P) in bps (10_000 = 1.0), from the report's log curve.
/// Straight-line interpolation between WEIGHT_TABLE rows, within 0.016 of the exact curve.
/// Below $100 returns 0; at or above $108,000 returns 11_000 (the 1.10 cap).
pub fn principal_weight_bps(principal_usdc: u64) -> u64 {
    let (first_p, _) = WEIGHT_TABLE[0];
    if principal_usdc < first_p {
        return 0;
    }

    let (last_p, last_w) = WEIGHT_TABLE[WEIGHT_TABLE.len() - 1];
    if principal_usdc >= last_p {
        return last_w;
    }

    for pair in WEIGHT_TABLE.windows(2) {
        let (p0, w0) = pair[0];
        let (p1, w1) = pair[1];
        if principal_usdc < p1 {
            let distance = (principal_usdc - p0) as u128;
            let span = (p1 - p0) as u128;
            let rise = (w1 - w0) as u128;
            return w0 + (distance * rise / span) as u64;
        }
    }

    last_w
}

/// A loan is meaningful if it was repaid in full (on time or late), its principal
/// is at least $100, and it stayed open at least 24 hours.
/// Tier counts use `meaningful_loan(..) && outcome == OUTCOME_ON_TIME`.
pub fn meaningful_loan(principal_usdc: u64, opened_at: i64, closed_at: i64, outcome: u8) -> bool {
    let repaid_in_full = outcome == OUTCOME_ON_TIME || outcome == OUTCOME_LATE;
    let big_enough = principal_usdc >= MIN_PRINCIPAL_USDC;
    let held_long_enough = closed_at.saturating_sub(opened_at) >= MIN_HOLD_SECS;
    repaid_in_full && big_enough && held_long_enough
}

/// D = min(1, hours open / 24) in bps. Negative durations count as 0.
pub fn duration_bps(opened_at: i64, closed_at: i64) -> u64 {
    let held = closed_at.saturating_sub(opened_at).clamp(0, MIN_HOLD_SECS) as u64;
    held * BPS / MIN_HOLD_SECS as u64
}

/// Contribution c = w · R · D · O of one closed loan, returned as (S⁺ delta, S⁻ delta).
/// On time adds w·D to S⁺, late adds w·D·0.5 to S⁺, liquidated adds 2·w to S⁻,
/// defaulted adds 3·w to S⁻. R is 1 because our pool only accepts full repayment.
/// An unknown outcome contributes nothing.
pub fn loan_contribution_bps(principal_usdc: u64, opened_at: i64, closed_at: i64, outcome: u8) -> (u64, u64) {
    let w = principal_weight_bps(principal_usdc);
    match outcome {
        OUTCOME_ON_TIME | OUTCOME_LATE => {
            let o = if outcome == OUTCOME_ON_TIME { O_ON_TIME_BPS } else { O_LATE_BPS };
            let d = duration_bps(opened_at, closed_at);
            (w * d / BPS * o / BPS, 0)
        }
        OUTCOME_LIQUIDATED => (0, w * O_LIQUIDATED_BPS / BPS),
        OUTCOME_DEFAULTED => (0, w * O_DEFAULTED_BPS / BPS),
        _ => (0, 0),
    }
}

/// value × 0.5^((now − from) / 90 days), integers only.
/// Whole half-lives are right shifts; the remaining fraction is interpolated from
/// HALF_STEP_TABLE (max error 9 bps). If `now` is before `from`, nothing decays.
pub fn decay_bps(value: u64, from: i64, now: i64) -> u64 {
    let elapsed = now.saturating_sub(from).max(0) as u64;
    let half_life = PENALTY_HALF_LIFE_SECS as u64;

    let halvings = elapsed / half_life;
    if halvings >= 64 {
        return 0;
    }
    let after_halvings = value >> halvings;

    let rest = elapsed % half_life;
    let scaled = rest * 8;
    let step = (scaled / half_life) as usize;
    let within = scaled % half_life;

    let hi = HALF_STEP_TABLE[step];
    let lo = HALF_STEP_TABLE[step + 1];
    let factor = hi - (hi - lo) * within / half_life;

    ((after_halvings as u128 * factor as u128) / BPS as u128) as u64
}

/// Native score 0..=1000: clamp(1000 × (min(S⁺, 8.0) − S⁻_now) ÷ 8.0, 0, 1000).
/// Only good history is capped and penalties are subtracted after the cap, so every
/// liquidation costs about 250 × w points however long the history.
/// `s_minus_now_bps` must already be decayed to now with `decay_bps`.
pub fn native_component(s_plus_bps: u64, s_minus_now_bps: u64) -> u16 {
    let good = s_plus_bps.min(FULL_WEIGHT_BPS);
    let net = good.saturating_sub(s_minus_now_bps);
    (net * SCORE_MAX / FULL_WEIGHT_BPS) as u16
}

/// Final score: α · native + (1 − α) · imported, with α = min(1, E ÷ 8.0).
/// E is Σw over all closed native loans of at least $100, good or bad, so a bad
/// TrustTrail history can't hide behind imported history. α can reach 1.
pub fn blend(native: u16, imported: u16, exposure_bps: u64) -> u16 {
    let alpha = exposure_bps.min(FULL_WEIGHT_BPS) * BPS / FULL_WEIGHT_BPS;
    let mixed = native as u64 * alpha + imported as u64 * (BPS - alpha);
    (mixed / BPS) as u16
}

/// Tier from score plus three gates; all must pass, highest tier checked first.
/// Silver: score ≥ 500, ≥ 3 meaningful on-time loans, Σw ≥ 3.0, no liquidation in 90 days.
/// Gold: score ≥ 750, ≥ 8 meaningful on-time loans, Σw ≥ 8.0, no liquidation in 90 days.
/// `last_liquidation_at` = 0 means never liquidated. Call at borrow time with the current `now`.
pub fn compute_tier(
    score: u16,
    meaningful_on_time: u16,
    meaningful_weight_bps: u64,
    last_liquidation_at: i64,
    now: i64,
) -> u8 {
    if score == 0 {
        return TIER_UNPROVEN;
    }

    let clean = last_liquidation_at == 0
        || now.saturating_sub(last_liquidation_at) >= LIQUIDATION_COOLDOWN_SECS;

    if clean
        && score >= GOLD_MIN_SCORE
        && meaningful_on_time >= GOLD_MIN_ON_TIME
        && meaningful_weight_bps >= GOLD_MIN_WEIGHT_BPS
    {
        TIER_GOLD
    } else if clean
        && score >= SILVER_MIN_SCORE
        && meaningful_on_time >= SILVER_MIN_ON_TIME
        && meaningful_weight_bps >= SILVER_MIN_WEIGHT_BPS
    {
        TIER_SILVER
    } else {
        TIER_BRONZE
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: i64 = 3_600;
    const T0: i64 = 1_800_000_000;
    const D90: i64 = 90 * 86_400;

    fn usd(dollars: u64) -> u64 {
        dollars * USDC_UNIT
    }

    #[test]
    fn b_native_component() {
        let loan = 10_000;
        assert_eq!(native_component(0, 0), 0);
        assert_eq!(native_component(8 * loan, 0), 1000);
        assert_eq!(native_component(4 * loan, 0), 500);
        assert_eq!(native_component(20 * loan, 2 * loan), 750);
        assert_eq!(native_component(20 * loan, decay_bps(2 * loan, T0, T0 + D90)), 875);
        let year = native_component(20 * loan, decay_bps(2 * loan, T0, T0 + 365 * 86_400));
        assert!((984..=985).contains(&year), "1 year: {year}");
        assert_eq!(native_component(1 * loan, 3 * loan), 0);
        assert_eq!(native_component(u64::MAX, 0), 1000);
        assert_eq!(native_component(u64::MAX, u64::MAX), 0);
    }

    #[test]
    fn c_blend() {
        let loan = 10_000;
        assert_eq!(blend(0, 600, 0), 600);
        assert_eq!(blend(1000, 600, 4 * loan), 800);
        assert_eq!(blend(1000, 600, 8 * loan), 1000);
        assert_eq!(blend(1000, 600, 50 * loan), 1000);
        assert_eq!(blend(0, 900, 8 * loan), 0);
        assert_eq!(blend(0, 800, 1 * loan), 700);
        assert_eq!(blend(0, 0, 0), 0);
        assert_eq!(blend(1000, 1000, u64::MAX), 1000);
    }

    #[test]
    fn d_tiers() {
        let now = T0;
        let w = |dollars: u64| principal_weight_bps(usd(dollars));
        assert_eq!(compute_tier(0, 0, 0, 0, now), TIER_UNPROVEN);
        assert_eq!(compute_tier(400, 10, 100_000, 0, now), TIER_BRONZE);
        assert_eq!(compute_tier(600, 2, 50_000, 0, now), TIER_BRONZE);
        assert_eq!(compute_tier(600, 3, 29_999, 0, now), TIER_BRONZE);
        assert_eq!(compute_tier(600, 3, 30_000, 0, now), TIER_SILVER);
        assert_eq!(compute_tier(600, 3, 3 * w(101), 0, now), TIER_BRONZE);
        assert_eq!(compute_tier(600, 6, 6 * w(300), 0, now), TIER_SILVER);
        assert_eq!(compute_tier(600, 3, 3 * w(740), 0, now), TIER_SILVER);
        assert_eq!(compute_tier(800, 8, 79_999, 0, now), TIER_SILVER);
        assert_eq!(compute_tier(800, 8, 80_000, 0, now), TIER_GOLD);
        assert_eq!(compute_tier(800, 5, 200_000, 0, now), TIER_SILVER);
        assert_eq!(compute_tier(900, 20, 200_000, now - 10 * 86_400, now), TIER_BRONZE);
        assert_eq!(compute_tier(900, 20, 200_000, now - D90, now), TIER_GOLD);
    }

    #[test]
    fn e_weight_anchors_exact() {
        for (p, w) in WEIGHT_TABLE {
            assert_eq!(principal_weight_bps(p), w);
        }
    }

    #[test]
    fn f_weight_edges() {
        assert_eq!(principal_weight_bps(0), 0);
        assert_eq!(principal_weight_bps(usd(10)), 0);
        assert_eq!(principal_weight_bps(usd(100) - 1), 0);
        assert_eq!(principal_weight_bps(usd(200_000)), 11_000);
        assert_eq!(principal_weight_bps(u64::MAX), 11_000);
    }

    #[test]
    fn g_weight_close_to_report_curve() {
        let exact = [
            (120, 911), (250, 4_578), (400, 6_926), (620, 9_116), (1_000, 10_060),
            (5_000, 10_383), (25_000, 10_706), (80_000, 10_940),
        ];
        for (d, w) in exact {
            let got = principal_weight_bps(usd(d)) as i64;
            assert!((got - w).abs() <= 162, "${d}: got {got}, exact {w}");
        }
    }

    #[test]
    fn h_weight_never_decreases() {
        let mut prev = 0;
        let mut p = 0u64;
        while p <= usd(120_000) {
            let w = principal_weight_bps(p);
            assert!(w >= prev, "weight dropped at {p}");
            prev = w;
            p += usd(7) + 13;
        }
    }

    #[test]
    fn i_meaningful_loan() {
        assert!(meaningful_loan(usd(740), T0, T0 + 24 * H, OUTCOME_ON_TIME));
        assert!(meaningful_loan(usd(740), T0, T0 + 24 * H, OUTCOME_LATE));
        assert!(meaningful_loan(usd(100), T0, T0 + 24 * H, OUTCOME_ON_TIME));
        assert!(!meaningful_loan(usd(100) - 1, T0, T0 + 24 * H, OUTCOME_ON_TIME));
        assert!(!meaningful_loan(usd(740), T0, T0 + 24 * H - 1, OUTCOME_ON_TIME));
        assert!(!meaningful_loan(usd(740), T0, T0 + 30 * 24 * H, OUTCOME_LIQUIDATED));
        assert!(!meaningful_loan(usd(740), T0, T0 + 30 * 24 * H, OUTCOME_DEFAULTED));
        assert!(!meaningful_loan(usd(740), T0, T0 - 1, OUTCOME_ON_TIME));
    }

    #[test]
    fn j_duration() {
        assert_eq!(duration_bps(T0, T0), 0);
        assert_eq!(duration_bps(T0, T0 + 12 * H), 5_000);
        assert_eq!(duration_bps(T0, T0 + 24 * H), 10_000);
        assert_eq!(duration_bps(T0, T0 + 30 * 24 * H), 10_000);
        assert_eq!(duration_bps(T0, T0 - 5), 0);
        assert_eq!(duration_bps(i64::MIN, i64::MAX), 10_000);
    }

    #[test]
    fn k_contribution() {
        let day = T0 + 24 * H;
        assert_eq!(loan_contribution_bps(usd(740), T0, day, OUTCOME_ON_TIME), (10_000, 0));
        assert_eq!(loan_contribution_bps(usd(740), T0, T0 + 12 * H, OUTCOME_ON_TIME), (5_000, 0));
        assert_eq!(loan_contribution_bps(usd(740), T0, day, OUTCOME_LATE), (5_000, 0));
        assert_eq!(loan_contribution_bps(usd(150), T0, day, OUTCOME_ON_TIME), (2_026, 0));
        assert_eq!(loan_contribution_bps(usd(740), T0, T0 + H, OUTCOME_LIQUIDATED), (0, 20_000));
        assert_eq!(loan_contribution_bps(usd(740), T0, day, OUTCOME_DEFAULTED), (0, 30_000));
        assert_eq!(loan_contribution_bps(usd(200_000), T0, day, OUTCOME_ON_TIME), (11_000, 0));
        assert_eq!(loan_contribution_bps(usd(10), T0, day, OUTCOME_ON_TIME), (0, 0));
        assert_eq!(loan_contribution_bps(usd(740), T0, day, 9), (0, 0));
    }

    #[test]
    fn l_decay() {
        assert_eq!(decay_bps(20_000, T0, T0), 20_000);
        assert_eq!(decay_bps(20_000, T0, T0 + D90), 10_000);
        assert_eq!(decay_bps(20_000, T0, T0 + 2 * D90), 5_000);
        let half = decay_bps(20_000, T0, T0 + D90 / 2) as i64;
        assert!((half - 14_142).abs() <= 20, "45 days: {half}");
        let year = decay_bps(20_000, T0, T0 + 365 * 86_400) as i64;
        assert!((year - 1_203).abs() <= 20, "1 year: {year}");
        assert_eq!(decay_bps(20_000, T0, T0 - 1_000), 20_000);
        assert_eq!(decay_bps(20_000, T0, T0 + 64 * D90), 0);
        assert_eq!(decay_bps(u64::MAX, i64::MIN, i64::MAX), 0);
        assert_eq!(decay_bps(0, T0, T0 + D90), 0);
    }

    #[test]
    fn m_decay_never_increases() {
        let mut prev = u64::MAX;
        let mut t = T0;
        while t <= T0 + 3 * D90 {
            let v = decay_bps(30_000, T0, t);
            assert!(v <= prev, "penalty rose at {t}");
            prev = v;
            t += 7_919;
        }
    }
}