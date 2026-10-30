//! One preview read, in its own worker thread (started by `workerRead`). If the history is too large for the
//! worker's memory cap, only this thread stops.

import { parentPort, workerData } from "node:worker_threads";
import { readPreview } from "./preview";
import { liveSources } from "./prices";
import { CHECKED_PROTOCOLS, walletLoans } from "./adapters";

const { wallet } = workerData as { wallet: string };

readPreview(
    { prices: liveSources(), history: walletLoans, checkedProtocols: CHECKED_PROTOCOLS, now: () => Math.floor(Date.now() / 1000) },
    wallet,
).then((preview) => parentPort!.postMessage(preview));