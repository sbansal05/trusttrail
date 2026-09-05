import { createHelius } from "helius-sdk";

export const helius = createHelius({
    apiKey: process.env.HELIUS_API,
    network: "mainnet",
});

export const MAX_AGE_DAYS = 730;
const MAX_PAGES = 20;

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

export async function getAllTransactions(walletAddress: string): Promise<TransactionList> {
    let allTransactions: TransactionList = [];
    let token: string | null | undefined = undefined;
    let pages = 0;
    const cutoffSeconds = Date.now() / 1000;

    do {
        const response: TransactionsResponse = await helius.getTransactionsForAddress([
            walletAddress,
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
        if (oldestTx) {
            const oldestBlocktime = oldestTx.blockTime;
            if (oldestBlocktime !== null) {
                const ageDays = (cutoffSeconds - oldestBlocktime) / 60 / 60 / 24;
                if (ageDays > MAX_AGE_DAYS) {
                    token = null;
                }
            }
        }
    } while (token !== null && token !== undefined && pages < MAX_PAGES);

    return allTransactions;
}