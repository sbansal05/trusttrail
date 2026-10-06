import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLoans, withoutSameTransaction } from "./buildLoans";
import { CreditEvent } from "./types";

const DAY = 86_400;
const T0 = 1_700_000_000;
const USDC = 1_000_000n;

let n = 0;
function ev(kind: CreditEvent["kind"], amount: bigint, timestamp: number, over: Partial<CreditEvent> = {}): CreditEvent {
    return {
        protocol: "kamino", wallet: "W", position: "OBL1", kind,
        mint: "USDC", amount, decimals: 6, timestamp, signature: `sig${n++}`, dueAt: 0, ...over,
    };
}

test("borrow then full repay makes one on-time loan", () => {
    const loans = buildLoans([ev("borrow", 500n * USDC, T0), ev("repay", 505n * USDC, T0 + 3 * DAY)]);
    assert.equal(loans.length, 1);
    assert.equal(loans[0].principal, 500n * USDC);
    assert.equal(loans[0].openedAt, T0);
    assert.equal(loans[0].closedAt, T0 + 3 * DAY);
    assert.equal(loans[0].outcome, 0);
});

test("principal is the peak debt, not the total borrowed", () => {
    const loans = buildLoans([
        ev("borrow", 100n * USDC, T0),
        ev("repay", 50n * USDC, T0 + DAY),
        ev("borrow", 50n * USDC, T0 + 2 * DAY),
        ev("borrow", 30n * USDC, T0 + 3 * DAY),   // debt now 130
        ev("repay", 130n * USDC, T0 + 4 * DAY),
    ]);
    assert.equal(loans.length, 1);
    assert.equal(loans[0].principal, 130n * USDC); // total borrowed was 180
});

test("a partial repay keeps the loan open", () => {
    const loans = buildLoans([ev("borrow", 100n * USDC, T0), ev("repay", 40n * USDC, T0 + DAY)]);
    assert.equal(loans.length, 0);
});

test("liquidation closes the loan as liquidated", () => {
    const loans = buildLoans([ev("borrow", 1000n * USDC, T0), ev("liquidation", 300n * USDC, T0 + 5 * DAY)]);
    assert.equal(loans.length, 1);
    assert.equal(loans[0].outcome, 2);
    assert.equal(loans[0].closedAt, T0 + 5 * DAY);
    assert.equal(loans[0].principal, 1000n * USDC);
});

test("each full repay ends a cycle; the next borrow starts a new loan", () => {
    const loans = buildLoans([
        ev("borrow", 100n * USDC, T0),
        ev("repay", 100n * USDC, T0 + DAY),
        ev("borrow", 200n * USDC, T0 + 2 * DAY),
        ev("repay", 200n * USDC, T0 + 3 * DAY),
    ]);
    assert.deepEqual(loans.map((l) => l.principal), [100n * USDC, 200n * USDC]);
});

test("positions are tracked separately", () => {
    const loans = buildLoans([
        ev("borrow", 100n * USDC, T0, { position: "OBL1" }),
        ev("borrow", 50n * USDC, T0, { position: "OBL2" }),
        ev("repay", 50n * USDC, T0 + DAY, { position: "OBL2" }),
    ]);
    assert.equal(loans.length, 1);
    assert.equal(loans[0].position, "OBL2");
});

test("repay or liquidation with no open loan is ignored", () => {
    const loans = buildLoans([ev("repay", 100n * USDC, T0), ev("liquidation", 10n * USDC, T0 + DAY)]);
    assert.equal(loans.length, 0);
});

test("events are processed in time order", () => {
    const loans = buildLoans([ev("repay", 100n * USDC, T0 + DAY), ev("borrow", 100n * USDC, T0)]);
    assert.equal(loans.length, 1);
});

test("with a due date: on time before it, late after it", () => {
    const due = { protocol: "loopscale" as const, dueAt: T0 + 10 * DAY };
    const onTime = buildLoans([ev("borrow", 100n * USDC, T0, due), ev("repay", 101n * USDC, T0 + 9 * DAY, due)]);
    const late = buildLoans([ev("borrow", 100n * USDC, T0, due), ev("repay", 101n * USDC, T0 + 12 * DAY, due)]);
    assert.equal(onTime[0].outcome, 0);
    assert.equal(late[0].outcome, 1);
});
test("a loan remembers when its peak was and its open, peak and end transactions", () => {
    const loans = buildLoans([
        ev("borrow", 100n * USDC, T0, { signature: "OPEN" }),
        ev("borrow", 50n * USDC, T0 + DAY, { signature: "PEAK" }),      // debt 150 = peak
        ev("repay", 20n * USDC, T0 + 2 * DAY, { signature: "R1" }),
        ev("borrow", 10n * USDC, T0 + 3 * DAY, { signature: "B3" }),    // debt 140, not a new peak
        ev("repay", 140n * USDC, T0 + 4 * DAY, { signature: "END" }),
    ]);
    assert.equal(loans.length, 1);
    assert.equal(loans[0].principal, 150n * USDC);
    assert.equal(loans[0].peakAt, T0 + DAY);
    assert.equal(loans[0].openSignature, "OPEN");
    assert.equal(loans[0].peakSignature, "PEAK");
    assert.equal(loans[0].endSignature, "END");
});

test("a single borrow is both the open and the peak", () => {
    const loans = buildLoans([
        ev("borrow", 300n * USDC, T0, { signature: "B" }),
        ev("liquidation", 300n * USDC, T0 + DAY, { signature: "LIQ" }),
    ]);
    assert.equal(loans[0].peakAt, T0);
    assert.equal(loans[0].openSignature, "B");
    assert.equal(loans[0].peakSignature, "B");
    assert.equal(loans[0].endSignature, "LIQ");
});

test("loans repaid in the transaction that opened them are removed; liquidations are kept", () => {
    const flash = buildLoans([ev("borrow", 500n * USDC, T0, { signature: "f" }), ev("repay", 500n * USDC, T0, { signature: "f" })]);
    const real = buildLoans([ev("borrow", 500n * USDC, T0, { signature: "b", position: "P2" }), ev("repay", 500n * USDC, T0 + DAY, { signature: "r", position: "P2" })]);
    const liq = buildLoans([ev("borrow", 500n * USDC, T0, { signature: "x", position: "P3" }), ev("liquidation", 500n * USDC, T0, { signature: "x", position: "P3" })]);
    const { kept, sameTransaction } = withoutSameTransaction([...flash, ...real, ...liq]);
    assert.equal(sameTransaction, 1);
    assert.deepEqual(kept.map((l) => [l.position, l.outcome]), [["P2", 0], ["P3", 2]]);
});