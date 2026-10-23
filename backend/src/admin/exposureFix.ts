//! Moving stored exposure (E) to the current rule: E counts only meaningful loans and penalties.
//! The new E is rebuilt from a wallet's repayment attestations; the program only lets E go down.

import { exposureWeightBps } from "../history/scoring";
import type { RepaymentRecord } from "../score/attestations";

/** E under the current rule, from every repayment record of one wallet. */
export function exposureFromRecords(records: RepaymentRecord[]): bigint {
    return records.reduce((e, r) => e + exposureWeightBps(BigInt(r.principalUsdc), r.openedAt, r.closedAt, r.outcome), 0n);
}

export type ExposureChange = { wallet: string; storedBps: bigint; recomputedBps: bigint; action: "lower" | "keep" | "skip" };

/** What the script does for one wallet: lower E, keep it, or skip it (the program never raises E). */
export function exposureChange(wallet: string, storedBps: bigint, records: RepaymentRecord[]): ExposureChange {
    const recomputedBps = exposureFromRecords(records);
    const action = recomputedBps < storedBps ? "lower" : recomputedBps === storedBps ? "keep" : "skip";
    return { wallet, storedBps, recomputedBps, action };
}