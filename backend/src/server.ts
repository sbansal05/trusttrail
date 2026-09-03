import express from "express";
import { verifyProof } from "@reclaimprotocol/js-sdk";
import { calculateTrustScore } from "./heliusScore";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Trusttrail } from "../../target/types/trusttrail";
import idl from "../../target/idl/trusttrail.json";
import cors from "cors";
import BN from "bn.js";
process.loadEnvFile();

const app = express();
app.use(cors({ origin: "http://localhost:5173"}));
app.use(express.json());

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const authoritySecret = new Uint8Array(JSON.parse(process.env.AUTHORITY_PRIVATE_KEY!));
const authorityKeypair = Keypair.fromSecretKey(authoritySecret);
const provider = new AnchorProvider(connection, new Wallet(authorityKeypair), {});
const program = new Program<Trusttrail>(idl as Trusttrail, provider);

const PROVIDER_BIT_MAP: Record<string, number> = {
    twitter: 2,
    amazon: 4,
    uber: 5,
};
const GLOBAL_CONFIG_SEED = Buffer.from("global-config");
const USER_REPUTATION_SEED = Buffer.from("trust-v1");
const PROGRAM_ID = new PublicKey("BtgvVKaXQMJsRUdZ8ahuBftnwDpYtass15TqTwsJJA9s");

app.post("/verify-and-score", async (req, res) => {
    const { walletAddress, proof } = req.body;

    const result = await verifyProof(proof, {
        dangerouslyDisableContentValidation: true, // TODO: replace with real providerId/providerVersion once we have a real captured proof
    });
    console.log("full verifyProof result:", JSON.stringify(result, null, 2));
    if (!result.isVerified) {
        return res.status(400).json({ error: "invalid proof" });
    }

    const providerName = proof.claimData.provider;
    const newBit = PROVIDER_BIT_MAP[providerName];
    if (newBit === undefined) {
        return res.status(400).json({ error: `unrecognized provider: ${providerName}` });
    }

    const walletPubKey = new PublicKey(walletAddress);

    const [userReputationPda] = PublicKey.findProgramAddressSync(
        [USER_REPUTATION_SEED, walletPubKey.toBuffer()],
        PROGRAM_ID
    );

    let currentBitMask = 0n;
    try {
        const existing = await program.account.userReputation.fetch(userReputationPda);
        currentBitMask = existing.claimsBitmask;
    } catch {
        // account doesn't exist yet — first verification ever for this user, stays at 0n
    }

    const newMask = new BN((currentBitMask | (1n << BigInt(newBit))).toString());
    const breakdown = await calculateTrustScore(walletAddress);

    

    const tx = await program.methods
        .updateScore(breakdown.total, newMask, 0)
        .accounts({
            user: walletPubKey,
            authority: authorityKeypair.publicKey,
        })
        .signers([authorityKeypair])
        .rpc();

    res.json({ walletAddress, provider: providerName, tx });
});

app.get("/score/:walletAddress", async (req, res) => {
    try {
        const breakdown = await calculateTrustScore(req.params.walletAddress);
        res.json(breakdown);
    } catch (err) {
        console.error("score computation failed:", err);
        res.status(500).json({ error: "failed to compute score" });
    }
});
app.post("/update-score/:walletAddress", async (req, res) => {
    try {
        const walletAddress = req.params.walletAddress;
        const walletPubKey = new PublicKey(walletAddress);
        const breakdown = await calculateTrustScore(walletAddress);

        const tx = await program.methods
            .updateScore(breakdown.total, new BN(0), 0)
            .accounts({
                user: walletPubKey,
                authority: authorityKeypair.publicKey,
            })
            .signers([authorityKeypair])
            .rpc();
        res.json({ walletAddress, breakdown, tx });
    } catch(err) {
        console.error("update-score failed", err);
        res.status(500).json({ error: "failed to update score" });

    }
});

app.listen(3000, () => console.log("listening on port 3000"));