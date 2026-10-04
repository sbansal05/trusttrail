//! A pool with SOL collateral, a Pyth price, and TrustTrail wired in (pool PDA is a writer).

use {
    super::*,
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas,
    },
    litesvm::LiteSVM,
    litesvm_token::{spl_token, CreateMint, MintTo},
    pool::{constants::*, oracle::encode_price_update},
    solana_account::Account,
    solana_keypair::Keypair,
    solana_signer::Signer,
    trusttrail::{
        state::UserReputationV2, GLOBAL_CONFIG_SEED, SAS_CREDENTIAL, SAS_PROGRAM_ID, SAS_REPAYMENT_SCHEMA,
        SAS_SIGNER_SEED, USER_REPUTATION_V2_SEED, WRITER_WHITELIST_SEED,
    },
};

pub const SOL_FEED: [u8; 32] = [7u8; 32];
pub const SOL: u64 = 1_000_000_000; // 9 decimals
pub const SOL_PRICE: i64 = 15_000_000_000; // $150.00 with expo -8
pub const MAX_AGE: u32 = 60;
pub const DAY: i64 = 86_400;

pub struct Market {
    pub env: Env,
    pub sol_mint: Pubkey,
    pub config: Pubkey,
    pub coll_vault: Pubkey,
    pub price: Pubkey,
}

pub fn tt_pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &trusttrail::ID).0
}

/// Pool with 10,000 USDC from a lender, SOL accepted for every tier, a SOL/USD price,
/// and TrustTrail ready to accept the pool's records.
pub fn market() -> Market {
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
    enable_trusttrail(&mut env);

    let price = Pubkey::new_unique();
    let mut m = Market { env, sol_mint, config, coll_vault, price };
    set_price(&mut m, SOL_FEED, SOL_PRICE, 0, T0);
    m
}

