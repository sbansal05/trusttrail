mod common;

use {
    anchor_lang::{solana_program::instruction::Instruction, AccountDeserialize, InstructionData, ToAccountMetas},
    common::*,
};

fn read_pool(env: &Env) -> pool::state::PoolConfig {
    let account = env.svm.get_account(&env.pool).unwrap();
    pool::state::PoolConfig::try_deserialize(&mut account.data.as_slice()).unwrap()
}

#[test]
fn init_pool_stores_config() {
    let env = setup();
    let cfg = read_pool(&env);
    assert_eq!(cfg.usdc_mint, env.usdc_mint);
    assert_eq!(cfg.vault, env.vault);
    assert_eq!(cfg.lp_mint, env.lp_mint);
    assert_eq!(cfg.total_borrowed, 0);
}

#[test]
fn first_deposit_mints_shares_one_to_one() {
    let mut env = setup();
    let l = new_lender(&mut env, 500 * USDC);
    let ix = deposit_ix(&env, &l, 100 * USDC);
    assert!(send(&mut env.svm, &l.kp, ix));
    assert_eq!(balance(&env.svm, &env.vault), 100 * USDC);
    assert_eq!(balance(&env.svm, &l.lp), 100 * USDC);
    assert_eq!(balance(&env.svm, &l.usdc), 400 * USDC);
}

#[test]
fn second_lender_gets_same_price() {
    let mut env = setup();
    let a = new_lender(&mut env, 100 * USDC);
    let b = new_lender(&mut env, 100 * USDC);
    let ix = deposit_ix(&env, &a, 100 * USDC);
    assert!(send(&mut env.svm, &a.kp, ix));
    let ix = deposit_ix(&env, &b, 40 * USDC);
    assert!(send(&mut env.svm, &b.kp, ix));
    assert_eq!(balance(&env.svm, &b.lp), 40 * USDC);
    assert_eq!(balance(&env.svm, &env.vault), 140 * USDC);
}

#[test]
fn withdraw_burns_shares_and_returns_usdc() {
    let mut env = setup();
    let l = new_lender(&mut env, 100 * USDC);
    let ix = deposit_ix(&env, &l, 100 * USDC);
    assert!(send(&mut env.svm, &l.kp, ix));
    let ix = withdraw_ix(&env, &l, 30 * USDC);
    assert!(send(&mut env.svm, &l.kp, ix));
    assert_eq!(balance(&env.svm, &l.lp), 70 * USDC);
    assert_eq!(balance(&env.svm, &l.usdc), 30 * USDC);
    assert_eq!(balance(&env.svm, &env.vault), 70 * USDC);
}

#[test]
fn cannot_withdraw_more_shares_than_owned() {
    let mut env = setup();
    let l = new_lender(&mut env, 100 * USDC);
    let ix = deposit_ix(&env, &l, 100 * USDC);
    assert!(send(&mut env.svm, &l.kp, ix));
    let ix = withdraw_ix(&env, &l, 101 * USDC);
    assert!(!send(&mut env.svm, &l.kp, ix));
    assert_eq!(balance(&env.svm, &env.vault), 100 * USDC);
}

#[test]
fn zero_deposit_is_rejected() {
    let mut env = setup();
    let l = new_lender(&mut env, 100 * USDC);
    let ix = deposit_ix(&env, &l, 0);
    assert!(!send(&mut env.svm, &l.kp, ix));
}

#[test]
fn accrue_interest_moves_the_clock_forward() {
    let mut env = setup();
    set_clock(&mut env.svm, T0 + 86_400);
    let ix = Instruction::new_with_bytes(
        pool::id(),
        &pool::instruction::AccrueInterest {}.data(),
        pool::accounts::AccrueInterest { pool: env.pool, vault: env.vault }.to_account_metas(None),
    );
    let admin = env.admin.insecure_clone();
    assert!(send(&mut env.svm, &admin, ix));

    let cfg = read_pool(&env);
    assert_eq!(cfg.last_accrual, T0 + 86_400);
    assert_eq!(cfg.total_borrowed, 0);
    // the index is a clock: it moves at each tier's rate even with no debt
    let w = pool::rates::WAD;
    assert!(cfg.tier_index[0] > cfg.tier_index[1]);
    assert!(cfg.tier_index[1] > cfg.tier_index[2]);
    assert!(cfg.tier_index[2] > cfg.tier_index[3]);
    assert!(cfg.tier_index[3] > w);
    assert_eq!(cfg.tier_index[2], w + w * 200 * 86_400 / (10_000 * 365 * 86_400));
}