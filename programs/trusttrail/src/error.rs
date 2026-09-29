use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Only the counter authority can update this counter")]
    Unauthorized,
    #[msg("Counter has reached the maximum value")]
    CounterOverflow,
    #[msg("The white_writer list is full")]
    WriterWhiteListOverflow,
    #[msg("The name already exists in white writer's list")]
    NameAlreadyInWhiteWriterList,
    #[msg("The signer is not an approved writer")]
    SignerNotApproved,
    #[msg("Outcome must be 0: on time, 1: late, 2: liquidated, 3: defaulted")]
    InvalidOutcome,
}
