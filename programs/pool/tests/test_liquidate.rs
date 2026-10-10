mod common;

use {
    anchor_lang::{solana_program::instruction::Instruction, InstructionData, ToAccountMetas},
    common::{market::*, *},
    litesvm_token::CreateMint,
    pool::state::*,
    solana_signer::Signer,
};

const PRICE_109: i64 = 10_900_000_000;
const DUE: i64 = T0 + 30 * DAY;
const GRACE_END: i64 = DUE + 3 * DAY;

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
fn price_drop_lets_anyone_liquidate_at_the_sol_bonus() {
    let mut m = market();
    let (b, liq) = loan_and_liquidator(&mut m);
    set_price(&mut m, SOL_FEED, PRICE_109, 0, T0); // $109 → 109% < SOL's 110%

    let ix = liquidate_ix(&m, &b, &liq, 0);
    assert!(send(&mut m.env.svm, &liq.kp, ix));

    // Liquidator paid the 100 USDC debt and got $105 of SOL (5% bonus)
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
    assert_eq!(pool.bad_debt, 0);
    let rep = reputation(&m, &b.kp.pubkey());
    assert_eq!(rep.liquidated_loans, 1);
    assert_eq!(rep.last_liquidation_date, T0);
}

#[test]
fn collateral_that_covers_only_the_debt_leaves_no_bad_debt() {
    let mut m = market();
    let (b, liq) = loan_and_liquidator(&mut m);
    set_price(&mut m, SOL_FEED, 10_400_000_000, 0, T0); // $104: covers the debt, not debt + 5%

    let ix = liquidate_ix(&m, &b, &liq, 0);
    assert!(send(&mut m.env.svm, &liq.kp, ix));

    // Liquidator pays the whole 100 and takes all the SOL ($4 bonus instead of $5)
    assert_eq!(balance(&m.env.svm, &liq.usdc), 100 * USDC);
    assert_eq!(balance(&m.env.svm, &liq.sol), SOL);
    let pool: PoolConfig = read(&m, &m.env.pool);
    assert_eq!(pool.bad_debt, 0);
    assert_eq!(balance(&m.env.svm, &m.env.vault), 10_000 * USDC);
}

#[test]
fn short_collateral_is_recovered_and_the_rest_is_bad_debt() {
    let mut m = market();
    let (b, liq) = loan_and_liquidator(&mut m);
    set_price(&mut m, SOL_FEED, 7_000_000_000, 0, T0); // $70: 1 SOL no longer covers the 100 USDC debt

    let ix = liquidate_ix(&m, &b, &liq, 0);
    assert!(send(&mut m.env.svm, &liq.kp, ix));

    // Liquidator pays 70 / 1.05 = 66.666667 and takes all the SOL
    assert_eq!(balance(&m.env.svm, &liq.usdc), 200 * USDC - 66_666_667);
    assert_eq!(balance(&m.env.svm, &liq.sol), SOL);
    assert_eq!(balance(&m.env.svm, &b.sol), SOL); // the SOL the borrower never posted
    // The pool books the shortfall: lenders own 10,000 − 33.333333 now
    let pool: PoolConfig = read(&m, &m.env.pool);
    assert_eq!(pool.bad_debt, 33_333_333);
    assert_eq!(pool.total_borrowed, 0);
    let vault = balance(&m.env.svm, &m.env.vault);
    assert_eq!(vault, 10_000 * USDC - 100 * USDC + 66_666_667);
    assert_eq!(pool.total_assets(vault), Some(10_000 * USDC - 33_333_333));
    let loan: Loan = read(&m, &loan_address(&b, 0));
    assert_eq!(loan.status, LOAN_LIQUIDATED);
}

#[test]
fn a_healthy_loan_is_safe_until_the_grace_period_ends() {
    let mut m = market();
    let (b, liq) = loan_and_liquidator(&mut m);
    set_clock(&mut m.env.svm, GRACE_END); // last second of the 3-day grace
    set_price(&mut m, SOL_FEED, SOL_PRICE, 0, GRACE_END);
    let ix = liquidate_ix(&m, &b, &liq, 0);
    assert!(!send(&mut m.env.svm, &liq.kp, ix));
}

