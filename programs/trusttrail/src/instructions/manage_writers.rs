use crate::*;
use crate::error::ErrorCode;

#[derive(Accounts)]
pub struct InitWriterWhitelist<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = authority
    )]

    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + WriterWhitelist::INIT_SPACE,
        seeds = [WRITER_WHITELIST_SEED],
        bump
    )]

    pub whitelist: Account<'info, WriterWhitelist>,

    pub system_program: Program<'info, System>,
}

pub fn handle_init_writer_whitelist(ctx: Context<InitWriterWhitelist>) -> Result<()> {
    let wlist = &mut ctx.accounts.whitelist;
    wlist.bump = ctx.bumps.whitelist;
    Ok(())
}

#[derive(Accounts)]
pub struct AddWriter<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = authority,
    )]

    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [WRITER_WHITELIST_SEED],
        bump = whitelist.bump,
    )]

    pub whitelist: Account<'info, WriterWhitelist>,

}

pub fn handle_add_writer(ctx: Context<AddWriter>, writer: Pubkey) -> Result<()> {
    let list = &mut ctx.accounts.whitelist;
    
    require!(list.signers.len() < MAX_WRITERS, ErrorCode::WriterWhiteListOverflow);

    require!(!list.signers.contains(&writer), ErrorCode::NameAlreadyInWhiteWriterList);

    list.signers.push(writer);

    Ok(())
}
/// Takes a writer off the whitelist (e.g. a leaked backend key). Same accounts as `add_writer`.
pub fn handle_remove_writer(ctx: Context<AddWriter>, writer: Pubkey) -> Result<()> {
    let list = &mut ctx.accounts.whitelist;
    let at = (list.signers.iter().position(|w| *w == writer)).ok_or(ErrorCode::WriterNotFound)?;
    list.signers.remove(at);
    Ok(())
}