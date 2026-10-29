try {
    process.loadEnvFile();
} catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
import { createHelius } from "helius-sdk";

export const helius = createHelius({
    apiKey: process.env.HELIUS_API,
    network: "mainnet",
});

export const MAX_AGE_DAYS = 730;
export const MAX_PAGES = 20;

export async function getTransaction(walletAddress: string) {
    return await helius.getTransactionsForAddress([
        walletAddress,
        {
            limit: 100,
            transactionDetails: "full",
            filters: { tokenAccounts: "none" },
            sortOrder: "asc",
        },
    ]);
}
export type TransactionsResponse = Awaited<ReturnType<typeof getTransaction>>;
export type TransactionList = TransactionsResponse["data"];

export type TransactionMessage = {
    accountKeys: string[];
    instructions: { programIdIndex: number }[];
};
export type TransactionWithMessage = {
    message: TransactionMessage;
};

export type History<T> = { transactions: T[]; capped: boolean };
type Page<T> = { data: readonly T[]; paginationToken: string | null };

/**
 * Reads newest-first pages until the history runs out or goes past MAX_AGE_DAYS.
 * `capped` is true when MAX_PAGES were read and more pages were still left.
 */
export async function pageThrough<T extends { blockTime: number | null }>(
    fetchPage: (token: string | undefined) => Promise<Page<T>>,
    nowSeconds = Date.now() / 1000,
): Promise<History<T>> {
    const transactions: T[] = [];
    let token: string | undefined = undefined;
    for (let pages = 0; pages < MAX_PAGES; pages++) {
        const page = await fetchPage(token);
        transactions.push(...page.data);
        const oldest = page.data[page.data.length - 1];
        const tooOld = oldest?.blockTime != null && (nowSeconds - oldest.blockTime) / 86_400 > MAX_AGE_DAYS;
        if (page.data.length === 0 || !page.paginationToken || tooOld) return { transactions, capped: false };
        token = page.paginationToken;
    }
    return { transactions, capped: true };
}

/** An address's history, newest first, and whether MAX_PAGES cut it short. */
export async function readHistory(address: string): Promise<History<TransactionList[number]>> {
    return pageThrough((token) =>
        helius.getTransactionsForAddress([
            address,
            {
                limit: 100,
                transactionDetails: "full",
                filters: { tokenAccounts: "none" },
                sortOrder: "desc",
                paginationToken: token,
            },
        ]),
    );
}

export async function getAllTransactions(address: string): Promise<TransactionList> {
    return (await readHistory(address)).transactions;
}