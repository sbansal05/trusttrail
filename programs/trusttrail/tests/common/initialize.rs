//! LiteSVM's `add_program` deploys with no upgrade authority, but TrustTrail's `initialize`
//! only accepts the upgrade authority. Shared with the pool tests through `#[path]`.

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{
            bpf_loader_upgradeable::{get_program_data_address, UpgradeableLoaderState},
            instruction::Instruction,
            system_program,
        },
        InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
};

/// Rewrites TrustTrail's ProgramData header so `authority` is its upgrade authority.
pub fn set_upgrade_authority(svm: &mut LiteSVM, authority: &Pubkey) {
    let address = get_program_data_address(&trusttrail::ID);
    let mut account = svm.get_account(&address).unwrap();
    let UpgradeableLoaderState::ProgramData { slot, .. } = bincode::deserialize(&account.data).unwrap() else {
        panic!("{address} is not a ProgramData account");
    };
    let header = bincode::serialize(&UpgradeableLoaderState::ProgramData {
        slot,
        upgrade_authority_address: Some(*authority),
    })
    .unwrap();
    account.data[..header.len()].copy_from_slice(&header);
    svm.set_account(address, account).unwrap();
}

/// `initialize` signed by `authority`, which becomes the admin.
pub fn initialize_ix(authority: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        trusttrail::ID,
        &trusttrail::instruction::Initialize {}.data(),
        trusttrail::accounts::Initialize {
            authority: *authority,
            global_config: Pubkey::find_program_address(&[trusttrail::GLOBAL_CONFIG_SEED], &trusttrail::ID).0,
            program: trusttrail::ID,
            program_data: get_program_data_address(&trusttrail::ID),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}