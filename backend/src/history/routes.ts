//! HTTP routes for the import.
//! GET  /import-history/:wallet   public history (add ?all=true for every import, newest first)
//! POST /import/prepare           { wallet, timestamp, signature }  -> the transaction for the wallet to sign
//! POST /import/submit            { importId, transaction }         -> the confirmed transaction signature

import { Router, type Response } from "express";
import type { Pool } from "pg";
import { PublicKey } from "@solana/web3.js";
import { importHistory } from "./store";
import { verifyImportRequest } from "./auth";
import { ImportError, prepareImport, submitImport, type ImportDeps } from "./importService";

function isWallet(s: unknown): s is string {
    if (typeof s !== "string") return false;
    try {
        new PublicKey(s);
        return true;
    } catch {
        return false;
    }
}

function fail(res: Response, err: unknown, what: string) {
    if (err instanceof ImportError) return res.status(err.status).json({ error: err.message, ...err.details });
    console.error(`${what} failed:`, err);
    return res.status(500).json({ error: `${what} failed` });
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
            fail(res, err, "import-history");
        }
    });
    return r;
}

export function importRouter(deps: ImportDeps, nowSecs: () => number = () => Math.floor(Date.now() / 1000)): Router {
    const r = Router();

    r.post("/import/prepare", async (req, res) => {
        const { wallet, timestamp, signature } = req.body ?? {};
        if (!isWallet(wallet)) return res.status(400).json({ error: "invalid wallet" });
        if (typeof signature !== "string" || !verifyImportRequest(wallet, timestamp, signature, nowSecs())) {
            return res.status(401).json({ error: "invalid or expired signed message" });
        }
        try {
            res.json(await prepareImport(deps, wallet));
        } catch (err) {
            fail(res, err, "import prepare");
        }
    });

    r.post("/import/submit", async (req, res) => {
        const { importId, transaction } = req.body ?? {};
        if (typeof importId !== "string" || typeof transaction !== "string") {
            return res.status(400).json({ error: "importId and transaction are required" });
        }
        try {
            res.json({ signature: await submitImport(deps, importId, transaction) });
        } catch (err) {
            fail(res, err, "import submit");
        }
    });

    return r;
}