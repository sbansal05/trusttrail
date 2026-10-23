use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Only the program's upgrade authority can call initialize")]
    Unauthorized,
    /// Unused, kept so later error codes don't shift.
    #[msg("Counter overflow")]
    CounterOverflow,
    #[msg("The white_writer list is full")]
    WriterWhiteListOverflow,
    #[msg("The name already exists in white writer's list")]
    NameAlreadyInWhiteWriterList,
    #[msg("The signer is not an approved writer")]
    SignerNotApproved,
    #[msg("Outcome must be 0: on time, 1: late, 2: liquidated, 3: defaulted")]
    InvalidOutcome,
    #[msg("Imported score must be between 0 and 1000")]
    InvalidImportedScore,
    /// Unused, kept so later error codes don't shift.
    #[msg("History was already imported for this wallet")]
    AlreadyImported,
    #[msg("History can be imported again only 15 days after the last import")]
    ImportTooSoon,
    #[msg("This writer is not on the whitelist")]
    WriterNotFound,
    #[msg("The exposure fix closed on 31 Dec 2026")]
    ExposureFixClosed,
    #[msg("Exposure can only be lowered")]
    ExposureCanOnlyDecrease,
}