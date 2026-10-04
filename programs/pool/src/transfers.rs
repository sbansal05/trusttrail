//! The two kinds of token transfer every pool instruction makes.

use crate::POOL_SEED;
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

/// A wallet moves its own tokens (the wallet signed the transaction).
pub fn user_transfer<'info>(
    token_program: Pubkey,
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    owner: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    token::transfer(CpiContext::new(token_program, Transfer { from, to, authority: owner }), amount)
}

/// The pool moves tokens out of one of its vaults; the pool PDA signs with its seeds.
pub fn pool_transfer<'info>(
    token_program: Pubkey,
    from: AccountInfo<'info>,
    to: AccountInfo<'info>,
    pool: AccountInfo<'info>,
    pool_bump: u8,
    amount: u64,
) -> Result<()> {
    let seeds: &[&[&[u8]]] = &[&[POOL_SEED, &[pool_bump]]];
    token::transfer(
        CpiContext::new_with_signer(token_program, Transfer { from, to, authority: pool }, seeds),
        amount,
    )
}