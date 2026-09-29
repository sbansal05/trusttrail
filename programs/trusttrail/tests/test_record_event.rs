use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    trusttrail::constants::*,
};

const DAY: i64 = 86_400;
const T0: i64 = 1_800_000_000;

/// Sends one instruction signed (and paid) by `signer`. True on success; logs on failure.
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
    Pubkey::find_program_address(seeds, &trusttrail::id()).0
}

fn set_clock(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

/// Everything record_event needs: global_config, a whitelist with `writer` on it,
/// and a fresh score account for `wallet`. Returns (svm, admin, writer, wallet).
fn setup() -> (LiteSVM, Keypair, Keypair, Pubkey) {
    let program_id = trusttrail::id();
    let admin = Keypair::new();
    let writer = Keypair::new();
    let wallet = Pubkey::new_unique();
    let global_config = pda(&[GLOBAL_CONFIG_SEED]);

    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/trusttrail.so"));
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&admin.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&writer.pubkey(), 1_000_000_000).unwrap();
    set_clock(&mut svm, T0);

    let ix = Instruction::new_with_bytes(
        program_id,
        &trusttrail::instruction::Initialize {}.data(),
        trusttrail::accounts::Initialize { authority: admin.pubkey(), global_config, system_program: system_program::ID }
            .to_account_metas(None),
    );
    assert!(send(&mut svm, &admin, ix));

    let ix = Instruction::new_with_bytes(
        program_id,
        &trusttrail::instruction::InitWriterWhitelist {}.data(),
        trusttrail::accounts::InitWriterWhitelist {
            authority: admin.pubkey(),
            global_config,
            whitelist: pda(&[WRITER_WHITELIST_SEED]),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    assert!(send(&mut svm, &admin, ix));

    let ix = Instruction::new_with_bytes(
        program_id,
        &trusttrail::instruction::AddWriter { writer: writer.pubkey() }.data(),
        trusttrail::accounts::AddWriter { authority: admin.pubkey(), global_config, whitelist: pda(&[WRITER_WHITELIST_SEED]) }
            .to_account_metas(None),
    );
    assert!(send(&mut svm, &admin, ix));

    let ix = Instruction::new_with_bytes(
        program_id,
        &trusttrail::instruction::InitScoreV2 {}.data(),
        trusttrail::accounts::InitScoreV2 {
            payer: admin.pubkey(),
            wallet,
            reputation: pda(&[USER_REPUTATION_V2_SEED, wallet.as_ref()]),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    assert!(send(&mut svm, &admin, ix));

    (svm, admin, writer, wallet)
}

fn record_ix(writer: Pubkey, wallet: Pubkey, principal_usdc: u64, opened_at: i64, due_at: i64, outcome: u8) -> Instruction {
    Instruction::new_with_bytes(
        trusttrail::id(),
        &trusttrail::instruction::RecordEvent { principal_usdc, opened_at, due_at, outcome }.data(),
        trusttrail::accounts::RecordEvent {
            writer,
            whitelist: pda(&[WRITER_WHITELIST_SEED]),
            wallet,
            reputation: pda(&[USER_REPUTATION_V2_SEED, wallet.as_ref()]),
        }
        .to_account_metas(None),
    )
}

fn read_rep(svm: &LiteSVM, wallet: Pubkey) -> trusttrail::state::UserReputationV2 {
    let account = svm.get_account(&pda(&[USER_REPUTATION_V2_SEED, wallet.as_ref()])).unwrap();
    let mut data: &[u8] = &account.data;
    trusttrail::state::UserReputationV2::try_deserialize(&mut data).unwrap()
}

#[test]
fn on_time_median_loan_updates_every_total() {
    let (mut svm, _admin, writer, wallet) = setup();
    set_clock(&mut svm, T0 + 2 * DAY);

    let ix = record_ix(writer.pubkey(), wallet, 740 * USDC_UNIT, T0, T0 + 30 * DAY, OUTCOME_ON_TIME);
    assert!(send(&mut svm, &writer, ix));

    let rep = read_rep(&svm, wallet);
    assert_eq!(rep.s_plus_bps, 10_000);
    assert_eq!(rep.s_minus_bps, 0);
    assert_eq!(rep.exposure_bps, 10_000);
    assert_eq!(rep.meaningful_on_time, 1);
    assert_eq!(rep.meaningful_weight_bps, 10_000);
    assert_eq!(rep.loans_repaid_on_time, 1);
    assert_eq!(rep.current_on_time_streak, 1);
    assert_eq!(rep.total_usdc_repaid, 740 * USDC_UNIT);
    assert_eq!(rep.native_score, 125);
    assert_eq!(rep.score, 15);
    assert_eq!(rep.tier, TIER_BRONZE);
    assert_eq!(rep.last_update, T0 + 2 * DAY);
}

#[test]
fn eight_median_loans_reach_gold() {
    let (mut svm, _admin, writer, wallet) = setup();
    for i in 0..8 {
        let opened = T0 + i * 3 * DAY;
        set_clock(&mut svm, opened + 2 * DAY);
        let ix = record_ix(writer.pubkey(), wallet, 740 * USDC_UNIT, opened, opened + 30 * DAY, OUTCOME_ON_TIME);
        assert!(send(&mut svm, &writer, ix));
    }
    let rep = read_rep(&svm, wallet);
    assert_eq!(rep.native_score, 1000);
    assert_eq!(rep.score, 1000);
    assert_eq!(rep.tier, TIER_GOLD);
}

#[test]
fn liquidation_adds_penalty_and_blocks_tiers() {
    let (mut svm, _admin, writer, wallet) = setup();
    for i in 0..8 {
        let opened = T0 + i * 3 * DAY;
        set_clock(&mut svm, opened + 2 * DAY);
        let ix = record_ix(writer.pubkey(), wallet, 740 * USDC_UNIT, opened, opened + 30 * DAY, OUTCOME_ON_TIME);
        assert!(send(&mut svm, &writer, ix));
    }
    let liq_time = T0 + 40 * DAY;
    set_clock(&mut svm, liq_time);
    let ix = record_ix(writer.pubkey(), wallet, 740 * USDC_UNIT, liq_time - DAY, liq_time + 29 * DAY, OUTCOME_LIQUIDATED);
    assert!(send(&mut svm, &writer, ix));

    let rep = read_rep(&svm, wallet);
    assert_eq!(rep.s_minus_bps, 20_000);
    assert_eq!(rep.s_minus_at, liq_time);
    assert_eq!(rep.last_liquidation_date, liq_time);
    assert_eq!(rep.current_on_time_streak, 0);
    assert_eq!(rep.native_score, 750);
    assert_eq!(rep.tier, TIER_BRONZE);
}

#[test]
fn penalty_decays_on_next_record() {
    let (mut svm, _admin, writer, wallet) = setup();
    set_clock(&mut svm, T0 + DAY);
    let ix = record_ix(writer.pubkey(), wallet, 740 * USDC_UNIT, T0, T0 + 30 * DAY, OUTCOME_LIQUIDATED);
    assert!(send(&mut svm, &writer, ix));
    assert_eq!(read_rep(&svm, wallet).s_minus_bps, 20_000);

    let later = T0 + DAY + 90 * DAY;
    set_clock(&mut svm, later);
    let ix = record_ix(writer.pubkey(), wallet, 740 * USDC_UNIT, later - 2 * DAY, later + 28 * DAY, OUTCOME_ON_TIME);
    assert!(send(&mut svm, &writer, ix));

    let rep = read_rep(&svm, wallet);
    assert_eq!(rep.s_minus_bps, 10_000);
    assert_eq!(rep.s_minus_at, later);
}

#[test]
fn writer_not_on_whitelist_is_rejected() {
    let (mut svm, _admin, _writer, wallet) = setup();
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();
    set_clock(&mut svm, T0 + 2 * DAY);

    let ix = record_ix(attacker.pubkey(), wallet, 740 * USDC_UNIT, T0, T0 + 30 * DAY, OUTCOME_ON_TIME);
    assert!(!send(&mut svm, &attacker, ix));
    assert_eq!(read_rep(&svm, wallet).s_plus_bps, 0);
}

#[test]
fn invalid_outcome_is_rejected() {
    let (mut svm, _admin, writer, wallet) = setup();
    set_clock(&mut svm, T0 + 2 * DAY);

    let ix = record_ix(writer.pubkey(), wallet, 740 * USDC_UNIT, T0, T0 + 30 * DAY, 4);
    assert!(!send(&mut svm, &writer, ix));
    assert_eq!(read_rep(&svm, wallet).exposure_bps, 0);
}