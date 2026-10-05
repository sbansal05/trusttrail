//! What one import (first or repeat) writes on-chain.
//! The score is always rebuilt from the whole priced history, so old penalties keep fading.
//! The counts only take loans closed after the previous import, so nothing is counted twice.

import type { Loan } from "./types";
import type { PricedLoan } from "./prices";
import { importSummary, type ImportSummary } from "./scoring";

export type ImportPlan = ImportSummary & {
    previousImportDate: number; 
    computedAt: number;         
    newLoans: number;           
    priced: PricedLoan[];       // the whole priced history (public)
    dropped: Loan[];            // loans we could not price: not scored, but still public
};

/** True if this loan has not been counted by an earlier import. */
export function isNewSince(loan: Loan, previousImportDate: number): boolean {
    return loan.closedAt > previousImportDate;
}

export function planImport(priced: PricedLoan[], dropped: Loan[], previousImportDate: number, now: number): ImportPlan {
    const fresh = priced.filter((l) => isNewSince(l, previousImportDate));
    const { score } = importSummary(priced, now);
    const { meaningfulOnTime, meaningfulWeightBps } = importSummary(fresh, now);
    return {
        score,
        meaningfulOnTime,
        meaningfulWeightBps,
        previousImportDate,
        computedAt: now,
        newLoans: fresh.length,
        priced,
        dropped,
    };
}