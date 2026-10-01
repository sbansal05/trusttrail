import { getTransaction } from "../heliusClient";
import { KAMINO_PROGRAM_ID, getInstructionName } from "../getObligations";

async function main() {
    const res = await getTransaction(KAMINO_PROGRAM_ID);   // ek page = 100 txs
    const owners = new Map<string, number>();
    for (const tx of res.data) {
        const meta = (tx as any).meta;
        const message = (tx.transaction as any).message;
        const keys = [...message.accountKeys, ...(meta?.loadedAddresses?.writable ?? []), ...(meta?.loadedAddresses?.readonly ?? [])];
        for (const ix of message.instructions) {
            if (keys[ix.programIdIndex] !== KAMINO_PROGRAM_ID) continue;
            const name = getInstructionName(ix.data) ?? "";
            if (!name.startsWith("borrowObligationLiquidity")) continue;
            const owner = keys[ix.accounts[0]];
            owners.set(owner, (owners.get(owner) ?? 0) + 1);
        }
    }
    console.log(owners);
}
main();