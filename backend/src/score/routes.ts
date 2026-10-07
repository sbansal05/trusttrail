//! GET /score/:wallet   live score, tier, factors, coverage and native repayment records

import { Router } from "express";
import { isWallet } from "../history/routes";
import { getScore, type ScoreDeps } from "./scoreService";

export function scoreRouter(deps: ScoreDeps): Router {
    const r = Router();
    r.get("/score/:wallet", async (req, res) => {
        const { wallet } = req.params;
        if (!isWallet(wallet)) return res.status(400).json({ error: "invalid wallet" });
        try {
            res.json(await getScore(deps, wallet));
        } catch (err) {
            console.error("score failed:", err);
            res.status(500).json({ error: "score failed" });
        }
    });
    return r;
}
