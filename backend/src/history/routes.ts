import { Router } from "express";
import type { Pool } from "pg";
import { PublicKey } from "@solana/web3.js";
import { importHistory } from "./store";

function isWallet(s: string): boolean {
    try {
        new PublicKey(s);
        return true;
    } catch {
        return false;
    }
}

export function importHistoryRouter(pool: Pool): Router {
    const r = Router();
    r.get("/import-history/:wallet", async (req, res) => {
        const { wallet } = req.params;
        if (!isWallet(wallet)) return res.status(400).json({ error: "invalid wallet" });
        try {
            const imports = await importHistory(pool, wallet, req.query.all !== "true");
            if (imports.length === 0) return res.status(404).json({ error: "no import for this wallet" });
            res.json({ wallet, imports });
        } catch (err) {
            console.error("import-history failed:", err);
            res.status(500).json({ error: "failed to read import history" });
        }
    });
    return r;
}