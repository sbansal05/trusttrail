import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey } from "@solana/web3.js";
import { FEED_IDS, POOL_PROGRAM_ID, addCollateralIx, collateralConfigPda, parsePriceUpdate, poolPda, sponsoredFeedAccount } from "./accounts";

test("Pyth sponsored feed account for SOL/USD is the published one", () => {
    assert.equal(sponsoredFeedAccount(FEED_IDS.SOL_USD).toBase58(), "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
});

test("PriceUpdateV2 is read like the pool reads it; partial verification is refused", () => {
    const d = Buffer.alloc(134);
    Buffer.from([34, 241, 35, 99, 157, 126, 244, 205]).copy(d, 0);
    d[40] = 1;
    FEED_IDS.SOL_USD.copy(d, 41);
    d.writeBigInt64LE(18_931_000_000n, 73); d.writeBigUInt64LE(9_000_000n, 81); d.writeInt32LE(-8, 89); d.writeBigInt64LE(1_800_000_000n, 93);
    assert.deepEqual(parsePriceUpdate(d), { feedId: FEED_IDS.SOL_USD, price: 18_931_000_000n, conf: 9_000_000n, exponent: -8, publishTime: 1_800_000_000 });
    d[40] = 0;
    assert.equal(parsePriceUpdate(d), null);
});

test("add_collateral data: feed id, min tier u8, max age u32, threshold u16, bonus u16 (little-endian)", () => {
    const admin = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
    const ix = addCollateralIx(admin, mint, { feedId: FEED_IDS.SOL_USD, minTier: 0, maxAgeSecs: 60, liqThresholdBps: 11_000, liqBonusBps: 500 });
    const a = ix.data.subarray(8);
    assert.deepEqual([a.subarray(0, 32).equals(FEED_IDS.SOL_USD), a[32], a.readUInt32LE(33), a.readUInt16LE(37), a.readUInt16LE(39), a.length], [true, 0, 60, 11_000, 500, 41]);
    assert.ok(ix.keys[1].pubkey.equals(poolPda()) && ix.keys[3].pubkey.equals(collateralConfigPda(mint)));
    assert.ok(poolPda().equals(PublicKey.findProgramAddressSync([Buffer.from("pool")], POOL_PROGRAM_ID)[0]));
});
