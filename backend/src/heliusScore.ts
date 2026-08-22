import { createHelius } from "helius-sdk";

process.loadEnvFile();

// ── Setup ──────────────────────────────────────────────
const helius = createHelius({
    apiKey: process.env.HELIUS_API,
    network: "mainnet",
});

const TEST_ADDRESS = "";
const MAX_AGE_DAYS = 730;
const MIN_MONTHLY_TXNS = 5;
const MAX_DIVERSITY = 15;
const MAX_PAGES = 20;
const MAX_WEALTH_USD = 100_100; // placeholder ceiling — tune once you've seen more real wallets

const WEIGHTS = {
    history: 0.20,
    activity: 0.20,
    identity: 0.15,
    wealth: 0.15,
    humanity: 0.20,
    diversity: 0.10,
};

// ── Types ──────────────────────────────────────────────
async function getTransaction() {
    return await helius.getTransactionsForAddress([
        TEST_ADDRESS,
        {
            limit: 100,
            transactionDetails: "full",
            filters: { tokenAccounts: "none" },
            sortOrder: "asc",
        },
    ]);
}
type TransactionsResponse = Awaited<ReturnType<typeof getTransaction>>;
type TransactionList = TransactionsResponse["data"];

type TransactionMessage = {
    accountKeys: string[];
    instructions: { programIdIndex: number }[];
};
type TransactionWithMessage = {
    message: TransactionMessage;
};

type ScoreBreakdown = {
    total: number;
    historyScore: number;
    activityScore: number;
    identityScore: number;
    wealthScore: number;
    humanityScore: number;
    diversityScore: number;
};

// ── Fetching ───────────────────────────────────────────
async function getAllTransactions(): Promise<TransactionList> {
    let allTransactions: TransactionList = [];
    let token: string | null | undefined = undefined;
    let pages = 0;
    const cutoffSeconds = Date.now() / 1000;

    do {
        const response: TransactionsResponse = await helius.getTransactionsForAddress([
            TEST_ADDRESS,
            {
                limit: 100,
                transactionDetails: "full",
                filters: { tokenAccounts: "none" },
                sortOrder: "desc",
                paginationToken: token,
            },
        ]);

        allTransactions = [...allTransactions, ...response.data];
        token = response.data.length > 0 ? response.paginationToken : null;
        pages = pages + 1;

        const oldestTx = response.data[response.data.length - 1];
        const oldestBlocktime = oldestTx.blockTime;
        if (oldestBlocktime !== null) {
            const ageDays = (cutoffSeconds - oldestBlocktime) / 60 / 60 / 24;
            if (ageDays > MAX_AGE_DAYS) {
                token = null;
            }
        }
    } while (token !== null && token !== undefined && pages < MAX_PAGES);

    return allTransactions;
}

// ── History ────────────────────────────────────────────
async function computeHistoryScore(): Promise<number> {
    const response = await getTransaction();
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
        throw new Error("Zero active months");
    }

    let monthsHittingFloor = 0;
    for (const count of Object.values(monthCounts)) {
        if (count >= minMonthlyTxns) {
            monthsHittingFloor += 1;
        }
    }

    return (monthsHittingFloor / months) * 1000;
}

async function computeActivityScore(): Promise<number> {
    const allTransactions = await getAllTransactions();
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

async function computeDiversityScore(): Promise<number> {
    const allTransactions = await getAllTransactions();
    const programIds = getUniqueProgramIds(allTransactions);
    return Math.min(programIds.size / MAX_DIVERSITY, 1) * 1000;
}

// ── Wealth ─────────────────────────────────────────────
// Note: staking intentionally excluded — getHeliusStakeAccounts only sees
// stakes delegated to Helius's own validator, not staking in general, so
// it would silently undercount most real stakers. Revisit later if a
// general Stake Program lookup gets added.
async function computeWealthScore(): Promise<number> {
    const balances = await helius.wallet.getBalances({
        wallet: TEST_ADDRESS,
        showNative: true,
        showNfts: false,
    });

    let totalUsdValue = balances.totalUsdValue;
    if (totalUsdValue === 0) totalUsdValue += 1; // avoid Math.log(0) = -Infinity

    const logValue = Math.log(totalUsdValue);
    const logCeiling = Math.log(MAX_WEALTH_USD);

    return Math.min(logValue / logCeiling, 1) * 1000;
}

// ── Total ──────────────────────────────────────────────
async function calculateTrustScore(): Promise<ScoreBreakdown> {
    const historyScore = await computeHistoryScore();
    const activityScore = await computeActivityScore();
    const diversityScore = await computeDiversityScore();
    const wealthScore = await computeWealthScore();

    const identityScore = 0;
    const humanityScore = 0;

    const total = Math.round(
        WEIGHTS.history * historyScore +
        WEIGHTS.activity * activityScore +
        WEIGHTS.identity * identityScore +
        WEIGHTS.wealth * wealthScore +
        WEIGHTS.humanity * humanityScore +
        WEIGHTS.diversity * diversityScore
    );

    return {
        total,
        historyScore,
        activityScore,
        identityScore,
        wealthScore,
        humanityScore,
        diversityScore,
    };
}

async function main() {
    const result = await calculateTrustScore();
    console.log(result);
}

main();

//also can we make a doc of this where we add what all we did rough engineering what geniune project related problem we hit and how we solved it