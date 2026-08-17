use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

// Spins up a fresh fake blockchain and calls `initialize` once, so
// global_config exists before each update_score test builds on it.
fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let program_id = trusttrail::id();
    let authority = Keypair::new();
    let global_config = Pubkey::find_program_address(
        &[trusttrail::constants::GLOBAL_CONFIG_SEED],
        &program_id,
    )
    .0;

    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/trusttrail.so"
    ));
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();

    let init_ix = Instruction::new_with_bytes(
        program_id,
        &trusttrail::instruction::Initialize {}.data(),
        trusttrail::accounts::Initialize {
            authority: authority.pubkey(),
            global_config,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[init_ix], Some(&authority.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority]).unwrap();
    svm.send_transaction(tx).unwrap();

    (svm, authority, global_config)
}

#[test]
fn test_update_score_as_authority_succeeds() {
    let (mut svm, authority, global_config) = setup();
    let program_id = trusttrail::id();

    let user = Pubkey::new_unique();
    let user_reputation = Pubkey::find_program_address(
        &[trusttrail::constants::USER_REPUTATION_SEED, user.as_ref()],
        &program_id,
    )
    .0;

    let ix = Instruction::new_with_bytes(
        program_id,
        &trusttrail::instruction::UpdateScore {
            new_score: 750,
            mask: 0b101,
            new_flags: 0,
        }
        .data(),
        trusttrail::accounts::UpdateScore {
            global_config,
            user_reputation,
            user,
            authority: authority.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&authority.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let account = svm.get_account(&user_reputation).unwrap();
    let mut data: &[u8] = &account.data;
    let rep = trusttrail::state::UserReputation::try_deserialize(&mut data).unwrap();
    assert_eq!(rep.score, 750);
    assert_eq!(rep.claims_bitmask, 0b101);
    assert_eq!(rep.flags, 0);
}

#[test]
fn test_update_score_as_random_keypair_fails() {
    let (mut svm, _authority, global_config) = setup();
    let program_id = trusttrail::id();

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let user = Pubkey::new_unique();
    let user_reputation = Pubkey::find_program_address(
        &[trusttrail::constants::USER_REPUTATION_SEED, user.as_ref()],
        &program_id,
    )
    .0;

    let ix = Instruction::new_with_bytes(
        program_id,
        &trusttrail::instruction::UpdateScore {
            new_score: 999,
            mask: 0,
            new_flags: 0,
        }
        .data(),
        trusttrail::accounts::UpdateScore {
            global_config,
            user_reputation,
            user,
            authority: attacker.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&attacker.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&attacker]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_err());
}