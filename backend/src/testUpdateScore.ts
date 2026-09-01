import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Trusttrail } from "../../target/types/trusttrail";
import idl from "../../target/idl/trusttrail.json";
import BN from "bn.js";

process.loadEnvFile();

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const authoritySecret = new Uint8Array(JSON.parse(process.env.AUTHORITY_PRIVATE_KEY!));
const authorityKeypair = Keypair.fromSecretKey(authoritySecret);
const provider = new AnchorProvider(connection, new Wallet(authorityKeypair), {});
const program = new Program<Trusttrail>(idl as Trusttrail, provider);
const TEST_WALLET = new PublicKey("8ZLr5yTjevbSz5q1hCGQYvecbeAKUHo5uaSemoQs5898"); // your Day 0 devnet wallet

async function main() {
    const testScore = 650;
    const testMask = new BN(((1n << 2n) | (1n << 4n)).toString()); // pretend: Twitter + Amazon verified, Uber not
    const testFlags = 0;

    const tx = await program.methods
        .updateScore(testScore, testMask, testFlags)
        .accounts({
            user: TEST_WALLET,
            authority: authorityKeypair.publicKey,
        })
        .signers([authorityKeypair])
        .rpc();

    console.log("update_score sent! tx:", tx);
}

main();