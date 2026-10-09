//! GET  /pool                 rates per tier, utilization, lender APY, collaterals with display prices
//! GET  /loans/:wallet        the wallet's offer (tier, limit, rate), balances, open loans with health
//! POST /borrow/prepare       { wallet, collateral: "SOL" | "tUSDC", amount, collateralAmount? } -> transactions to sign, in order
//! POST /repay/prepare        { wallet, loan }                                              
//! GET  /pool/loans           every loan the pool has made: open ones with health, all counted by tier and outcome
//! GET  /lender/:wallet       the wallet's pool shares, their value, its share of the pool, what it can withdraw now
//! POST /deposit/prepare      { wallet, amount }                                            -> the transaction to sign
//! POST /withdraw/prepare     { wallet, amount } or { wallet, all: true }                   -> the transaction to sign
//! Amounts are decimal strings of base units (tUSDC: 6 decimals, SOL: lamports).

import { Router, type Response } from "express";
import { isWallet } from "../history/routes";
import {
    PoolRequestError, SYMBOLS, getLoansView, getPoolView, prepareBorrow, prepareRepay, type CollateralSymbol, type PoolDeps,
} from "./service";
import { getLenderView, getPoolLoansView, prepareDeposit, prepareWithdraw } from "./lender";

const isAmount = (v: unknown): v is string => typeof v === "string" && /^[0-9]{1,20}$/.test(v);
const isSymbol = (v: unknown): v is CollateralSymbol => (SYMBOLS as readonly unknown[]).includes(v);

function fail(res: Response, err: unknown, what: string) {
    if (err instanceof PoolRequestError) return res.status(err.status).json({ error: err.message, ...err.details });
    console.error(`${what} failed:`, err);
    return res.status(500).json({ error: `${what} failed` });
}

export function poolRouter(deps: PoolDeps): Router {
    const r = Router();

    r.get("/pool", async (_req, res) => {
        try {
            res.json(await getPoolView(deps));
        } catch (err) {
            fail(res, err, "pool");
        }
    });

    r.get("/loans/:wallet", async (req, res) => {
        const { wallet } = req.params;
        if (!isWallet(wallet)) return res.status(400).json({ error: "invalid wallet" });
        try {
            res.json(await getLoansView(deps, wallet));
        } catch (err) {
            fail(res, err, "loans");
        }
    });

    r.post("/borrow/prepare", async (req, res) => {
        const { wallet, collateral, amount, collateralAmount } = req.body ?? {};
        if (!isWallet(wallet)) return res.status(400).json({ error: "invalid wallet" });
        if (!isSymbol(collateral)) return res.status(400).json({ error: "collateral must be SOL or tUSDC" });
        if (!isAmount(amount)) return res.status(400).json({ error: "amount must be a whole number of base units" });
        if (collateralAmount !== undefined && !isAmount(collateralAmount)) {
            return res.status(400).json({ error: "collateralAmount must be a whole number of base units" });
        }
        try {
            res.json(await prepareBorrow(deps, {
                wallet, collateral, amount: BigInt(amount),
                collateralAmount: collateralAmount === undefined ? undefined : BigInt(collateralAmount),
            }));
        } catch (err) {
            fail(res, err, "borrow prepare");
        }
    });

    r.post("/repay/prepare", async (req, res) => {
        const { wallet, loan } = req.body ?? {};
        if (!isWallet(wallet) || !isWallet(loan)) return res.status(400).json({ error: "wallet and loan must be addresses" });
        try {
            res.json(await prepareRepay(deps, wallet, loan));
        } catch (err) {
            fail(res, err, "repay prepare");
        }
    });
        r.get("/pool/loans", async (_req, res) => {
        try {
            res.json(await getPoolLoansView(deps));
        } catch (err) {
            fail(res, err, "pool loans");
        }
    });

    r.get("/lender/:wallet", async (req, res) => {
        const { wallet } = req.params;
        if (!isWallet(wallet)) return res.status(400).json({ error: "invalid wallet" });
        try {
            res.json(await getLenderView(deps, wallet));
        } catch (err) {
            fail(res, err, "lender");
        }
    });

    r.post("/deposit/prepare", async (req, res) => {
        const { wallet, amount } = req.body ?? {};
        if (!isWallet(wallet)) return res.status(400).json({ error: "invalid wallet" });
        if (!isAmount(amount)) return res.status(400).json({ error: "amount must be a whole number of base units" });
        try {
            res.json(await prepareDeposit(deps, wallet, BigInt(amount)));
        } catch (err) {
            fail(res, err, "deposit prepare");
        }
    });

    r.post("/withdraw/prepare", async (req, res) => {
        const { wallet, amount, all } = req.body ?? {};
        if (!isWallet(wallet)) return res.status(400).json({ error: "invalid wallet" });
        if ((all === true) === isAmount(amount)) {
            return res.status(400).json({ error: "send either amount (whole base units) or all: true" });
        }
        try {
            res.json(await prepareWithdraw(deps, wallet, all === true ? { all: true } : { amount: BigInt(amount) }));
        } catch (err) {
            fail(res, err, "withdraw prepare");
        }
    });

    return r;
}