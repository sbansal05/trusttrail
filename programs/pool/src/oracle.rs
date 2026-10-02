//! Reading a Pyth price from a PriceUpdateV2 account (pull oracle).
//! Layout (Borsh): 8 discriminator | 32 write_authority | verification_level (1 byte tag,
//! +1 byte if Partial) | feed_id 32 | price i64 | conf u64 | exponent i32 | publish_time i64 | …

pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];
const VERIFICATION_FULL: u8 = 1;

pub struct PythPrice {
    pub feed_id: [u8; 32],
    pub price: i64,
    pub conf: u64,
    pub exponent: i32,
    pub publish_time: i64,
}

fn read<const N: usize>(data: &[u8], at: usize) -> Option<[u8; N]> {
    data.get(at..at + N)?.try_into().ok()
}

/// Parses the account data. Only fully verified updates are accepted.
pub fn parse_price_update(data: &[u8]) -> Option<PythPrice> {
    if read::<8>(data, 0)? != PRICE_UPDATE_V2_DISCRIMINATOR {
        return None;
    }
    if *data.get(40)? != VERIFICATION_FULL {
        return None;
    }
    let m = 41; // price message starts right after the 1-byte Full tag
    Some(PythPrice {
        feed_id: read::<32>(data, m)?,
        price: i64::from_le_bytes(read::<8>(data, m + 32)?),
        conf: u64::from_le_bytes(read::<8>(data, m + 40)?),
        exponent: i32::from_le_bytes(read::<4>(data, m + 48)?),
        publish_time: i64::from_le_bytes(read::<8>(data, m + 52)?),
    })
}

/// Conservative price for collateral: price − confidence (the low end of Pyth's range).
pub fn low_price(p: &PythPrice) -> Option<u64> {
    let low = p.price.checked_sub(p.conf as i64)?;
    if low <= 0 { None } else { Some(low as u64) }
}

/// Builds account bytes in the same layout; used by tests.
pub fn encode_price_update(feed_id: [u8; 32], price: i64, conf: u64, exponent: i32, publish_time: i64) -> Vec<u8> {
    let mut d = Vec::with_capacity(134);
    d.extend_from_slice(&PRICE_UPDATE_V2_DISCRIMINATOR);
    d.extend_from_slice(&[0u8; 32]); // write_authority
    d.push(VERIFICATION_FULL);
    d.extend_from_slice(&feed_id);
    d.extend_from_slice(&price.to_le_bytes());
    d.extend_from_slice(&conf.to_le_bytes());
    d.extend_from_slice(&exponent.to_le_bytes());
    d.extend_from_slice(&publish_time.to_le_bytes());
    d.extend_from_slice(&publish_time.to_le_bytes()); // prev_publish_time
    d.extend_from_slice(&price.to_le_bytes()); // ema_price
    d.extend_from_slice(&conf.to_le_bytes()); // ema_conf
    d.extend_from_slice(&0u64.to_le_bytes()); // posted_slot
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOL: [u8; 32] = [7u8; 32];

    #[test]
    fn round_trip() {
        let d = encode_price_update(SOL, 15_000_000_000, 10_000_000, -8, 1_800_000_000);
        let p = parse_price_update(&d).unwrap();
        assert_eq!(p.feed_id, SOL);
        assert_eq!(p.price, 15_000_000_000);
        assert_eq!(p.conf, 10_000_000);
        assert_eq!(p.exponent, -8);
        assert_eq!(p.publish_time, 1_800_000_000);
        assert_eq!(low_price(&p), Some(14_990_000_000));
    }

    #[test]
    fn rejects_bad_accounts() {
        let mut d = encode_price_update(SOL, 1, 0, -8, 0);
        d[0] ^= 1;
        assert!(parse_price_update(&d).is_none());          // wrong discriminator
        let mut d = encode_price_update(SOL, 1, 0, -8, 0);
        d[40] = 0;
        assert!(parse_price_update(&d).is_none());          // only partially verified
        assert!(parse_price_update(&[0u8; 20]).is_none());  // too short
    }

    #[test]
    fn low_price_never_zero_or_negative() {
        let p = parse_price_update(&encode_price_update(SOL, 100, 100, -8, 0)).unwrap();
        assert_eq!(low_price(&p), None);
    }
}