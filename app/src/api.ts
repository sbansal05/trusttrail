//! Typed calls to the TrustTrail backend. Shapes mirror the backend's responses; amounts that can
//! exceed 2^53 (micro-USDC, bps weights) arrive as decimal strings.

import { BACKEND_URL } from "./config";

export class ApiError extends Error {
    status: number;
    body: Record<string, unknown>;
    constructor(status: number, body: Record<string, unknown>) {
        super(typeof body.error === "string" ? body.error : `request failed (${status})`);
        this.status = status;
        this.body = body;
    }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${BACKEND_URL}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body);
    return body as T;
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

// ---------- /score ----------

export type Gate =
    | { gate: "score" | "meaningfulOnTime" | "meaningfulWeightBps"; have: string; need: string; met: boolean }
    | { gate: "noLiquidationFor90Days"; blockedUntil: number | null; met: boolean };

export type Factors = {
    native: number;
    imported: number;
    importDate: number;
    blend: { exposureBps: string; fullWeightBps: string; nativeShareBps: string; importedShareBps: string };
    meaningful: { onTime: number; weightBps: string };
    liquidation: { last: number; blockedUntil: number | null };
    nextTier: { tier: string; gates: Gate[] } | null;
};

export type ProtocolCoverage = {
    protocol: string;
    loans: number;
    onTime: number;
    late: number;
    liquidated: number;
    defaulted: number;
    unpriced: number;
    usdMicro: string;
};

export type Coverage = {
    importId: string | null;
    importedAt: number | null;
    nextImportAt: number | null;
    protocols: ProtocolCoverage[];
};

export type RepaymentRecord = {
    address: string;
    loan: string;
    borrower: string;
    lenderProgram: string;
    principalUsdc: string;
    interestPaidUsdc: string;
    openedAt: number;
    dueAt: number;
    closedAt: number;
    outcome: number;
    collateralRatioBps: number;
    tierAtOpen: number;
};

export type ScoreView = {
    wallet: string;
    exists: boolean;
    asOf: number;
    score: number;
    tier: number;
    tierName: string;
    lastUpdate: number;
    factors: Factors;
    coverage: Coverage;
    attestations: RepaymentRecord[];
};

export const getScore = (wallet: string) => call<ScoreView>(`/score/${wallet}`);

// ---------- import ----------

export type PreparedImport = {
    importId: string;
    transaction: string;
    score: number;
    meaningfulOnTime: number;
    newLoans: number;
    pricedLoans: number;
    unpricedLoans: number;
    sameTransactionLoans: number;
    createsAccount: boolean;
};

export const prepareImport = (wallet: string, timestamp: number, signature: string) =>
    post<PreparedImport>("/import/prepare", { wallet, timestamp, signature });

export const submitImport = (importId: string, transaction: string) =>
    post<{ signature: string }>("/import/submit", { importId, transaction });

export type PublicLoan = {
    protocol: string;
    position: string;
    mint: string;
    decimals: number;
    rawAmount: string;
    priced: boolean;
    usdMicro: string | null;
    openedAt: number;
    closedAt: number;
    dueAt: number;
    outcome: number;
    signatures: { open: string; peak: string; end: string };
};

export type PublicImport = {
    id: string;
    txSignature: string;
    confirmedAt: string;
    score: number;
    computedAt: number;
    checkedProtocols: string[];
    loans: PublicLoan[];
};

/** The latest confirmed import, or null when the wallet never imported. */
export async function getLatestImport(wallet: string): Promise<PublicImport | null> {
    try {
        const { imports } = await call<{ imports: PublicImport[] }>(`/import-history/${wallet}`);
        return imports[0] ?? null;
    } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
    }
}

// ---------- faucet ----------

export const claimFaucet = (wallet: string) =>
    post<{ signature: string; amount: string; nextClaimAt: number }>("/faucet", { wallet });
