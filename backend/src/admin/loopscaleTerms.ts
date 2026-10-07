//! Checks the Loopscale duration index → term mapping on real open loans: the index comes from the
//! borrow or the latest refinance on-chain, the term and start time from the Loopscale API.

import { getAllTransactions } from "../heliusClient";
import { durationSecs, effectiveStarts, latestStart, termStarts } from "../history/adapters/loopscaleTerms";
import { loopscale } from "../history/adapters/loopscale";
import { dedupe, succeeded } from "../history/adapters/common";

const API = "https://tars.loopscale.com/v1/markets/loans/info";

type ApiLedger = { ledgerIndex: number; principalMint: string; duration: number; durationType: number; startTime: number; endTime: number };
type ApiItem = { loan: { address: string; closed: boolean }; ledgers: ApiLedger[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One API call at a time, ~1 per second, waiting and retrying when the API answers 429. */
async function post(body: unknown): Promise<Response> {
    let wait = 5_000;
    for (let attempt = 0; attempt < 6; attempt++) {
        await sleep(1_000);
        const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (res.ok) return res;
        if (res.status !== 429) throw new Error(`Loopscale API ${res.status}: ${await res.text()}`);
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(retryAfter > 0 ? retryAfter * 1_000 : wait);
        wait *= 2;
    }
    throw new Error("Loopscale API still rate-limited after 6 tries");
}

async function openLoans(wallet: string): Promise<ApiItem[]> {
    const items: ApiItem[] = [];
    for (let page = 0; page < 20; page++) {
        const res = await post({ borrowers: [wallet], page, pageSize: 25 });
        const body = (await res.json()) as { items: ApiItem[]; pageInfo: { totalPages: number } };
        items.push(...body.items);
        if (page + 1 >= body.pageInfo.totalPages) break;
    }
    return items.filter((i) => !i.loan.closed && i.ledgers.length > 0);
}

async function main() {
    const wallets = process.argv.slice(2);
    if (wallets.length === 0) throw new Error("usage: npx tsx src/admin/loopscaleTerms.ts <wallet> [wallet …]");
    const rows: Record<string, unknown>[] = [];
    const byIndex = new Map<number, Set<string>>();
    for (const wallet of wallets) {
        const loans = await openLoans(wallet);
        const txs = [...(await getAllTransactions(wallet))];
        for (const l of loans) txs.push(...(await getAllTransactions(l.loan.address)));
        const events = dedupe(txs.filter(succeeded).flatMap((tx) => loopscale.events(wallet, tx)));
        const starts = effectiveStarts(events, termStarts(wallet, txs));
        const now = Math.floor(Date.now() / 1000);
        for (const l of loans) {
            for (const g of l.ledgers) {
                const latest = latestStart(starts, l.loan.address, g.principalMint, now);
                const term = durationSecs(g.duration, g.durationType);
                const termText = `${g.duration} ${["day", "week", "month"].at(g.durationType) ?? `type ${g.durationType}`}`;
                if (latest) {
                    const set = byIndex.get(latest.index) ?? new Set<string>();
                    set.add(termText);
                    byIndex.set(latest.index, set);
                }
                rows.push({
                    loan: l.loan.address.slice(0, 8),
                    ledger: g.ledgerIndex,
                    index: latest?.index ?? "not found",
                    startedBy: latest?.kind ?? "-",
                    termStarts: starts.filter((s) => s.loan === l.loan.address && s.mint === g.principalMint).length,
                    apiTerm: termText,
                    // our due date (latest real term start + the API's term) against the API's own end time
                    dueGap: latest && term !== null ? `${latest.at + term - g.endTime} s` : "-",
                });
            }
        }
    }
    console.table(rows);
    console.log("duration index → terms seen:");
    console.table([...byIndex].map(([index, terms]) => ({ index, terms: [...terms].join(", ") })));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});