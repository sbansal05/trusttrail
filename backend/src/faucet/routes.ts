import { Router } from "express";
import { isWallet } from "../history/routes";
import { FaucetError, claim, type FaucetDeps } from "./faucet";

export function faucetRouter(deps: FaucetDeps): Router {
    const r = Router();
    r.post("/faucet", async (req, res) => {
        const { wallet } = req.body ?? {};
        if (!isWallet(wallet)) return res.status(400).json({ error: "invalid wallet" });
        try {
            res.json(await claim(deps, wallet));
        } catch (err) {
            if (err instanceof FaucetError) return res.status(err.status).json({ error: err.message, ...err.details });
            console.error("faucet failed:", err);
            res.status(500).json({ error: "faucet failed" });
        }
    });
    return r;
}
