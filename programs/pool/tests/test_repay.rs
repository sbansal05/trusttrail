mod common;

use {
    common::{market::*, *},
    pool::{constants::*, state::*},
    solana_signer::Signer,
};

/// Unproven wallet borrows 100 USDC against 1 SOL (150%) at T0; its USDC account gets
/// 5 extra USDC for interest.
fn borrowed_100(m: &mut Market) -> Borrower {
    let b = new_borrower(m, 2 * SOL, false);
    let ix = borrow_ix(m, &b, 0, 100 * USDC, SOL);
    assert!(send(&mut m.env.svm, &b.kp, ix));
    mint_usdc(m, &b.usdc, 5 * USDC);
    b
}

#[test]
fn on_time_repay_returns_collateral_and_writes_the_record() {
    let mut m = market();
    let b = borrowed_100(&mut m);
    set_clock(&mut m.env.svm, T0 + 10 * DAY);

    let ix = repay_ix(&m, &b, &b, 0);
    assert!(send(&mut m.env.svm, &b.kp, ix));

    // Paid principal + 10 days of interest; got all the SOL back
    let paid = 105 * USDC - balance(&m.env.svm, &b.usdc);
    assert!(paid > 100 * USDC && paid < 101 * USDC, "paid {paid}");
    assert_eq!(balance(&m.env.svm, &m.env.vault), 9_900 * USDC + paid);
    assert_eq!(balance(&m.env.svm, &b.sol), 2 * SOL);
    assert_eq!(balance(&m.env.svm, &m.coll_vault), 0);

    // Books closed
    let loan: Loan = read(&m, &loan_address(&b, 0));
    assert_eq!(loan.status, LOAN_REPAID);
    let pool: PoolConfig = read(&m, &m.env.pool);
    assert_eq!(pool.tier_scaled_debt[0], 0);
    assert_eq!(pool.total_borrowed, 0);
    let state: BorrowerState = read(&m, &pda(&[BORROWER_SEED, b.kp.pubkey().as_ref()]));
    assert_eq!(state.open_loans, 0);
    assert_eq!(state.largest_repaid, 100 * USDC);

    // TrustTrail saw it, and the SAS attestation exists at the loan's nonce
    let rep = reputation(&m, &b.kp.pubkey());
    assert_eq!(rep.loans_repaid_on_time, 1);
    assert_eq!(rep.total_usdc_repaid, 100 * USDC);
    assert!(m.env.svm.get_account(&attestation_of(&loan_address(&b, 0))).is_some());
}

#[test]
fn late_repay_is_recorded_late_and_does_not_raise_the_limit() {
    let mut m = market();
    let b = borrowed_100(&mut m);
    set_clock(&mut m.env.svm, T0 + 31 * DAY); // due at day 30

    let ix = repay_ix(&m, &b, &b, 0);
    assert!(send(&mut m.env.svm, &b.kp, ix));

    let rep = reputation(&m, &b.kp.pubkey());
    assert_eq!(rep.late_repaid_loans, 1);
    assert_eq!(rep.loans_repaid_on_time, 0);
    let state: BorrowerState = read(&m, &pda(&[BORROWER_SEED, b.kp.pubkey().as_ref()]));
    assert_eq!(state.largest_repaid, 0);
}

#[test]
fn a_loan_cannot_be_repaid_twice() {
    let mut m = market();
    let b = borrowed_100(&mut m);
    let ix = repay_ix(&m, &b, &b, 0);
    assert!(send(&mut m.env.svm, &b.kp, ix));
    let ix = repay_ix(&m, &b, &b, 0);
    assert!(!send(&mut m.env.svm, &b.kp, ix));
}

#[test]
fn someone_else_cannot_close_your_loan() {
    let mut m = market();
    let b = borrowed_100(&mut m);
    let other = borrowed_100(&mut m); // has its own loan, so its BorrowerState exists
    mint_usdc(&mut m, &other.usdc, 200 * USDC);
    let ix = repay_ix(&m, &b, &other, 0); // other's accounts, b's loan
    assert!(!send(&mut m.env.svm, &other.kp, ix));
}

#[test]
fn repaying_on_time_unlocks_a_bigger_loan() {
    let mut m = market();
    let b = new_borrower(&mut m, 4 * SOL, true); // Gold, but nothing repaid yet → limit 100
    let ix = borrow_ix(&m, &b, 0, 200 * USDC, 2 * SOL);
    assert!(!send(&mut m.env.svm, &b.kp, ix));

    let ix = borrow_ix(&m, &b, 0, 100 * USDC, SOL);
    assert!(send(&mut m.env.svm, &b.kp, ix));
    mint_usdc(&mut m, &b.usdc, 5 * USDC);
    set_clock(&mut m.env.svm, T0 + 2 * DAY);
    set_price(&mut m, SOL_FEED, SOL_PRICE, 0, T0 + 2 * DAY);
    let ix = repay_ix(&m, &b, &b, 0);
    assert!(send(&mut m.env.svm, &b.kp, ix));

    // largest_repaid = 100 → the next loan may be 200
    let ix = borrow_ix(&m, &b, 1, 200 * USDC, 2 * SOL);
    assert!(send(&mut m.env.svm, &b.kp, ix));
}