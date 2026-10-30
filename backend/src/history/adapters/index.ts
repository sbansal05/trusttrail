//! Every supported protocol, read from one pass over the wallet's history.

import type { CreditEvent, Loan } from "../types";
import { buildLoans } from "../buildLoans";
import { readHistory, type History, type TransactionList } from "../../heliusClient";
import { walletEvents, type Adapter } from "./common";
import { kamino } from "./kamino";
import { marginfi } from "./marginfi";
import { save } from "./save";
import { jupiterLend } from "./jupiterLend";
import { loopscale } from "./loopscale";
import { jupiterStateEvents, mainnetConnection, sdkPositionReader } from "./jupiterState";
import { loopscaleDueDates } from "./loopscaleTerms";

export const ADAPTERS: Adapter[] = [kamino, marginfi, save, jupiterLend, loopscale];
export const CHECKED_PROTOCOLS = ADAPTERS.map((a) => a.protocol);

/**
 * Each address's history is fetched once per import, however many steps read it.
 * `capped()` is true once any address read so far was cut short by the page limit.
 */
export function cachedHistory(read: (address: string) => Promise<History<TransactionList[number]>> = readHistory) {
    const seen = new Map<string, Promise<TransactionList>>();
    let capped = false;
    const history = (address: string): Promise<TransactionList> => {
        if (!seen.has(address)) {
            seen.set(address, read(address).then((h) => {
                capped ||= h.capped;
                return h.transactions;
            }));
        }
        return seen.get(address)!;
    };
    return { history, capped: () => capped };
}

/** A wallet's events, and whether the page limit cut the wallet's or any position's history short. */
export type WalletHistory = { events: CreditEvent[]; capped: boolean };

export async function walletHistory(wallet: string): Promise<WalletHistory> {
    const { history, capped } = cachedHistory();
    const events = await walletEvents(wallet, ADAPTERS, history);
    // Jupiter Lend liquidations never name the position: read each position's state too.
    events.push(...(await jupiterStateEvents(events, sdkPositionReader(mainnetConnection()))));
    // Loopscale terms start at the borrow and again at each rollover; the due date in force is set here.
    return { events: await loopscaleDueDates(wallet, events, history), capped: capped() };
}

/** The wallet's closed loans, and whether the page limit cut its history short. */
export async function walletLoans(wallet: string): Promise<{ loans: Loan[]; capped: boolean }> {
    const { events, capped } = await walletHistory(wallet);
    return { loans: buildLoans(events), capped };
}