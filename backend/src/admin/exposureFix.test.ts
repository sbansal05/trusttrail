import { test } from "node:test";
import assert from "node:assert/strict";
import { exposureChange } from "./exposureFix";
import { principalWeightBps } from "../history/scoring";
import type { RepaymentRecord } from "../score/attestations";

const T0 = 1_800_000_000, DAY = 86_400;
const record = (openedAt: number, closedAt: number, outcome: number): RepaymentRecord => ({
    address: "A", loan: "L", borrower: "W", lenderProgram: "P", principalUsdc: "250000000", interestPaidUsdc: "0",
    openedAt, dueAt: openedAt + 30 * DAY, closedAt, outcome, collateralRatioBps: 15_000, tierAtOpen: 0,
});

test("exposure fix: rebuilt from attestations, lowered only when the stored value is higher", () => {
    const w = principalWeightBps(250_000_000n);
    const records = [
        record(T0, T0 + 600, 0),              // repaid after 10 minutes: 0
        record(T0 + DAY, T0 + 2 * DAY, 0),    // repaid after a day: w
        record(T0 + 3 * DAY, T0 + 3 * DAY + 600, 2), // liquidated: w
    ];
    assert.deepEqual(exposureChange("W", 3n * w, records), { wallet: "W", storedBps: 3n * w, recomputedBps: 2n * w, action: "lower" });
    assert.equal(exposureChange("W", 2n * w, records).action, "keep");
    assert.equal(exposureChange("W", w, records).action, "skip", "the program refuses to raise E");
    assert.equal(exposureChange("W", 0n, []).action, "keep");
});