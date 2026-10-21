use {
    anchor_lang::{prelude::Pubkey, AccountDeserialize},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    trusttrail::{error::ErrorCode, state::GlobalConfig, GLOBAL_CONFIG_SEED},
};

#[path = "common/initialize.rs"]
mod initialize;

/// TrustTrail deployed with `upgrader` as its upgrade authority.
fn setup(upgrader: &Keypair) -> LiteSVM {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/trusttrail.so"));
    svm.add_program(trusttrail::ID, bytes).unwrap();
    initialize::set_upgrade_authority(&mut svm, &upgrader.pubkey());
    svm
}

fn send_initialize(svm: &mut LiteSVM, signer: &Keypair) -> Result<(), String> {
    svm.airdrop(&signer.pubkey(), 1_000_000_000).unwrap();
    let msg = Message::new_with_blockhash(
        &[initialize::initialize_ix(&signer.pubkey())],
        Some(&signer.pubkey()),
        &svm.latest_blockhash(),
    );
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    svm.send_transaction(tx).map(|_| ()).map_err(|e| e.meta.logs.join("\n"))
}

#[test]
fn initialize_by_upgrade_authority_makes_it_admin() {
    let upgrader = Keypair::new();
    let mut svm = setup(&upgrader);

    send_initialize(&mut svm, &upgrader).unwrap();

    let address = Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &trusttrail::ID).0;
    let account = svm.get_account(&address).unwrap();
    let config = GlobalConfig::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert_eq!(config.authority, upgrader.pubkey());
}

#[test]
fn initialize_by_another_signer_fails_with_unauthorized() {
    let upgrader = Keypair::new();
    let mut svm = setup(&upgrader);

    let logs = send_initialize(&mut svm, &Keypair::new()).unwrap_err();

    assert!(logs.contains(&format!("Error Code: {:?}", ErrorCode::Unauthorized)), "{logs}");
    let address = Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &trusttrail::ID).0;
    assert!(svm.get_account(&address).is_none());
}