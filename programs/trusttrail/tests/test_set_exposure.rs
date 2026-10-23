use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::instruction::Instruction,
        AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    trusttrail::{error::ErrorCode, state::UserReputationV2, EXPOSURE_FIX_DEADLINE, GLOBAL_CONFIG_SEED, USER_REPUTATION_V2_SEED},
};

#[path = "common/initialize.rs"]
mod initialize;

const LOAN: u64 = 10_000; // w of one median loan, in bps

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &trusttrail::ID).0
}

fn set_clock(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

/// TrustTrail with `admin` as admin, and a score account for a new wallet: 4 median loans of
/// good history (native 500) and an exposure of 8 loans, so α = 1 and the score is 500.
fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/trusttrail.so"));
    svm.add_program(trusttrail::ID, bytes).unwrap();
    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 1_000_000_000).unwrap();
    initialize::set_upgrade_authority(&mut svm, &admin.pubkey());
    assert!(send(&mut svm, &admin, initialize::initialize_ix(&admin.pubkey())).is_ok());

    let wallet = Pubkey::new_unique();
    let (address, bump) = Pubkey::find_program_address(&[USER_REPUTATION_V2_SEED, wallet.as_ref()], &trusttrail::ID);
    let rep = UserReputationV2 {
        wallet, score: 500, native_score: 500, imported_score: 0, import_date: 0, tier: 1, loans_repaid_on_time: 4,
        late_repaid_loans: 0, liquidated_loans: 0, current_on_time_streak: 4, last_liquidation_date: 0, total_usdc_repaid: 0,
        last_update: 0, s_plus_bps: 4 * LOAN, s_minus_bps: 0, s_minus_at: 0, exposure_bps: 8 * LOAN, meaningful_on_time: 4,
        meaningful_weight_bps: 4 * LOAN, bump,
    };
    let mut data = Vec::with_capacity(8 + UserReputationV2::INIT_SPACE);
    rep.try_serialize(&mut data).unwrap();
    let lamports = svm.minimum_balance_for_rent_exemption(data.len());
    svm.set_account(address, Account { lamports, data, owner: trusttrail::ID, executable: false, rent_epoch: 0 }).unwrap();
    (svm, admin, wallet)
}

fn set_exposure_ix(authority: Pubkey, wallet: Pubkey, exposure_bps: u64) -> Instruction {
    Instruction::new_with_bytes(
        trusttrail::ID,
        &trusttrail::instruction::SetExposure { exposure_bps }.data(),
        trusttrail::accounts::SetExposure {
            authority,
            global_config: pda(&[GLOBAL_CONFIG_SEED]),
            reputation: pda(&[USER_REPUTATION_V2_SEED, wallet.as_ref()]),
        }
        .to_account_metas(None),
    )
}

/// Sends one instruction signed by `signer`; Err holds the logs.
fn send(svm: &mut LiteSVM, signer: &Keypair, ix: Instruction) -> Result<(), String> {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(|e| e.meta.logs.join("\n"))
}

fn read_rep(svm: &LiteSVM, wallet: Pubkey) -> UserReputationV2 {
    let account = svm.get_account(&pda(&[USER_REPUTATION_V2_SEED, wallet.as_ref()])).unwrap();
    UserReputationV2::try_deserialize(&mut account.data.as_slice()).unwrap()
}

fn fails_with(result: Result<(), String>, code: ErrorCode) {
    let logs = result.unwrap_err();
    assert!(logs.contains(&format!("Error Code: {code:?}")), "{logs}");
}

#[test]
fn admin_lowers_exposure_and_the_cached_score_follows() {
    let (mut svm, admin, wallet) = setup();
    set_clock(&mut svm, EXPOSURE_FIX_DEADLINE); // the last second it still works

    assert!(send(&mut svm, &admin, set_exposure_ix(admin.pubkey(), wallet, 4 * LOAN)).is_ok());

    let rep = read_rep(&svm, wallet);
    assert_eq!(rep.exposure_bps, 4 * LOAN);
    assert_eq!(rep.score, 250, "α 100% → 50%, no import: 500 × 0.5");
    assert_eq!(rep.last_update, EXPOSURE_FIX_DEADLINE);
}

#[test]
fn another_signer_cannot_set_exposure() {
    let (mut svm, _admin, wallet) = setup();
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();

    assert!(send(&mut svm, &stranger, set_exposure_ix(stranger.pubkey(), wallet, 0)).is_err());
    assert_eq!(read_rep(&svm, wallet).exposure_bps, 8 * LOAN);
}

#[test]
fn exposure_cannot_be_raised() {
    let (mut svm, admin, wallet) = setup();
    fails_with(send(&mut svm, &admin, set_exposure_ix(admin.pubkey(), wallet, 8 * LOAN + 1)), ErrorCode::ExposureCanOnlyDecrease);
    assert_eq!(read_rep(&svm, wallet).exposure_bps, 8 * LOAN);
}

#[test]
fn the_fix_closes_after_the_deadline() {
    let (mut svm, admin, wallet) = setup();
    set_clock(&mut svm, EXPOSURE_FIX_DEADLINE + 1);
    fails_with(send(&mut svm, &admin, set_exposure_ix(admin.pubkey(), wallet, 4 * LOAN)), ErrorCode::ExposureFixClosed);
    assert_eq!(read_rep(&svm, wallet).exposure_bps, 8 * LOAN);
}