//! Every supported protocol, read from one pass over the wallet's history.

import type { CreditEvent } from "../types";
import { getAllTransactions, type TransactionList } from "../../heliusClient";
import { walletEvents, type Adapter } from "./common";
import { kamino } from "./kamino";
import { marginfi } from "./marginfi";
import { save } from "./save";
import { jupiterLend } from "./jupiterLend";
import { loopscale } from "./loopscale";
import { jupiterStateEvents, mainnetConnection, sdkPositionReader } from "./jupiterState";
import { loopscaleDueDates } from "./loopscaleTerms";

export const ADAPTERS: Adapter[] = [kamino, marginfi, save, jupiterLend, loopscale];

/** Each address's history is fetched once per import, however many steps read it. */
function cachedHistory(): (address: string) => Promise<TransactionList> {
    const seen = new Map<string, Promise<TransactionList>>();
    return (address) => {
        if (!seen.has(address)) seen.set(address, getAllTransactions(address));
        return seen.get(address)!;
    };
}

export async function walletHistory(wallet: string): Promise<CreditEvent[]> {
    const history = cachedHistory();
    const events = await walletEvents(wallet, ADAPTERS, history);
    // Jupiter Lend liquidations never name the position: read each position's state too.
    events.push(...(await jupiterStateEvents(events, sdkPositionReader(mainnetConnection()))));
    // Loopscale terms start at the borrow and again at each rollover; the due date in force is set here.
    return loopscaleDueDates(wallet, events, history);
}