#[test]
fn after_the_grace_period_a_healthy_loan_defaults() {
    let mut m = market();
    let (b, liq) = loan_and_liquidator(&mut m);
    set_clock(&mut m.env.svm, GRACE_END + 1);
    set_price(&mut m, SOL_FEED, SOL_PRICE, 0, GRACE_END + 1); // $150: still 150%, healthy

    let ix = liquidate_ix(&m, &b, &liq, 0);
    assert!(send(&mut m.env.svm, &liq.kp, ix));

    // Liquidator paid the debt with 33 days of interest and got that plus 5% in SOL
    let paid = 200 * USDC - balance(&m.env.svm, &liq.usdc);
    assert!(paid > 100 * USDC);
    assert!(balance(&m.env.svm, &liq.sol) > 0);
    assert!(balance(&m.env.svm, &b.sol) > SOL); // the rest came back to the borrower
    let loan: Loan = read(&m, &loan_address(&b, 0));
    assert_eq!(loan.status, LOAN_DEFAULTED);
    let pool: PoolConfig = read(&m, &m.env.pool);
    assert_eq!(pool.bad_debt, 0);
    // TrustTrail counts it with liquidations and starts the 90-day block
    let rep = reputation(&m, &b.kp.pubkey());
    assert_eq!(rep.liquidated_loans, 1);
    assert_eq!(rep.last_liquidation_date, GRACE_END + 1);
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
    let ix = borrow_ix(&m, &b, 0, 100 * USDC, 800_000_000); // Gold, 120%
    assert!(send(&mut m.env.svm, &b.kp, ix));
    let liq = new_liquidator(&mut m, 200 * USDC);

    set_price(&mut m, SOL_FEED, 13_500_000_000, 0, T0); // $135 → 108%
    let ix = liquidate_ix(&m, &b, &liq, 0);
    assert!(send(&mut m.env.svm, &liq.kp, ix));

    // Price is back, but the 90-day block applies: 120% is no longer enough
    set_price(&mut m, SOL_FEED, SOL_PRICE, 0, T0);
    let ix = borrow_ix(&m, &b, 1, 100 * USDC, 800_000_000);
    assert!(!send(&mut m.env.svm, &b.kp, ix));
    // Bronze needs 140%: 1 SOL = $150 is enough
    let ix = borrow_ix(&m, &b, 1, 100 * USDC, SOL);
    assert!(send(&mut m.env.svm, &b.kp, ix));
    let loan: Loan = read(&m, &loan_address(&b, 1));
    assert_eq!(loan.tier_at_open, 1);
}

#[test]
fn collateral_with_a_threshold_too_low_for_its_bonus_is_refused() {
    let mut m = market();
    let admin = m.env.admin.insecure_clone();
    let mint = CreateMint::new(&mut m.env.svm, &admin).decimals(6).send().unwrap();
    // 103% leaves no room for a 5% bonus
    let ix = add_collateral_ix(&m.env, &mint, 10_300, 500);
    assert!(!send(&mut m.env.svm, &admin, ix));
    // at Gold's 120% a Gold loan would be liquidatable the moment it opens
    let ix = add_collateral_ix(&m.env, &mint, 12_000, 500);
    assert!(!send(&mut m.env.svm, &admin, ix));
    // USDC's 105% / 2% is fine
    let ix = add_collateral_ix(&m.env, &mint, 10_500, 200);
    assert!(send(&mut m.env.svm, &admin, ix));
    let cfg: CollateralConfig = read(&m, &pda(&[pool::constants::COLLATERAL_SEED, mint.as_ref()]));
    assert_eq!((cfg.liq_threshold_bps, cfg.liq_bonus_bps), (10_500, 200));
}


#[test]
fn the_fee_reserve_covers_bad_debt_before_lenders() {
    let mut m = market();
    let (b, liq) = loan_and_liquidator(&mut m);

    // 20 days of interest: the protocol's 10% cut builds up the reserve
    let now = T0 + 20 * DAY;
    set_clock(&mut m.env.svm, now);
    let ix = Instruction::new_with_bytes(
        pool::id(),
        &pool::instruction::AccrueInterest {}.data(),
        pool::accounts::AccrueInterest { pool: m.env.pool, vault: m.env.vault }.to_account_metas(None),
    );
    let admin = m.env.admin.insecure_clone();
    assert!(send(&mut m.env.svm, &admin, ix));
    let before: PoolConfig = read(&m, &m.env.pool);
    let reserve = before.protocol_fees;
    assert!(reserve > 0);
    let debt = read::<Loan>(&m, &loan_address(&b, 0)).debt(&before).unwrap();

    // $70: 1 SOL no longer covers the debt
    set_price(&mut m, SOL_FEED, 7_000_000_000, 0, now);
    let ix = liquidate_ix(&m, &b, &liq, 0);
    assert!(send(&mut m.env.svm, &liq.kp, ix));

    let paid = 200 * USDC - balance(&m.env.svm, &liq.usdc);
    let shortfall = debt - paid;
    let pool: PoolConfig = read(&m, &m.env.pool);
    // The reserve was used up first; lenders carry only what was left
    assert_eq!(pool.protocol_fees, 0);
    assert_eq!(pool.bad_debt, shortfall - reserve);
}