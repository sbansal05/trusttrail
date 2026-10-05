import type { Connection, Keypair } from "@solana/web3.js";
import { PublicKey, Transaction } from "@solana/web3.js";
import type { Pool } from "pg";
import { clusterTime, readReputation } from "./chain";
import { planImport } from "./importPlan";
import { buildImportTx } from "./importTx";
import { priceLoans, type PriceSources } from "./prices";
import { confirmImport, pendingTx, savePending } from "./store";
import type { Loan } from "./types";

/** Same as the program's IMPORT_COOLDOWN_SECS. */
export const IMPORT_COOLDOWN_SECS = 15 * 86_400;

/** Everything the flow talks to, so tests can pass fakes. */
export type ImportDeps = {
    pool: Pool;
    connection: Pick<Connection, "getAccountInfo" | "getLatestBlockhash" | "sendRawTransaction" | "confirmTransaction">;
    writer: Keypair;
    prices: PriceSources;
    history: (wallet: string) => Promise<Loan[]>;
};

/** An error with the HTTP status the route should answer with. */
export class ImportError extends Error {
    constructor(public status: number, message: string, public details: Record<string, unknown> = {}) {
        super(message);
    }
}

export type PreparedImport = {
    importId: string;
    transaction: string; // base64, signed by the writer, still needs the wallet's signature
    score: number;
    meaningfulOnTime: number;
    newLoans: number;
    pricedLoans: number;
    unpricedLoans: number;
    createsAccount: boolean;
};

export async function prepareImport(deps: ImportDeps, walletAddress: string): Promise<PreparedImport> {
    const wallet = new PublicKey(walletAddress);
    const { exists, importDate } = await readReputation(deps.connection, wallet);
    const now = await clusterTime(deps.connection);

    // Checked before any history is fetched, so a too-early request costs no API credits.
    if (importDate !== 0 && now - importDate < IMPORT_COOLDOWN_SECS) {
        throw new ImportError(429, "import cooldown has not passed", { nextImportAt: importDate + IMPORT_COOLDOWN_SECS });
    }

    const loans = await deps.history(walletAddress);
    const { priced, dropped } = await priceLoans(loans, deps.prices);
    const plan = planImport(priced, dropped, importDate, now);

    const { blockhash, lastValidBlockHeight } = await deps.connection.getLatestBlockhash("confirmed");
    const tx = buildImportTx({ writer: deps.writer, wallet, plan, needsInit: !exists, blockhash, lastValidBlockHeight });
    const importId = await savePending(deps.pool, walletAddress, plan, {
        message: tx.serializeMessage().toString("base64"),
        lastValidBlockHeight,
    });

    return {
        importId,
        transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
        score: Number(plan.score),
        meaningfulOnTime: plan.meaningfulOnTime,
        newLoans: plan.newLoans,
        pricedLoans: priced.length,
        unpricedLoans: dropped.length,
        createsAccount: !exists,
    };
}

export async function submitImport(deps: ImportDeps, importId: string, signedTx: string): Promise<string> {
    const expected = await pendingTx(deps.pool, importId);
    if (expected === null) throw new ImportError(404, "no pending import with this id");

    let tx: Transaction;
    try {
        tx = Transaction.from(Buffer.from(signedTx, "base64"));
    } catch {
        throw new ImportError(400, "transaction could not be decoded");
    }
    if (tx.serializeMessage().toString("base64") !== expected.message) {
        throw new ImportError(400, "transaction differs from the prepared one");
    }
    if (!tx.verifySignatures()) throw new ImportError(400, "transaction is missing a valid signature");

    let signature: string;
    try {
        signature = await deps.connection.sendRawTransaction(tx.serialize());
    } catch (err) {
        // Simulation failed (for example the blockhash expired or the program refused the import).
        throw new ImportError(400, "transaction was rejected", { reason: (err as Error).message });
    }
    const result = await deps.connection.confirmTransaction(
        { signature, blockhash: tx.recentBlockhash!, lastValidBlockHeight: expected.lastValidBlockHeight },
        "confirmed",
    );
    if (result.value.err) throw new ImportError(400, "transaction failed on-chain", { err: result.value.err, signature });

    await confirmImport(deps.pool, importId, signature);
    return signature;
}