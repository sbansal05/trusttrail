import express from "express";
import { calculateTrustScore } from "./heliusScore";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import nacl from "tweetnacl";
import { Trusttrail } from "../../target/types/trusttrail";
import idl from "../../target/idl/trusttrail.json";
import cors from "cors";
import BN from "bn.js";
import bs58 from "bs58";
process.loadEnvFile();

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const authoritySecret = new Uint8Array(JSON.parse(process.env.AUTHORITY_PRIVATE_KEY!));
const authorityKeypair = Keypair.fromSecretKey(authoritySecret);
const provider = new AnchorProvider(connection, new Wallet(authorityKeypair), {});
const program = new Program<Trusttrail>(idl as Trusttrail, provider);

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
        const { signature } = req.body;
        const message = `Update TrustTrail score for wallet: ${walletAddress}`;
        const walletPubKey = new PublicKey(walletAddress);

        
        const verified = nacl.sign.detached.verify(
            new TextEncoder().encode(message),
            bs58.decode(signature),
            walletPubKey.toBytes()
        );
        if (!verified) {
            return res.status(401).json({ error: "invalid signature" });
        }

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
    } catch (err) {
        console.error("update-score failed", err);
        res.status(500).json({ error: "failed to update score" });
    }
});

app.listen(3000, () => console.log("listening on port 3000"));