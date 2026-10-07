//! GET /score/{wallet}: live score and tier, the factors behind them, import coverage and native records.

import { PublicKey, type Connection } from "@solana/web3.js";
import type { Pool } from "pg";
import { clusterTime, fetchReputation } from "../history/chain";
import { IMPORT_COOLDOWN_SECS } from "../history/importService";
import { TIER_NAMES } from "../history/scoring";
import { importHistory } from "../history/store";
import { coverageOf, type Coverage } from "./coverage";
import { repaymentsOf, type RepaymentRecord } from "./attestations";
import { emptyReputation, factors, standing, type Factors } from "./standing";

export type ScoreDeps = {
    pool: Pool;
    connection: Pick<Connection, "getAccountInfo" | "getProgramAccounts">;
};

export type ScoreView = {
    wallet: string;
    exists: boolean;     // false: no score account yet, everything reads as zero
    asOf: number;        // cluster time the score was computed for
    score: number;
    tier: number;
    tierName: string;
    lastUpdate: number;  // when the account last changed on-chain
    factors: Factors;
    coverage: Coverage;
    attestations: RepaymentRecord[];
};

export async function getScore(deps: ScoreDeps, walletAddress: string): Promise<ScoreView> {
    const wallet = new PublicKey(walletAddress);
    const [stored, now, attestations, imports] = await Promise.all([
        fetchReputation(deps.connection, wallet),
        clusterTime(deps.connection),
        repaymentsOf(deps.connection, wallet),
        importHistory(deps.pool, walletAddress, true),
    ]);
    const rep = stored ?? emptyReputation(walletAddress);
    const s = standing(rep, now);
    return {
        wallet: walletAddress,
        exists: stored !== null,
        asOf: now,
        score: Number(s.score),
        tier: s.tier,
        tierName: TIER_NAMES[s.tier],
        lastUpdate: rep.lastUpdate,
        factors: factors(rep, s, now),
        coverage: coverageOf(imports[0], rep.importDate !== 0 ? rep.importDate + IMPORT_COOLDOWN_SECS : null),
        attestations,
    };
}
