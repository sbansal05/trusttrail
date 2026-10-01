use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{get_spl_account, spl_token, CreateAssociatedTokenAccount, CreateMint, MintTo},
    pool::constants::*,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const USDC: u64 = 1_000_000;

fn send(svm: &mut LiteSVM, signer: &Keypair, ix: Instruction) -> bool {
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    match svm.send_transaction(tx) {
        Ok(_) => true,
        Err(e) => {
            println!("tx failed: {:?}", e.err);
            for log in &e.meta.logs {
                println!("  {log}");
            }
            false
        }
    }
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &pool::id()).0
}

fn balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    get_spl_account::<spl_token::state::Account>(svm, token_account).unwrap().amount
}

struct Env {
    svm: LiteSVM,
    pool: Pubkey,
    vault: Pubkey,
    lp_mint: Pubkey,
    usdc_mint: Pubkey,
}

struct Lender {
    kp: Keypair,
    usdc: Pubkey,
    lp: Pubkey,
}

/// Pool initialised with a fresh 6-decimal "USDC" mint. Returns the env and the
/// admin, who is also the USDC mint authority (tests use it to fund lenders).
fn setup() -> (Env, Keypair) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/pool.so"));
    svm.add_program(pool::id(), bytes).unwrap();
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let usdc_mint = CreateMint::new(&mut svm, &admin).decimals(6).send().unwrap();
    let pool = pda(&[POOL_SEED]);
    let vault = pda(&[VAULT_SEED, pool.as_ref()]);
    let lp_mint = pda(&[LP_MINT_SEED, pool.as_ref()]);
    let ix = Instruction::new_with_bytes(
        pool::id(),
        &pool::instruction::InitPool {}.data(),
        pool::accounts::InitPool {
            authority: admin.pubkey(),
            pool,
            usdc_mint,
            vault,
            lp_mint,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    assert!(send(&mut svm, &admin, ix));
    (Env { svm, pool, vault, lp_mint, usdc_mint }, admin)
}

/// A lender with `usdc` USDC and an empty LP account.
fn new_lender(env: &mut Env, mint_authority: &Keypair, usdc: u64) -> Lender {
    let kp = Keypair::new();
    env.svm.airdrop(&kp.pubkey(), 1_000_000_000).unwrap();
    let usdc_ata = CreateAssociatedTokenAccount::new(&mut env.svm, &kp, &env.usdc_mint).send().unwrap();
    let lp_ata = CreateAssociatedTokenAccount::new(&mut env.svm, &kp, &env.lp_mint).send().unwrap();
    MintTo::new(&mut env.svm, mint_authority, &env.usdc_mint, &usdc_ata, usdc).send().unwrap();
    Lender { kp, usdc: usdc_ata, lp: lp_ata }
}

fn deposit_ix(env: &Env, l: &Lender, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        pool::id(),
        &pool::instruction::Deposit { amount }.data(),
        pool::accounts::Deposit {
            lender: l.kp.pubkey(),
            pool: env.pool,
            vault: env.vault,
            lp_mint: env.lp_mint,
            lender_usdc: l.usdc,
            lender_lp: l.lp,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    )
}

fn withdraw_ix(env: &Env, l: &Lender, shares: u64) -> Instruction {
    Instruction::new_with_bytes(
        pool::id(),
        &pool::instruction::Withdraw { shares }.data(),
        pool::accounts::Withdraw {
            lender: l.kp.pubkey(),
            pool: env.pool,
            vault: env.vault,
            lp_mint: env.lp_mint,
            lender_usdc: l.usdc,
            lender_lp: l.lp,
            token_program: spl_token::ID,
        }
        .to_account_metas(None),
    )
}

#[test]
fn init_pool_stores_config() {
    let (env, _admin) = setup();
    let account = env.svm.get_account(&env.pool).unwrap();
    let cfg = pool::state::PoolConfig::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(cfg.usdc_mint, env.usdc_mint);
    assert_eq!(cfg.vault, env.vault);
    assert_eq!(cfg.lp_mint, env.lp_mint);
    assert_eq!(cfg.total_borrowed, 0);
}

#[test]
fn first_deposit_mints_shares_one_to_one() {
    let (mut env, admin) = setup();
    let l = new_lender(&mut env, &admin, 500 * USDC);
    let ix = deposit_ix(&env, &l, 100 * USDC);
    assert!(send(&mut env.svm, &l.kp, ix));
    assert_eq!(balance(&env.svm, &env.vault), 100 * USDC);
    assert_eq!(balance(&env.svm, &l.lp), 100 * USDC);
    assert_eq!(balance(&env.svm, &l.usdc), 400 * USDC);
}

#[test]
fn second_lender_gets_same_price() {
    let (mut env, admin) = setup();
    let a = new_lender(&mut env, &admin, 100 * USDC);
    let b = new_lender(&mut env, &admin, 100 * USDC);
    let ix = deposit_ix(&env, &a, 100 * USDC);
    assert!(send(&mut env.svm, &a.kp, ix));
    let ix = deposit_ix(&env, &b, 40 * USDC);
    assert!(send(&mut env.svm, &b.kp, ix));
    assert_eq!(balance(&env.svm, &b.lp), 40 * USDC);
    assert_eq!(balance(&env.svm, &env.vault), 140 * USDC);
}

#[test]
fn withdraw_burns_shares_and_returns_usdc() {
    let (mut env, admin) = setup();
    let l = new_lender(&mut env, &admin, 100 * USDC);
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
    let (mut env, admin) = setup();
    let l = new_lender(&mut env, &admin, 100 * USDC);
    let ix = deposit_ix(&env, &l, 100 * USDC);
    assert!(send(&mut env.svm, &l.kp, ix));
    let ix = withdraw_ix(&env, &l, 101 * USDC);
    assert!(!send(&mut env.svm, &l.kp, ix));
    assert_eq!(balance(&env.svm, &env.vault), 100 * USDC);
}

#[test]
fn zero_deposit_is_rejected() {
    let (mut env, admin) = setup();
    let l = new_lender(&mut env, &admin, 100 * USDC);
    let ix = deposit_ix(&env, &l, 0);
    assert!(!send(&mut env.svm, &l.kp, ix));
}
#[test]
fn accrue_interest_moves_the_clock_forward() {
    let (mut env, admin) = setup();

    let mut clock: anchor_lang::prelude::Clock = env.svm.get_sysvar();
    clock.unix_timestamp += 86_400;
    env.svm.set_sysvar(&clock);

    let ix = Instruction::new_with_bytes(
        pool::id(),
        &pool::instruction::AccrueInterest {}.data(),
        pool::accounts::AccrueInterest { pool: env.pool, vault: env.vault }.to_account_metas(None),
    );
    assert!(send(&mut env.svm, &admin, ix));

    let account = env.svm.get_account(&env.pool).unwrap();
    let cfg = pool::state::PoolConfig::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(cfg.last_accrual, clock.unix_timestamp);
    assert_eq!(cfg.total_borrowed, 0);    
    let w = pool::rates::WAD;
    assert!(cfg.tier_index[0] > cfg.tier_index[1]); 
    assert!(cfg.tier_index[1] > cfg.tier_index[2]);
    assert!(cfg.tier_index[2] > cfg.tier_index[3]); 
    assert!(cfg.tier_index[3] > w);
    assert_eq!(cfg.tier_index[2], w + w * 200 * 86_400 / (10_000 * 365 * 86_400));             
}