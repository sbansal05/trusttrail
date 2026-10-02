mod common;

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas,
    },
    common::*,
    litesvm_token::{spl_token, CreateMint},
    pool::{constants::*, oracle::encode_price_update, state::*},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_signer::Signer,
    trusttrail::state::UserReputationV2,
};

const SOL_FEED: [u8; 32] = [7u8; 32];
const SOL: u64 = 1_000_000_000; // 9 decimals
const SOL_PRICE: i64 = 15_000_000_000; // $150.00 with expo -8
const MAX_AGE: u32 = 60;

struct Market {
    env: Env,
    sol_mint: Pubkey,
    config: Pubkey,
    coll_vault: Pubkey,
    price: Pubkey,
}

/// Pool with 10,000 USDC from a lender, SOL accepted for every tier, and a SOL/USD price.
fn market() -> Market {
    let mut env = setup();
    let lender = new_lender(&mut env, 10_000 * USDC);
    let ix = deposit_ix(&env, &lender, 10_000 * USDC);
    assert!(send(&mut env.svm, &lender.kp, ix));

    let sol_mint = CreateMint::new(&mut env.svm, &env.admin).decimals(9).send().unwrap();
    let config = pda(&[COLLATERAL_SEED, sol_mint.as_ref()]);
    let coll_vault = pda(&[COLL_VAULT_SEED, env.pool.as_ref(), sol_mint.as_ref()]);
    let ix = Instruction::new_with_bytes(
        pool::id(),
        &pool::instruction::AddCollateral { feed_id: SOL_FEED, min_tier: 0, max_age_secs: MAX_AGE }.data(),
        pool::accounts::AddCollateral {
            authority: env.admin.pubkey(),
            pool: env.pool,
            mint: sol_mint,
            config,
            vault: coll_vault,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let admin = env.admin.insecure_clone();
    assert!(send(&mut env.svm, &admin, ix));

    let price = Pubkey::new_unique();
    let mut m = Market { env, sol_mint, config, coll_vault, price };
    set_price(&mut m, SOL_FEED, SOL_PRICE, 0, T0);
    m
}

/// Writes a Pyth PriceUpdateV2 account owned by the Pyth receiver program.
fn set_price(m: &mut Market, feed: [u8; 32], price: i64, conf: u64, publish_time: i64) {
    let data = encode_price_update(feed, price, conf, -8, publish_time);
    let lamports = m.env.svm.minimum_balance_for_rent_exemption(data.len());
    m.env
        .svm
        .set_account(m.price, Account { lamports, data, owner: PYTH_RECEIVER_ID, executable: false, rent_epoch: 0 })
        .unwrap();
}

/// Writes a TrustTrail score account for `wallet`, as if record_event had built it up.
/// gold = true gives 8 meaningful on-time median loans (score 1000, Gold).
fn set_reputation(m: &mut Market, wallet: &Pubkey, gold: bool) {
    let (addr, bump) =
        Pubkey::find_program_address(&[trusttrail::USER_REPUTATION_V2_SEED, wallet.as_ref()], &trusttrail::ID);
    let (s_plus, on_time, weight) = if gold { (80_000, 8, 80_000) } else { (0, 0, 0) };
    let rep = UserReputationV2 {
        wallet: *wallet,
        score: 0,
        native_score: 0,
        imported_score: 0,
        import_date: 0,
        tier: 0,
        loans_repaid_on_time: on_time,
        late_repaid_loans: 0,
        liquidated_loans: 0,
        current_on_time_streak: on_time,
        last_liquidation_date: 0,
        total_usdc_repaid: 0,
        last_update: T0,
        s_plus_bps: s_plus,
        s_minus_bps: 0,
        s_minus_at: T0,
        exposure_bps: s_plus,
        meaningful_on_time: on_time,
        meaningful_weight_bps: weight,
        bump,
    };
    let mut data = Vec::with_capacity(8 + UserReputationV2::INIT_SPACE);
    rep.try_serialize(&mut data).unwrap();
    let lamports = m.env.svm.minimum_balance_for_rent_exemption(data.len());
    m.env
        .svm
        .set_account(addr, Account { lamports, data, owner: trusttrail::ID, executable: false, rent_epoch: 0 })
        .unwrap();
}

struct Borrower {
    kp: Keypair,
    sol: Pubkey,
    usdc: Pubkey,
}

fn new_borrower(m: &mut Market, sol: u64, gold: bool) -> Borrower {
    let sol_mint = m.sol_mint;
    let usdc_mint = m.env.usdc_mint;
    let (kp, sol_ata) = funded_wallet(&mut m.env, &sol_mint, sol);
    let usdc = token_account(&mut m.env, &kp, &usdc_mint);
    set_reputation(m, &kp.pubkey(), gold);
    Borrower { kp, sol: sol_ata, usdc }
}

fn loan_address(b: &Borrower, id: u64) -> Pubkey {
    pda(&[LOAN_SEED, b.kp.pubkey().as_ref(), &id.to_le_bytes()])
}

fn borrow_ix(m: &Market, b: &Borrower, loan_id: u64, amount: u64, collateral: u64) -> Instruction {
    let wallet = b.kp.pubkey();
    Instruction::new_with_bytes(
        pool::id(),
        &pool::instruction::Borrow { amount, collateral_amount: collateral }.data(),
        pool::accounts::Borrow {
            borrower: wallet,
            pool: m.env.pool,
            vault: m.env.vault,
            reputation: Pubkey::find_program_address(
                &[trusttrail::USER_REPUTATION_V2_SEED, wallet.as_ref()],
                &trusttrail::ID,
            )
            .0,
            borrower_state: pda(&[BORROWER_SEED, wallet.as_ref()]),
            loan: loan_address(b, loan_id),
            collateral_config: m.config,
            collateral_vault: m.coll_vault,
            price_update: m.price,
            borrower_collateral: b.sol,
            borrower_usdc: b.usdc,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn read<T: AccountDeserialize>(m: &Market, key: &Pubkey) -> T {
    let account = m.env.svm.get_account(key).unwrap();
    T::try_deserialize(&mut account.data.as_slice()).unwrap()
}

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
fn gold_needs_only_115_percent() {
    let mut m = market();
    let b = new_borrower(&mut m, 2 * SOL, true);
    let collateral = 766_666_667; // 0.7667 SOL ≈ $115
    let ix = borrow_ix(&m, &b, 0, 100 * USDC, collateral);
    assert!(send(&mut m.env.svm, &b.kp, ix));
    let loan: Loan = read(&m, &loan_address(&b, 0));
    assert_eq!(loan.tier_at_open, 3);
    assert_eq!(loan.collateral_ratio_bps, 11_500);
}

#[test]
fn the_same_collateral_is_not_enough_for_unproven() {
    let mut m = market();
    let b = new_borrower(&mut m, 2 * SOL, false);
    let ix = borrow_ix(&m, &b, 0, 100 * USDC, 766_666_667);
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