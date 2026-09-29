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


fn setup() -> (LiteSVM, Keypair, Pubkey) {
    let program_id = trusttrail::id();
    let admin = Keypair::new();
    let global_config =
        Pubkey::find_program_address(&[trusttrail::constants::GLOBAL_CONFIG_SEED], &program_id).0;

    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/trusttrail.so"));
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&admin.pubkey(), 1_000_000_000).unwrap();

    let init_ix = Instruction::new_with_bytes(
        program_id,
        &trusttrail::instruction::Initialize {}.data(),
        trusttrail::accounts::Initialize {
            authority: admin.pubkey(),
            global_config,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    assert!(send(&mut svm, &admin, init_ix));
    (svm, admin, global_config)
}


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

fn whitelist_pda() -> Pubkey {
    Pubkey::find_program_address(&[trusttrail::constants::WRITER_WHITELIST_SEED], &trusttrail::id()).0
}

fn init_whitelist_ix(authority: Pubkey, global_config: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        trusttrail::id(),
        &trusttrail::instruction::InitWriterWhitelist {}.data(),
        trusttrail::accounts::InitWriterWhitelist {
            authority,
            global_config,
            whitelist: whitelist_pda(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

/// Builds add_writer(writer) with `authority` as the claimed admin.
fn add_writer_ix(authority: Pubkey, global_config: Pubkey, writer: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        trusttrail::id(),
        &trusttrail::instruction::AddWriter { writer }.data(),
        trusttrail::accounts::AddWriter {
            authority,
            global_config,
            whitelist: whitelist_pda(),
        }
        .to_account_metas(None),
    )
}

/// Reads and deserializes the whitelist account.
fn read_whitelist(svm: &LiteSVM) -> trusttrail::state::WriterWhitelist {
    let account = svm.get_account(&whitelist_pda()).unwrap();
    let mut data: &[u8] = &account.data;
    trusttrail::state::WriterWhitelist::try_deserialize(&mut data).unwrap()
}

#[test]
fn admin_creates_whitelist() {
    let (mut svm, admin, global_config) = setup();

    assert!(send(&mut svm, &admin, init_whitelist_ix(admin.pubkey(), global_config)));

    let account = svm.get_account(&whitelist_pda()).unwrap();
    assert_eq!(account.data.len(), 8 + 325);
    assert_eq!(read_whitelist(&svm).signers.len(), 0);
}

#[test]
fn non_admin_cannot_create_whitelist() {
    let (mut svm, _admin, global_config) = setup();
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    assert!(!send(&mut svm, &attacker, init_whitelist_ix(attacker.pubkey(), global_config)));
    assert!(svm.get_account(&whitelist_pda()).is_none());
}

#[test]
fn whitelist_cannot_be_created_twice() {
    let (mut svm, admin, global_config) = setup();

    assert!(send(&mut svm, &admin, init_whitelist_ix(admin.pubkey(), global_config)));
    assert!(!send(&mut svm, &admin, init_whitelist_ix(admin.pubkey(), global_config)));
}

#[test]
fn admin_adds_writer() {
    let (mut svm, admin, global_config) = setup();
    assert!(send(&mut svm, &admin, init_whitelist_ix(admin.pubkey(), global_config)));

    let pool_signer = Pubkey::new_unique();
    assert!(send(&mut svm, &admin, add_writer_ix(admin.pubkey(), global_config, pool_signer)));

    let list = read_whitelist(&svm);
    assert_eq!(list.signers, vec![pool_signer]);
}

#[test]
fn non_admin_cannot_add_writer() {
    let (mut svm, admin, global_config) = setup();
    assert!(send(&mut svm, &admin, init_whitelist_ix(admin.pubkey(), global_config)));

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    assert!(!send(&mut svm, &attacker, add_writer_ix(attacker.pubkey(), global_config, attacker.pubkey())));
    assert_eq!(read_whitelist(&svm).signers.len(), 0);
}

#[test]
fn same_writer_cannot_be_added_twice() {
    let (mut svm, admin, global_config) = setup();
    assert!(send(&mut svm, &admin, init_whitelist_ix(admin.pubkey(), global_config)));

    let pool_signer = Pubkey::new_unique();
    assert!(send(&mut svm, &admin, add_writer_ix(admin.pubkey(), global_config, pool_signer)));
    assert!(!send(&mut svm, &admin, add_writer_ix(admin.pubkey(), global_config, pool_signer)));

    assert_eq!(read_whitelist(&svm).signers.len(), 1);
}

#[test]
fn whitelist_rejects_the_eleventh_writer() {
    let (mut svm, admin, global_config) = setup();
    assert!(send(&mut svm, &admin, init_whitelist_ix(admin.pubkey(), global_config)));

    for _ in 0..trusttrail::constants::MAX_WRITERS {
        assert!(send(&mut svm, &admin, add_writer_ix(admin.pubkey(), global_config, Pubkey::new_unique())));
    }
    assert!(!send(&mut svm, &admin, add_writer_ix(admin.pubkey(), global_config, Pubkey::new_unique())));

    assert_eq!(read_whitelist(&svm).signers.len(), trusttrail::constants::MAX_WRITERS);
}