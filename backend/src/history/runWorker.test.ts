import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runWorker, WorkerOutOfMemory, WorkerTimeout } from "./runWorker";

const FIXTURE = join(__dirname, "runWorker.fixture.ts");
const LIMITS = { heapMb: 32, timeoutMs: 20_000 };
const run = (mode: string, limits = LIMITS) => runWorker(FIXTURE, { mode }, limits);

test("runWorker: resolves with the worker's first message", async () => {
    assert.deepEqual(await run("answer"), { echo: { mode: "answer" } });
});

test("runWorker: a worker over its memory cap is WorkerOutOfMemory, and this thread keeps running", async () => {
    await assert.rejects(run("oom"), WorkerOutOfMemory);
    assert.deepEqual(await run("answer"), { echo: { mode: "answer" } });
});

test("runWorker: an error thrown in the worker comes back as itself", async () => {
    await assert.rejects(run("throw"), (err: Error) => !(err instanceof WorkerOutOfMemory) && err.message === "fixture failed");
});

test("runWorker: a worker that does not answer in time is terminated as WorkerTimeout", async () => {
    const started = Date.now();
    await assert.rejects(run("hang", { ...LIMITS, timeoutMs: 300 }), WorkerTimeout);
    assert.ok(Date.now() - started < 10_000);
});

test("runWorker: a worker that exits without answering is an error", async () => {
    await assert.rejects(run("exit"), /exited with code 3/);
});