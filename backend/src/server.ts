try {
    process.loadEnvFile();
} catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
import express from "express";
import cors from "cors";
import { Connection, Keypair } from "@solana/web3.js";
import { createPool } from "./history/db";
import { migrate } from "./history/store";
import { importHistoryRouter, importRouter } from "./history/routes";
import { liveSources } from "./history/prices";
import { kaminoHistory } from "./history/adapters/kamino";
import { buildLoans } from "./history/buildLoans";

function required(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`${name} is not set`);
    return v;
}

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173").split(",");
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const pool = createPool();
const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
// The backend's own writer key: whitelisted in TrustTrail, separate from the admin / upgrade wallet.
const writer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(required("WRITER_PRIVATE_KEY"))));

app.use(importHistoryRouter(pool));
app.use(
    importRouter({
        pool,
        connection,
        writer,
        prices: liveSources(),
        history: async (wallet) => buildLoans(await kaminoHistory(wallet)),
    }),
);

const port = Number(process.env.PORT || 3000);
migrate(pool)
    .then(() => app.listen(port, () => console.log(`listening on port ${port}`)))
    .catch((err) => {
        console.error("database migration failed:", err);
        process.exit(1);
    });