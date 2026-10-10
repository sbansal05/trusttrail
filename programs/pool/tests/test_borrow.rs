mod common;

use {
    common::{market::*, *},
    pool::{constants::*, state::*},
    solana_signer::Signer,
};


#[test]
fn unproven_borrows_100_against_150_percent() {
    let mut m = market();
    let b = new_borrower(&mut m, 2 * SOL, false);
    let ix = borrow_ix(&m, &b, 0, 100 * USDC, SOL); // 1 SOL = $150 = 150%
    assert!(send(&mut m.env.svm, &b.kp, ix));

    assert_eq!(balance(&m.env.svm, &b.usdc), 100 * USDC);
    assert_eq!(balance(&m.env.svm, &b.sol), SOL);
    assert_eq!(balance(&m.env.svm, &m.coll_vault), SOL);
    assert_eq!(balance(&m.env.svm, &m.env.vault), 9_900 * USDC);

    let loan: Loan = read(&m, &loan_address(&b, 0));
    assert_eq!(loan.borrower, b.kp.pubkey());
    assert_eq!(loan.tier_at_open, 0);
    assert_eq!(loan.principal, 100 * USDC);
    assert_eq!(loan.collateral_ratio_bps, 15_000);
    assert_eq!(loan.due_at, loan.opened_at + 30 * 86_400);

    let pool: PoolConfig = read(&m, &m.env.pool);
    assert_eq!(pool.total_borrowed, 100 * USDC);
    let state: BorrowerState = read(&m, &pda(&[BORROWER_SEED, b.kp.pubkey().as_ref()]));
    assert_eq!(state.next_loan_id, 1);
    assert_eq!(state.open_loans, 1);
}

#[test]
fn unproven_with_less_than_150_percent_is_rejected() {
    let mut m = market();
    let b = new_borrower(&mut m, 2 * SOL, false);
    let ix = borrow_ix(&m, &b, 0, 100 * USDC, SOL - 10_000_000); // $148.50
    assert!(!send(&mut m.env.svm, &b.kp, ix));
}

#[test]
fn unproven_cannot_borrow_over_100() {
    let mut m = market();
    let b = new_borrower(&mut m, 5 * SOL, false);
    let ix = borrow_ix(&m, &b, 0, 101 * USDC, 5 * SOL);
    assert!(!send(&mut m.env.svm, &b.kp, ix));
}

#[test]
fn gold_needs_only_120_percent() {
    let mut m = market();
    let b = new_borrower(&mut m, 2 * SOL, true);
    let collateral = 800_000_000; // 0.8 SOL = $120
    let ix = borrow_ix(&m, &b, 0, 100 * USDC, collateral);
    assert!(send(&mut m.env.svm, &b.kp, ix));
    let loan: Loan = read(&m, &loan_address(&b, 0));
    assert_eq!(loan.tier_at_open, 3);
    assert_eq!(loan.collateral_ratio_bps, 12_000);
}

#[test]
fn gold_below_120_percent_is_refused() {
    let mut m = market();
    let b = new_borrower(&mut m, 2 * SOL, true);
    let ix = borrow_ix(&m, &b, 0, 100 * USDC, 793_333_333); // ≈ $119
    assert!(!send(&mut m.env.svm, &b.kp, ix));
}

#[test]
fn the_same_collateral_is_not_enough_for_unproven() {
    let mut m = market();
    let b = new_borrower(&mut m, 2 * SOL, false);
    let ix = borrow_ix(&m, &b, 0, 100 * USDC, 800_000_000);
    assert!(!send(&mut m.env.svm, &b.kp, ix));
}

#[test]
fn stale_price_is_rejected() {
    let mut m = market();
    set_price(&mut m, SOL_FEED, SOL_PRICE, 0, T0 - MAX_AGE as i64 - 1);
    let b = new_borrower(&mut m, 2 * SOL, false);
    let ix = borrow_ix(&m, &b, 0, 100 * USDC, SOL);
    assert!(!send(&mut m.env.svm, &b.kp, ix));
}

#[test]
fn price_for_another_asset_is_rejected() {
    let mut m = market();
    set_price(&mut m, [9u8; 32], SOL_PRICE, 0, T0);
    let b = new_borrower(&mut m, 2 * SOL, false);
    let ix = borrow_ix(&m, &b, 0, 100 * USDC, SOL);
    assert!(!send(&mut m.env.svm, &b.kp, ix));
}

#[test]
fn second_loan_gets_the_next_id() {
    let mut m = market();
    let b = new_borrower(&mut m, 3 * SOL, false);
    let ix = borrow_ix(&m, &b, 0, 50 * USDC, SOL);
    assert!(send(&mut m.env.svm, &b.kp, ix));
    let ix = borrow_ix(&m, &b, 1, 50 * USDC, SOL);
    assert!(send(&mut m.env.svm, &b.kp, ix));
    let state: BorrowerState = read(&m, &pda(&[BORROWER_SEED, b.kp.pubkey().as_ref()]));
    assert_eq!(state.next_loan_id, 2);
    assert_eq!(state.open_loans, 2);
}


#[test]
fn new_borrows_stop_at_90_percent_so_lenders_can_still_withdraw() {
    let mut m = market(); // 10,000 USDC in the pool
    // 90 loans of 100 take the pool to exactly 90% lent
    for _ in 0..90 {
        let b = new_borrower(&mut m, 2 * SOL, false);
        let ix = borrow_ix(&m, &b, 0, 100 * USDC, SOL);
        assert!(send(&mut m.env.svm, &b.kp, ix));
    }
    assert_eq!(balance(&m.env.svm, &m.env.vault), 1_000 * USDC);
    // The 91st is refused even though 1,000 USDC sits idle: that tenth stays for withdrawals
    let b = new_borrower(&mut m, 2 * SOL, false);
    let ix = borrow_ix(&m, &b, 0, 100 * USDC, SOL);
    assert!(!send(&mut m.env.svm, &b.kp, ix));
    let pool: PoolConfig = read(&m, &m.env.pool);
    assert_eq!(pool.total_borrowed, 9_000 * USDC);
}