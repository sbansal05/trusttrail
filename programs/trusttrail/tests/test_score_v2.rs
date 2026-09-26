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

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/trusttrail.so"));
    svm.add_program(trusttrail::id(), bytes).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    (svm, payer)
}

fn reputation_pda(wallet: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[trusttrail::constants::USER_REPUTATION_V2_SEED, wallet.as_ref()],
        &trusttrail::id(),
    )
    .0
}

fn send_init(svm: &mut LiteSVM, payer: &Keypair, wallet: Pubkey) -> bool {
    let ix = Instruction::new_with_bytes(
        trusttrail::id(),
        &trusttrail::instruction::InitScoreV2 {}.data(),
        trusttrail::accounts::InitScoreV2 {
            payer: payer.pubkey(),
            wallet,
            reputation: reputation_pda(&wallet),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    svm.expire_blockhash(); // FIRST: move to a fresh blockhash so a repeat tx isn't a duplicate
    let blockhash = svm.latest_blockhash(); // THEN: sign with that fresh blockhash
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();

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

#[test]
fn init_creates_unproven_account() {
    let (mut svm, payer) = setup();
    let wallet = Pubkey::new_unique();
    let mut clock: anchor_lang::prelude::Clock = svm.get_sysvar();
    clock.unix_timestamp = 1_800_000_000;
    svm.set_sysvar(&clock);
    assert!(send_init(&mut svm, &payer, wallet));

    let account = svm.get_account(&reputation_pda(&wallet)).unwrap();
    assert_eq!(account.data.len(), 8 + 80); 
    let mut data: &[u8] = &account.data;
    let rep = trusttrail::state::UserReputationV2::try_deserialize(&mut data).unwrap();
    assert_eq!(rep.wallet, wallet);
    assert_eq!(rep.score, 0);
    assert_eq!(rep.tier, trusttrail::constants::TIER_UNPROVEN);
    assert_eq!(rep.loans_repaid_on_time, 0);
    assert_eq!(rep.last_update, 1_800_000_000);
}

#[test]
fn init_twice_fails() {
    let (mut svm, payer) = setup();
    let wallet = Pubkey::new_unique();

    assert!(send_init(&mut svm, &payer, wallet));   
    assert!(!send_init(&mut svm, &payer, wallet));  
}