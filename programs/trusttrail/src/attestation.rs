use anchor_lang::prelude::*;

pub const REPAYMENT_DATA_LEN: usize = 116;

/// Encodes one repayment record in the exact field order of the SAS schema.
pub fn encode_repayment(
    borrower: &Pubkey,
    lender: &Pubkey,
    principal_usdc: u64,
    interest_paid_usdc: u64,
    opened_at: i64,
    due_at: i64,
    closed_at: i64,
    outcome: u8,
    collateral_ratio_bps: u16,
    tier_at_open: u8,
) -> Vec<u8> {
    let mut data = Vec::with_capacity(REPAYMENT_DATA_LEN);

    data.extend_from_slice(&32u32.to_le_bytes());
    data.extend_from_slice(borrower.as_ref());

    data.extend_from_slice(&32u32.to_le_bytes());
    data.extend_from_slice(lender.as_ref());

    data.extend_from_slice(&principal_usdc.to_le_bytes());
    data.extend_from_slice(&interest_paid_usdc.to_le_bytes());


    data.extend_from_slice(&opened_at.to_le_bytes());
    data.extend_from_slice(&due_at.to_le_bytes());
    data.extend_from_slice(&closed_at.to_le_bytes());

    data.push(outcome);
    data.extend_from_slice(&collateral_ratio_bps.to_le_bytes());
    data.push(tier_at_open);
    data
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> (Pubkey, Pubkey, Vec<u8>) {
        let b = Pubkey::new_unique();
        let l = Pubkey::new_unique();
        let d = encode_repayment(&b, &l, 740_000_000, 5_000_000, 100, 200, 300, 0, 13_000, 2);
        (b, l, d)
    }

    #[test]
    fn length_is_116() {
        let (_, _, d) = sample();
        assert_eq!(d.len(), REPAYMENT_DATA_LEN);
    }

    #[test]
    fn fields_are_at_the_right_offsets() {
        let (b, l, d) = sample();
        assert_eq!(&d[0..4], &32u32.to_le_bytes());
        assert_eq!(&d[4..36], b.as_ref());
        assert_eq!(&d[40..72], l.as_ref());
        assert_eq!(&d[72..80], &740_000_000u64.to_le_bytes());
        assert_eq!(&d[104..112], &300i64.to_le_bytes());
        assert_eq!(d[112], 0);
        assert_eq!(&d[113..115], &13_000u16.to_le_bytes());
        assert_eq!(d[115], 2);
    }
}