/// Loads TrustTrail + SAS, creates TrustTrail's config and whitelist, and adds the pool PDA as a writer.
fn enable_trusttrail(env: &mut Env) {
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/trusttrail.so"));
    env.svm.add_program(trusttrail::ID, bytes).unwrap();
    load_sas(&mut env.svm);

    let admin = env.admin.insecure_clone();
    let global_config = tt_pda(&[GLOBAL_CONFIG_SEED]);
    let whitelist = tt_pda(&[WRITER_WHITELIST_SEED]);
    let ixs = [
        Instruction::new_with_bytes(
            trusttrail::ID,
            &trusttrail::instruction::Initialize {}.data(),
            trusttrail::accounts::Initialize { authority: admin.pubkey(), global_config, system_program: system_program::ID }
                .to_account_metas(None),
        ),
        Instruction::new_with_bytes(
            trusttrail::ID,
            &trusttrail::instruction::InitWriterWhitelist {}.data(),
            trusttrail::accounts::InitWriterWhitelist {
                authority: admin.pubkey(),
                global_config,
                whitelist,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        ),
        Instruction::new_with_bytes(
            trusttrail::ID,
            &trusttrail::instruction::AddWriter { writer: env.pool }.data(),
            trusttrail::accounts::AddWriter { authority: admin.pubkey(), global_config, whitelist }.to_account_metas(None),
        ),
    ];
    for ix in ixs {
        assert!(send(&mut env.svm, &admin, ix));
    }
}

/// The SAS program and our credential + schema accounts, from TrustTrail's test fixtures.
fn load_sas(svm: &mut LiteSVM) {
    svm.add_program_from_file(SAS_PROGRAM_ID, "../trusttrail/tests/fixtures/sas.so").unwrap();
    for (key, file) in [
        (SAS_CREDENTIAL, "../trusttrail/tests/fixtures/credential.bin"),
        (SAS_REPAYMENT_SCHEMA, "../trusttrail/tests/fixtures/schema.bin"),
    ] {
        let data = std::fs::read(file).unwrap();
        let lamports = svm.minimum_balance_for_rent_exemption(data.len());
        svm.set_account(key, Account { lamports, data, owner: SAS_PROGRAM_ID, executable: false, rent_epoch: 0 })
            .unwrap();
    }
}

/// Writes a Pyth PriceUpdateV2 account owned by the Pyth receiver program.
pub fn set_price(m: &mut Market, feed: [u8; 32], price: i64, conf: u64, publish_time: i64) {
    let data = encode_price_update(feed, price, conf, -8, publish_time);
    let lamports = m.env.svm.minimum_balance_for_rent_exemption(data.len());
    m.env
        .svm
        .set_account(m.price, Account { lamports, data, owner: PYTH_RECEIVER_ID, executable: false, rent_epoch: 0 })
        .unwrap();
}

/// Writes a TrustTrail score account for `wallet`, as if record_event had built it up.
/// gold = true gives 8 meaningful on-time median loans (score 1000, Gold).
pub fn set_reputation(m: &mut Market, wallet: &Pubkey, gold: bool) {
    let (addr, bump) = Pubkey::find_program_address(&[USER_REPUTATION_V2_SEED, wallet.as_ref()], &trusttrail::ID);
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

pub fn reputation(m: &Market, wallet: &Pubkey) -> UserReputationV2 {
    read(m, &tt_pda(&[USER_REPUTATION_V2_SEED, wallet.as_ref()]))
}

pub fn read<T: AccountDeserialize>(m: &Market, key: &Pubkey) -> T {
    let account = m.env.svm.get_account(key).unwrap();
    T::try_deserialize(&mut account.data.as_slice()).unwrap()
}

/// Gives a wallet's USDC account more USDC (the admin is the mint authority).
pub fn mint_usdc(m: &mut Market, to: &Pubkey, amount: u64) {
    let mint = m.env.usdc_mint;
    let admin = m.env.admin.insecure_clone();
    MintTo::new(&mut m.env.svm, &admin, &mint, to, amount).send().unwrap();
}

/// A wallet with SOL collateral, an empty USDC account, and a TrustTrail score account.
pub struct Borrower {
    pub kp: Keypair,
    pub sol: Pubkey,
    pub usdc: Pubkey,
}

pub fn new_borrower(m: &mut Market, sol: u64, gold: bool) -> Borrower {
    let sol_mint = m.sol_mint;
    let usdc_mint = m.env.usdc_mint;
    let (kp, sol_ata) = funded_wallet(&mut m.env, &sol_mint, sol);
    let usdc = token_account(&mut m.env, &kp, &usdc_mint);
    set_reputation(m, &kp.pubkey(), gold);
    Borrower { kp, sol: sol_ata, usdc }
}

pub fn loan_address(b: &Borrower, id: u64) -> Pubkey {
    pda(&[LOAN_SEED, b.kp.pubkey().as_ref(), &id.to_le_bytes()])
}

pub fn borrow_ix(m: &Market, b: &Borrower, loan_id: u64, amount: u64, collateral: u64) -> Instruction {
    let wallet = b.kp.pubkey();
    Instruction::new_with_bytes(
        pool::id(),
        &pool::instruction::Borrow { amount, collateral_amount: collateral }.data(),
        pool::accounts::Borrow {
            borrower: wallet,
            pool: m.env.pool,
            vault: m.env.vault,
            reputation: tt_pda(&[USER_REPUTATION_V2_SEED, wallet.as_ref()]),
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

/// The SAS attestation for a loan: its address uses the Loan account as the nonce.
pub fn attestation_of(loan: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[b"attestation", SAS_CREDENTIAL.as_ref(), SAS_REPAYMENT_SCHEMA.as_ref(), loan.as_ref()],
        &SAS_PROGRAM_ID,
    )
    .0
}

/// TrustTrail accounts for recording the outcome of `loan` taken by `borrower`.
pub fn score_accounts(borrower: &Pubkey, loan: &Pubkey) -> pool::accounts::ScoreAccounts {
    pool::accounts::ScoreAccounts {
        whitelist: tt_pda(&[WRITER_WHITELIST_SEED]),
        reputation: tt_pda(&[USER_REPUTATION_V2_SEED, borrower.as_ref()]),
        sas_signer: tt_pda(&[SAS_SIGNER_SEED]),
        credential: SAS_CREDENTIAL,
        schema: SAS_REPAYMENT_SCHEMA,
        attestation: attestation_of(loan),
        sas_program: SAS_PROGRAM_ID,
        trusttrail_program: trusttrail::ID,
    }
}

/// `payer` repays loan `loan_id` of `b`. Normally payer = b; tests pass someone else to check it fails.
pub fn repay_ix(m: &Market, b: &Borrower, payer: &Borrower, loan_id: u64) -> Instruction {
    let wallet = payer.kp.pubkey();
    let loan = loan_address(b, loan_id);
    Instruction::new_with_bytes(
        pool::id(),
        &pool::instruction::Repay {}.data(),
        pool::accounts::Repay {
            borrower: wallet,
            pool: m.env.pool,
            vault: m.env.vault,
            loan,
            borrower_state: pda(&[BORROWER_SEED, wallet.as_ref()]),
            collateral_config: m.config,
            collateral_vault: m.coll_vault,
            borrower_collateral: payer.sol,
            borrower_usdc: payer.usdc,
            score: score_accounts(&b.kp.pubkey(), &loan),
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}
/// Someone with USDC to repay other people's loans and an empty SOL account to receive collateral.
pub fn new_liquidator(m: &mut Market, usdc: u64) -> Borrower {
    let sol_mint = m.sol_mint;
    let usdc_mint = m.env.usdc_mint;
    let (kp, usdc_ata) = funded_wallet(&mut m.env, &usdc_mint, usdc);
    let sol = token_account(&mut m.env, &kp, &sol_mint);
    Borrower { kp, sol, usdc: usdc_ata }
}

pub fn liquidate_ix(m: &Market, b: &Borrower, liq: &Borrower, loan_id: u64) -> Instruction {
    let wallet = b.kp.pubkey();
    let loan = loan_address(b, loan_id);
    Instruction::new_with_bytes(
        pool::id(),
        &pool::instruction::Liquidate {}.data(),
        pool::accounts::Liquidate {
            liquidator: liq.kp.pubkey(),
            pool: m.env.pool,
            vault: m.env.vault,
            loan,
            borrower: wallet,
            borrower_state: pda(&[BORROWER_SEED, wallet.as_ref()]),
            collateral_config: m.config,
            collateral_vault: m.coll_vault,
            price_update: m.price,
            borrower_collateral: b.sol,
            liquidator_collateral: liq.sol,
            liquidator_usdc: liq.usdc,
            score: score_accounts(&wallet, &loan),
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}