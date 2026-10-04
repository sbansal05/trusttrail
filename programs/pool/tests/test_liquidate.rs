mod common;

use {
    common::{market::*, *},
    pool::state::*,
    solana_signer::Signer,
};

const PRICE_109: i64 = 10_900_000_000;

/// Unproven wallet borrows 100 USDC against 1 SOL (150%), and a liquidator with 200 USDC.
fn loan_and_liquidator(m: &mut Market) -> (Borrower, Borrower) {
    let b = new_borrower(m, 2 * SOL, false);
    let ix = borrow_ix(m, &b, 0, 100 * USDC, SOL);
    assert!(send(&mut m.env.svm, &b.kp, ix));
    let liq = new_liquidator(m, 200 * USDC);
    (b, liq)
}

#[test]
fn a_healthy_loan_cannot_be_liquidated() {
    let mut m = market();
    let (b, liq) = loan_and_liquidator(&mut m);
    set_price(&mut m, SOL_FEED, 12_000_000_000, 0, T0); // $120 → 120% ≥ 110%
    let ix = liquidate_ix(&m, &b, &liq, 0);
    assert!(!send(&mut m.env.svm, &liq.kp, ix));
}

#[test]
fn price_drop_lets_anyone_liquidate_at_a_5_percent_bonus() {
    let mut m = market();
    let (b, liq) = loan_and_liquidator(&mut m);
    set_price(&mut m, SOL_FEED, PRICE_109, 0, T0); // $109 → 109% < 110%

    let ix = liquidate_ix(&m, &b, &liq, 0);
    assert!(send(&mut m.env.svm, &liq.kp, ix));

    // Liquidator paid the 100 USDC debt and got $105 of SOL
    assert_eq!(balance(&m.env.svm, &liq.usdc), 100 * USDC);
    assert_eq!(balance(&m.env.svm, &liq.sol), 963_302_752);
    // The rest of the collateral went back to the borrower
    assert_eq!(balance(&m.env.svm, &b.sol), 2 * SOL - 963_302_752);
    assert_eq!(balance(&m.env.svm, &m.coll_vault), 0);
    // Lenders are whole
    assert_eq!(balance(&m.env.svm, &m.env.vault), 10_000 * USDC);

    let loan: Loan = read(&m, &loan_address(&b, 0));
    assert_eq!(loan.status, LOAN_LIQUIDATED);
    let pool: PoolConfig = read(&m, &m.env.pool);
    assert_eq!(pool.total_borrowed, 0);
    let rep = reputation(&m, &b.kp.pubkey());
    assert_eq!(rep.liquidated_loans, 1);
    assert_eq!(rep.last_liquidation_date, T0);
}

#[test]
fn a_repaid_loan_cannot_be_liquidated() {
    let mut m = market();
    let (b, liq) = loan_and_liquidator(&mut m);
    mint_usdc(&mut m, &b.usdc, 5 * USDC);
    let ix = repay_ix(&m, &b, &b, 0);
    assert!(send(&mut m.env.svm, &b.kp, ix));
    set_price(&mut m, SOL_FEED, PRICE_109, 0, T0);
    let ix = liquidate_ix(&m, &b, &liq, 0);
    assert!(!send(&mut m.env.svm, &liq.kp, ix));
}

#[test]
fn a_liquidated_gold_wallet_drops_to_bronze() {
    let mut m = market();
    let b = new_borrower(&mut m, 3 * SOL, true);
    let ix = borrow_ix(&m, &b, 0, 100 * USDC, 766_666_667); // Gold, 115%
    assert!(send(&mut m.env.svm, &b.kp, ix));
    let liq = new_liquidator(&mut m, 200 * USDC);

    set_price(&mut m, SOL_FEED, 14_000_000_000, 0, T0); // $140 → 107%
    let ix = liquidate_ix(&m, &b, &liq, 0);
    assert!(send(&mut m.env.svm, &liq.kp, ix));

    // Price is back, but the 90-day block applies: 115% is no longer enough
    set_price(&mut m, SOL_FEED, SOL_PRICE, 0, T0);
    let ix = borrow_ix(&m, &b, 1, 100 * USDC, 766_666_667);
    assert!(!send(&mut m.env.svm, &b.kp, ix));
    // Bronze needs 140%: 1 SOL = $150 is enough
    let ix = borrow_ix(&m, &b, 1, 100 * USDC, SOL);
    assert!(send(&mut m.env.svm, &b.kp, ix));
    let loan: Loan = read(&m, &loan_address(&b, 1));
    assert_eq!(loan.tier_at_open, 1);
}