import { getKaminoActionCounts, computeRepaymentScore, computeLiquidationScore } from "./getObligations";
import {
    helius,
    getTransaction,
    getAllTransactions,
    MAX_AGE_DAYS,
    TransactionList,
    TransactionWithMessage,
} from "./heliusClient";

const TEST_ADDRESS = "AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51";
const MIN_MONTHLY_TXNS = 5;
const MAX_DIVERSITY = 15;
const MAX_WEALTH_USD = 100_100;

const WEIGHTS = {
    history: 0.10,
    activity: 0.10,
    diversity: 0.10,
    wealth: 0.15,
    repayment: 0.35,
    liquidation: 0.20,
};

type ScoreBreakdown = {
    total: number;
    historyScore: number;
    activityScore: number;
    wealthScore: number;
    diversityScore: number;
    repaymentScore: number;
    liquidationScore: number;
};

// ── History ────────────────────────────────────────────
export async function computeHistoryScore(walletAddress: string): Promise<number> {
    const response = await getTransaction(walletAddress);
    if (response.data.length === 0) {
        return 0;
    }
    const oldestBlocktime = response.data[0].blockTime;
    if (oldestBlocktime === null) {
        throw new Error("Oldest transaction has no blockTime");
    }

    const ageMs = Date.now() - oldestBlocktime * 1000;
    const ageDays = ageMs / 1000 / 60 / 60 / 24;

    return Math.min(ageDays / MAX_AGE_DAYS, 1) * 1000;
}

// ── Activity ───────────────────────────────────────────
function countTxnsByMonth(transactions: TransactionList): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const tx of transactions) {
        const msec = tx.blockTime;
        if (msec === null) {
            throw new Error("Transaction has no blockTime");
        }

        const date = new Date(msec * 1000);
        const key = `${date.getFullYear()}-${date.getMonth() + 1}`;

        counts[key] = (counts[key] || 0) + 1;
    }

    return counts;
}

function computeConsistencyScore(monthCounts: Record<string, number>, minMonthlyTxns: number): number {
    const months = Object.keys(monthCounts).length;
    if (months === 0) {
        return 0;
    }

    let monthsHittingFloor = 0;
    for (const count of Object.values(monthCounts)) {
        if (count >= minMonthlyTxns) {
            monthsHittingFloor += 1;
        }
    }

    return (monthsHittingFloor / months) * 1000;
}

export async function computeActivityScore(walletAddress: string): Promise<number> {
    const allTransactions = await getAllTransactions(walletAddress);
    const monthCounts = countTxnsByMonth(allTransactions);
    return computeConsistencyScore(monthCounts, MIN_MONTHLY_TXNS);
}

// ── Diversity ──────────────────────────────────────────
function getUniqueProgramIds(transactions: TransactionList): Set<string> {
    const programIds = new Set<string>();

    for (const tx of transactions) {
        const message = (tx.transaction as TransactionWithMessage).message;
        for (const instruction of message.instructions) {
            const programId = message.accountKeys[instruction.programIdIndex];
            programIds.add(programId);
        }
    }

    return programIds;
}

export async function computeDiversityScore(walletAddress: string): Promise<number> {
    const allTransactions = await getAllTransactions(walletAddress);
    const programIds = getUniqueProgramIds(allTransactions);
    return Math.min(programIds.size / MAX_DIVERSITY, 1) * 1000;
}

// ── Wealth ─────────────────────────────────────────────
async function computeWealthScore(walletAddress: string): Promise<number> {
    const balances = await helius.wallet.getBalances({
        wallet: walletAddress,
        showNative: true,
        showNfts: false,
    });

    let totalUsdValue = balances.totalUsdValue;
    if (totalUsdValue === 0) totalUsdValue += 1;

    const logValue = Math.log(totalUsdValue);
    const logCeiling = Math.log(MAX_WEALTH_USD);

    return Math.min(logValue / logCeiling, 1) * 1000;
}

// ── Total ──────────────────────────────────────────────
export async function calculateTrustScore(walletAddress: string): Promise<ScoreBreakdown> {
    const historyScore = await computeHistoryScore(walletAddress);
    const activityScore = await computeActivityScore(walletAddress);
    const diversityScore = await computeDiversityScore(walletAddress);
    const wealthScore = await computeWealthScore(walletAddress);

    const kaminoCounts = await getKaminoActionCounts(walletAddress);
    const repaymentScore = computeRepaymentScore(kaminoCounts);
    const liquidationScore = computeLiquidationScore(kaminoCounts);

    const total = Math.round(
        WEIGHTS.history * historyScore +
        WEIGHTS.activity * activityScore +
        WEIGHTS.wealth * wealthScore +
        WEIGHTS.diversity * diversityScore +
        WEIGHTS.repayment * repaymentScore +
        WEIGHTS.liquidation * liquidationScore
    );

    return {
        total,
        historyScore,
        activityScore,
        wealthScore,
        diversityScore,
        repaymentScore,
        liquidationScore,
    };
}

async function main() {
    const result = await calculateTrustScore(TEST_ADDRESS);
    console.log(result);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}