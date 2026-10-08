//! How fresh are Pyth's sponsored SOL/USD and USDC/USD feeds on this cluster? The pool refuses a price
//! older than the collateral's max age (60 s), so this decides whether the frontend must post its own.

try {
    process.loadEnvFile();
} catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
}
import { Connection } from "@solana/web3.js";
import { FEED_IDS, PYTH_RECEIVER_ID, parsePriceUpdate, sponsoredFeedAccount } from "../pool/accounts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const samples = Number(process.argv[2] ?? 4), gap = Number(process.argv[3] ?? 20);
    const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
    const feeds = Object.entries(FEED_IDS).map(([name, id]) => ({ name, id, account: sponsoredFeedAccount(id) }));
    for (const f of feeds) console.log(`${f.name}: ${f.account.toBase58()}`);

    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < samples; i++) {
        const now = Math.floor(Date.now() / 1000);
        for (const f of feeds) {
            const info = await connection.getAccountInfo(f.account);
            if (!info) { rows.push({ feed: f.name, sample: i, status: "account not found" }); continue; }
            const p = parsePriceUpdate(info.data);
            rows.push({
                feed: f.name,
                sample: i,
                owner: info.owner.equals(PYTH_RECEIVER_ID) ? "pyth receiver" : info.owner.toBase58(),
                status: !p ? "not a Full PriceUpdateV2" : p.feedId.equals(f.id) ? "ok" : "wrong feed id",
                price: p ? Number(p.price) * 10 ** p.exponent : "-",
                ageSecs: p ? now - p.publishTime : "-",
            });
        }
        if (i + 1 < samples) await sleep(gap * 1000);
    }
    console.table(rows);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
