import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedHistory } from "./index";
import type { History, TransactionList } from "../../heliusClient";

type Tx = TransactionList[number];

/** A reader that serves one empty history per address and records each call. */
function reader(cappedAddresses: string[]) {
    const calls: string[] = [];
    const read = async (address: string): Promise<History<Tx>> => {
        calls.push(address);
        return { transactions: [], capped: cappedAddresses.includes(address) };
    };
    return { read, calls };
}

test("cachedHistory reads each address once", async () => {
    const { read, calls } = reader([]);
    const { history, capped } = cachedHistory(read);
    await Promise.all([history("wallet"), history("wallet"), history("position")]);
    await history("wallet");
    assert.deepEqual(calls, ["wallet", "position"]);
    assert.equal(capped(), false);
});

test("cachedHistory is capped when any address read was capped", async () => {
    const { read } = reader(["position"]);
    const { history, capped } = cachedHistory(read);
    await history("wallet");
    assert.equal(capped(), false);
    await history("position");
    assert.equal(capped(), true);
    await history("other");
    assert.equal(capped(), true);
});