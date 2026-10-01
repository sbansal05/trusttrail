import { getAllTransactions } from "../heliusClient";
import { KAMINO_PROGRAM_ID, getKaminoActionCounts } from "../getObligations";

const wallet = process.argv[2] ?? "AgmLJBMDCqWynYnQiPCuj9ewsNNsBJXyzoUhD9LJzN51";

async function main() {
    const txs = await getAllTransactions(wallet);
    const first = (txs[0].transaction as any).message.accountKeys[0];
    console.log("accountKeys[0] type:", typeof first, JSON.stringify(first).slice(0, 60));

    let top = 0, inner = 0;
    for (const tx of txs) {
        const meta = (tx as any).meta;
        const message = (tx.transaction as any).message;
        const keys = [...message.accountKeys, ...(meta?.loadedAddresses?.writable ?? []), ...(meta?.loadedAddresses?.readonly ?? [])];
        for (const ix of message.instructions) if (keys[ix.programIdIndex] === KAMINO_PROGRAM_ID) top++;
        for (const group of meta?.innerInstructions ?? [])
            for (const ix of group.instructions) if (keys[ix.programIdIndex] === KAMINO_PROGRAM_ID) inner++;
    }
    console.log({ txs: txs.length, kaminoTopLevel: top, kaminoInner: inner });
    console.log("old counter:", await getKaminoActionCounts(wallet));
}
main();