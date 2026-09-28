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
}
