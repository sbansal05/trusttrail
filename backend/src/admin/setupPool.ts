//! One-time devnet setup of the pool: tUSDC mint, init_pool, the two collaterals, the starting liquidity.

try {
    process.loadEnvFile();
} catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, type TransactionInstruction } from "@solana/web3.js";
import {
    createAssociatedTokenAccountIdempotentInstruction, createMint, createMintToInstruction, getAssociatedTokenAddressSync, getMint,
    getAccount,
} from "@solana/spl-token";
import {
    FEED_IDS, POOL_PROGRAM_ID, TUSDC_DECIMALS, WSOL_MINT, addCollateralIx, collateralConfigPda, depositIx, initPoolIx,
    lpMintPda, poolPda, vaultPda, type CollateralParams,
} from "../pool/accounts";
import { whitelistPda } from "../history/chain";

/** Starting liquidity, deposited by the admin as the first lender. */
const STARTING_LIQUIDITY = 10_000n * 10n ** BigInt(TUSDC_DECIMALS);
const MAX_PRICE_AGE_SECS = 60;

function keypairFromFile(path: string): Keypair {
    return Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(path, "utf8"))));
}

function required(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is not set in .env`);
    return v;
}

async function send(connection: Connection, what: string, ixs: TransactionInstruction[], signers: Keypair[]) {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers);
    console.log(`${what}: ${sig}`);
}

async function main() {
    const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
    const admin = keypairFromFile(join(homedir(), ".config/solana/id.json"));
    const faucet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(required("FAUCET_PRIVATE_KEY"))));
    console.log(`admin ${admin.publicKey.toBase58()}, faucet ${faucet.publicKey.toBase58()}`);

    // 1. tUSDC: our test USDC; the faucet key is its mint authority
    if (!process.env.TUSDC_MINT) {
        const mint = await createMint(connection, admin, faucet.publicKey, null, TUSDC_DECIMALS);
        console.log(`tUSDC mint created: ${mint.toBase58()}\nAdd  TUSDC_MINT=${mint.toBase58()}  to backend/.env and run again.`);
        return;
    }
    const usdc = new PublicKey(process.env.TUSDC_MINT);
    const mintInfo = await getMint(connection, usdc);
    if (!mintInfo.mintAuthority?.equals(faucet.publicKey)) throw new Error("TUSDC_MINT's mint authority is not the faucet key");

    // 2. The pool program must be deployed already
    const program = await connection.getAccountInfo(POOL_PROGRAM_ID);
    if (!program?.executable) throw new Error(`pool program ${POOL_PROGRAM_ID.toBase58()} is not deployed on this cluster`);

    // 3. init_pool
    const pool = await connection.getAccountInfo(poolPda());
    if (!pool) {
        await send(connection, "init_pool", [initPoolIx(admin.publicKey, usdc)], [admin]);
    } else {
        // PoolConfig: 8 discriminator, authority 32, usdc_mint 32
        const poolUsdc = new PublicKey(pool.data.subarray(40, 72));
        if (!poolUsdc.equals(usdc)) throw new Error(`pool already uses ${poolUsdc.toBase58()}, not TUSDC_MINT`);
        console.log("pool: already initialized");
    }

    // 4. Collaterals: SOL 110% / 5%, tUSDC 105% / 2%, open to every tier
    const collaterals: [string, PublicKey, CollateralParams][] = [
        ["SOL", WSOL_MINT, { feedId: FEED_IDS.SOL_USD, minTier: 0, maxAgeSecs: MAX_PRICE_AGE_SECS, liqThresholdBps: 11_000, liqBonusBps: 500 }],
        ["tUSDC", usdc, { feedId: FEED_IDS.USDC_USD, minTier: 0, maxAgeSecs: MAX_PRICE_AGE_SECS, liqThresholdBps: 10_500, liqBonusBps: 200 }],
    ];
    for (const [name, mint, params] of collaterals) {
        if (await connection.getAccountInfo(collateralConfigPda(mint))) {
            console.log(`collateral ${name}: already added`);
        } else {
            await send(connection, `add_collateral ${name}`, [addCollateralIx(admin.publicKey, mint, params)], [admin]);
        }
    }

    // 5. Starting liquidity, only while the pool has no lender yet
    const lp = await getMint(connection, lpMintPda());
    if (lp.supply > 0n) {
        console.log("liquidity: pool already has lenders");
    } else {
        const adminUsdc = getAssociatedTokenAddressSync(usdc, admin.publicKey);
        const adminLp = getAssociatedTokenAddressSync(lpMintPda(), admin.publicKey);
        await send(connection, "mint and deposit 10,000 tUSDC", [
            createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, adminUsdc, admin.publicKey, usdc),
            createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, adminLp, admin.publicKey, lpMintPda()),
            createMintToInstruction(usdc, adminUsdc, faucet.publicKey, STARTING_LIQUIDITY),
            depositIx(admin.publicKey, adminUsdc, adminLp, STARTING_LIQUIDITY),
        ], [admin, faucet]);
    }
    const vault = await getAccount(connection, vaultPda());
    console.log(`vault: ${Number(vault.amount) / 10 ** TUSDC_DECIMALS} tUSDC`);

    // 6. The pool PDA writes the score and the SAS record on repay: it must be a TrustTrail writer
    const list = await connection.getAccountInfo(whitelistPda());
    const n = list ? list.data.readUInt32LE(8) : 0;
    const writers = Array.from({ length: n }, (_, i) => new PublicKey(list!.data.subarray(12 + 32 * i, 44 + 32 * i)));
    if (writers.some((w) => w.equals(poolPda()))) {
        console.log(`pool PDA ${poolPda().toBase58()} is a TrustTrail writer`);
    } else {
        console.log(`pool PDA is not a TrustTrail writer yet. Run:\n  npx tsx src/admin/setupWhitelist.ts ${poolPda().toBase58()}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
