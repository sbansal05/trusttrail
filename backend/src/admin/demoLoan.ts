//! The first live loan on devnet: borrow 100 tUSDC against SOL (fresh Pyth price posted in the same flow),
//! then repay it, which makes TrustTrail update the score and write the SAS repayment record.

try {
    process.loadEnvFile();
} catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
    createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createMintToInstruction,
    createSyncNativeInstruction, getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
    FEED_IDS, TUSDC_DECIMALS, WSOL_MINT, borrowIx, borrowerStatePda, loanPda, parseBorrowerState, repayIx,
} from "../pool/accounts";
import { latestUpdate, withFreshPrice } from "../pool/freshPrice";
import { fetchReputation, clusterTime } from "../history/chain";
import { initScoreV2Ix } from "../history/importTx";
import { attestationPda, parseRepayment } from "../score/attestations";
import { standing } from "../score/standing";
import { TIER_NAMES } from "../history/scoring";

const BORROW = 100n * 10n ** BigInt(TUSDC_DECIMALS);  // an Unproven wallet's maximum loan
const COLLATERAL_MARGIN = 1.6;                          // above the Unproven 150%, so the low (price − conf) end still passes
const INTEREST_BUFFER = 2n * 10n ** BigInt(TUSDC_DECIMALS);

function required(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is not set in .env`);
    return v;
}

async function main() {
    const mode = process.argv[2] ?? "both";
    const keyPath = process.argv[3] ?? join(homedir(), ".config/solana/trusttrail-demo-1.json");
    const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
    const borrower = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(keyPath, "utf8"))));
    const faucet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(required("FAUCET_PRIVATE_KEY"))));
    const usdc = new PublicKey(required("TUSDC_MINT"));
    const me = borrower.publicKey;
    const wsolAta = getAssociatedTokenAddressSync(WSOL_MINT, me);
    const usdcAta = getAssociatedTokenAddressSync(usdc, me);
    console.log(`borrower ${me.toBase58()}, ${(await connection.getBalance(me)) / LAMPORTS_PER_SOL} SOL`);

    const stateInfo = await connection.getAccountInfo(borrowerStatePda(me));
    const nextLoanId = stateInfo ? parseBorrowerState(stateInfo.data).nextLoanId : 0n;

    if (mode === "both" || mode === "borrow") {
        const { data, price } = await latestUpdate(FEED_IDS.SOL_USD);
        const lamports = BigInt(Math.ceil((Number(BORROW) / 10 ** TUSDC_DECIMALS) * COLLATERAL_MARGIN / price * LAMPORTS_PER_SOL));
        console.log(`SOL $${price.toFixed(2)}: ${Number(lamports) / LAMPORTS_PER_SOL} SOL as collateral for 100 tUSDC`);

        // Setup: score account (first time), wrapped SOL for the collateral, tUSDC account + interest buffer
        const setup = new Transaction();
        if (!(await connection.getAccountInfo(initScoreV2Ix(me).keys[2].pubkey))) setup.add(initScoreV2Ix(me));
        setup.add(
            createAssociatedTokenAccountIdempotentInstruction(me, wsolAta, me, WSOL_MINT),
            SystemProgram.transfer({ fromPubkey: me, toPubkey: wsolAta, lamports }),
            createSyncNativeInstruction(wsolAta),
            createAssociatedTokenAccountIdempotentInstruction(me, usdcAta, me, usdc),
            createMintToInstruction(usdc, usdcAta, faucet.publicKey, INTEREST_BUFFER),
        );
        console.log("setup:", await sendAndConfirmTransaction(connection, setup, [borrower, faucet]));

        const sigs = await withFreshPrice(connection, borrower, FEED_IDS.SOL_USD, data, (priceUpdate) => [
            borrowIx({
                borrower: me, loanId: nextLoanId, collateralMint: WSOL_MINT, priceUpdate,
                borrowerCollateral: wsolAta, borrowerUsdc: usdcAta, amount: BORROW, collateralAmount: lamports,
            }),
        ]);
        console.log(`borrow (loan ${loanPda(me, nextLoanId).toBase58()}):`, sigs.join(", "));
    }

    if (mode === "both" || mode === "repay") {
        const loanId = mode === "both" ? nextLoanId : nextLoanId - 1n;
        const loan = loanPda(me, loanId);
        const repay = new Transaction().add(
            repayIx({ borrower: me, loan, collateralMint: WSOL_MINT, borrowerCollateral: wsolAta, borrowerUsdc: usdcAta }),
            createCloseAccountInstruction(wsolAta, me, me), // unwrap the returned SOL
        );
        console.log("repay:", await sendAndConfirmTransaction(connection, repay, [borrower]));

        const record = await connection.getAccountInfo(attestationPda(loan));
        console.log("SAS record:", record ? parseRepayment(attestationPda(loan).toBase58(), record.data) : "not found");
    }

    const rep = await fetchReputation(connection, me);
    if (rep) {
        const s = standing(rep, await clusterTime(connection));
        console.log(`score ${s.score}, tier ${TIER_NAMES[s.tier]}, on-time loans ${rep.loansRepaidOnTime}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
