//! Every supported protocol, read from one pass over the wallet's history.

import type { CreditEvent } from "../types";
import { getAllTransactions } from "../../heliusClient";
import { walletEvents, type Adapter } from "./common";
import { kamino } from "./kamino";
import { marginfi } from "./marginfi";
import { save } from "./save";

export const ADAPTERS: Adapter[] = [kamino, marginfi, save];

export function walletHistory(wallet: string): Promise<CreditEvent[]> {
    return walletEvents(wallet, ADAPTERS, getAllTransactions);
}
