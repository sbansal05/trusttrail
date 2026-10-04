//! Helpers shared by every pool test file.
#![allow(dead_code)]
pub mod market;
use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{get_spl_account, spl_token, CreateAssociatedTokenAccount, CreateMint, MintTo},
    pool::constants::*,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

pub const USDC: u64 = 1_000_000;
pub const T0: i64 = 1_800_000_000;

/// Sends one instruction signed (and paid) by `signer`. True on success; prints logs on failure.
pub fn send(svm: &mut LiteSVM, signer: &Keypair, ix: Instruction) -> bool {
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

pub fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &pool::id()).0
}

pub fn balance(svm: &LiteSVM, token_account: &Pubkey) -> u64 {
    get_spl_account::<spl_token::state::Account>(svm, token_account).unwrap().amount
}

pub fn set_clock(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub pool: Pubkey,
    pub vault: Pubkey,
    pub lp_mint: Pubkey,
    pub usdc_mint: Pubkey,
}

/// Pool initialised with a fresh 6-decimal "USDC" mint, clock at T0.
/// The admin is also the USDC mint authority, so tests can fund wallets.
pub fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/pool.so"));
    svm.add_program(pool::id(), bytes).unwrap();
    set_clock(&mut svm, T0);
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
    Env { svm, admin, pool, vault, lp_mint, usdc_mint }
}

/// A new wallet with SOL for fees, and a token account for `mint` holding `amount`.
/// Returns (wallet, token account). The admin must be the mint authority.
pub fn funded_wallet(env: &mut Env, mint: &Pubkey, amount: u64) -> (Keypair, Pubkey) {
    let kp = Keypair::new();
    env.svm.airdrop(&kp.pubkey(), 1_000_000_000).unwrap();
    let ata = CreateAssociatedTokenAccount::new(&mut env.svm, &kp, mint).send().unwrap();
    if amount > 0 {
        MintTo::new(&mut env.svm, &env.admin, mint, &ata, amount).send().unwrap();
    }
    (kp, ata)
}

/// An extra token account for `owner` (e.g. their LP or USDC account).
pub fn token_account(env: &mut Env, owner: &Keypair, mint: &Pubkey) -> Pubkey {
    CreateAssociatedTokenAccount::new(&mut env.svm, owner, mint).send().unwrap()
}

pub struct Lender {
    pub kp: Keypair,
    pub usdc: Pubkey,
    pub lp: Pubkey,
}

/// A lender with `usdc` USDC and an empty LP account.
pub fn new_lender(env: &mut Env, usdc: u64) -> Lender {
    let usdc_mint = env.usdc_mint;
    let lp_mint = env.lp_mint;
    let (kp, usdc_ata) = funded_wallet(env, &usdc_mint, usdc);
    let lp = token_account(env, &kp, &lp_mint);
    Lender { kp, usdc: usdc_ata, lp }
}

pub fn deposit_ix(env: &Env, l: &Lender, amount: u64) -> Instruction {
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

pub fn withdraw_ix(env: &Env, l: &Lender, shares: u64) -> Instruction {
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