import express from "express";
import {verifyProof } from "@reclaimprotocol/js-sdk";
import { computeHistoryScore } from "./heliusScore";
process.loadEnvFile();

const app = express();
app.use(express.json());

app.post("/verify-and-score", async (req, res) => {
    const {walletAddress, proof} = req.body;

    const result = await verifyProof(proof, {
        dangerouslyDisableContentValidation: true,
    });
    console.log("full verifyProof result:", JSON.stringify(result, null, 2));
    if (!result.isVerified) {
        return res.status(400).json({ error: "invalid proof" });
    }

    res.json({ received: true, walletAddress});
});

app.listen(3000, () => console.log("listening on port 3000"));