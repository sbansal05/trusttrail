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
    trusttrail::{constants::*, state::UserReputationV2},
};

const T0: i64 = 1_800_000_000;

/// Sends one instruction; `signers[0]` pays. True on success; prints logs on failure.
fn send(svm: &mut LiteSVM, signers: &[&Keypair], ix: Instruction) -> bool {
    svm.expire_blockhash();
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signers[0].pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
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

fn ix<T: InstructionData, A: ToAccountMetas>(data: T, accounts: A) -> Instruction {
    Instruction::new_with_bytes(trusttrail::id(), &data.data(), accounts.to_account_metas(None))
}

/// TrustTrail with a whitelist holding `backend`, and an empty score account for `wallet`.
fn setup() -> (LiteSVM, Keypair, Keypair) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/trusttrail.so"));
    svm.add_program(trusttrail::id(), bytes).unwrap();
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = T0;
    svm.set_sysvar(&clock);

    let admin = Keypair::new();
    let backend = Keypair::new();
    let wallet = Keypair::new();
    for k in [&admin, &backend, &wallet] {
        svm.airdrop(&k.pubkey(), 1_000_000_000).unwrap();
    }
    let global_config = pda(&[GLOBAL_CONFIG_SEED]);
    let whitelist = pda(&[WRITER_WHITELIST_SEED]);
    let a = admin.pubkey();
    assert!(send(&mut svm, &[&admin], ix(trusttrail::instruction::Initialize {},
        trusttrail::accounts::Initialize { authority: a, global_config, system_program: system_program::ID })));
    assert!(send(&mut svm, &[&admin], ix(trusttrail::instruction::InitWriterWhitelist {},
        trusttrail::accounts::InitWriterWhitelist { authority: a, global_config, whitelist, system_program: system_program::ID })));
    assert!(send(&mut svm, &[&admin], ix(trusttrail::instruction::AddWriter { writer: backend.pubkey() },
        trusttrail::accounts::AddWriter { authority: a, global_config, whitelist })));
    assert!(send(&mut svm, &[&wallet], ix(trusttrail::instruction::InitScoreV2 {},
        trusttrail::accounts::InitScoreV2 {
            payer: wallet.pubkey(),
            wallet: wallet.pubkey(),
            reputation: pda(&[USER_REPUTATION_V2_SEED, wallet.pubkey().as_ref()]),
            system_program: system_program::ID,
        })));
    (svm, backend, wallet)
}

fn import_ix(writer: &Keypair, wallet: &Keypair, score: u16, on_time: u16, weight: u64) -> Instruction {
    ix(
        trusttrail::instruction::SetImportedScore { score, meaningful_on_time: on_time, meaningful_weight_bps: weight },
        trusttrail::accounts::SetImportedScore {
            writer: writer.pubkey(),
            whitelist: pda(&[WRITER_WHITELIST_SEED]),
            wallet: wallet.pubkey(),
            reputation: pda(&[USER_REPUTATION_V2_SEED, wallet.pubkey().as_ref()]),
        },
    )
}

fn rep(svm: &LiteSVM, wallet: &Keypair) -> UserReputationV2 {
    let account = svm.get_account(&pda(&[USER_REPUTATION_V2_SEED, wallet.pubkey().as_ref()])).unwrap();
    UserReputationV2::try_deserialize(&mut account.data.as_slice()).unwrap()
}

fn set_time(svm: &mut LiteSVM, t: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = t;
    svm.set_sysvar(&clock);
}


#[test]
fn good_history_starts_a_new_wallet_at_silver() {
    let (mut svm, backend, wallet) = setup();
    // 640 points, 3 meaningful on-time loans worth 3.0 in weight
    assert!(send(&mut svm, &[&wallet, &backend], import_ix(&backend, &wallet, 640, 3, 30_000)));

    let r = rep(&svm, &wallet);
    assert_eq!(r.imported_score, 640);
    assert_eq!(r.import_date, T0);
    assert_eq!(r.score, 640); // no native history yet → the import is the whole score
    assert_eq!(r.native_score, 0);
    assert_eq!(r.tier, TIER_SILVER);
}

#[test]
fn a_high_score_from_one_loan_is_only_bronze() {
    let (mut svm, backend, wallet) = setup();
    assert!(send(&mut svm, &[&wallet, &backend], import_ix(&backend, &wallet, 900, 1, 10_000)));
    assert_eq!(rep(&svm, &wallet).tier, TIER_BRONZE);
}

#[test]
fn re_import_waits_15_days_and_adds_only_new_counts() {
    let (mut svm, backend, wallet) = setup();
    assert!(send(&mut svm, &[&wallet, &backend], import_ix(&backend, &wallet, 400, 2, 20_000)));

    set_time(&mut svm, T0 + 14 * 86_400);
    assert!(!send(&mut svm, &[&wallet, &backend], import_ix(&backend, &wallet, 640, 1, 10_000)));

    set_time(&mut svm, T0 + 15 * 86_400);
    // backend sends the new score for the whole history, and counts for the 1 new loan only
    assert!(send(&mut svm, &[&wallet, &backend], import_ix(&backend, &wallet, 640, 1, 10_000)));
    let r = rep(&svm, &wallet);
    assert_eq!(r.imported_score, 640);
    assert_eq!(r.meaningful_on_time, 3);
    assert_eq!(r.meaningful_weight_bps, 30_000);
    assert_eq!(r.import_date, T0 + 15 * 86_400);
    assert_eq!(r.tier, TIER_SILVER);
}

#[test]
fn only_a_whitelisted_writer_can_import() {
    let (mut svm, _backend, wallet) = setup();
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    assert!(!send(&mut svm, &[&wallet, &stranger], import_ix(&stranger, &wallet, 1000, 8, 80_000)));
}

#[test]
fn score_above_1000_is_rejected() {
    let (mut svm, backend, wallet) = setup();
    assert!(!send(&mut svm, &[&wallet, &backend], import_ix(&backend, &wallet, 1001, 0, 0)));
}