import { getAllTransactions } from "../heliusClient";
import { kaminoEvents } from "./adapters/kamino";
import { buildLoans } from "./buildLoans";
import { kaminoHistory } from "./adapters/kamino";
const wallet = process.argv[2] ?? "AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51";

async function main() {
    const events = await kaminoHistory(wallet);
    const loans = buildLoans(events);
    console.table(events.slice(0, 10).map((e) => ({ kind: e.kind, amount: e.amount.toString(), mint: e.mint.slice(0, 6), pos: e.position.slice(0, 6) })));
    console.table(loans.map((l) => ({ principal: l.principal.toString(), days: ((l.closedAt - l.openedAt) / 86400).toFixed(1), outcome: l.outcome })));
}
main();