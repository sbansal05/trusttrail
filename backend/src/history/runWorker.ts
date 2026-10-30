//! Runs a TypeScript file in a worker thread with a memory cap and a time limit, so a job that runs out of memory
//! or hangs stops only its own thread.

import { Worker } from "node:worker_threads";

export class WorkerOutOfMemory extends Error {}
export class WorkerTimeout extends Error {}

export type WorkerLimits = { heapMb: number; timeoutMs: number };

/** tsx loads TypeScript only in the thread it started; the worker registers it itself, then loads `file`. */
const TSX = require.resolve("tsx/cjs");
const bootstrap = (file: string) => `require(${JSON.stringify(TSX)}); require(${JSON.stringify(file)});`;

/** Starts `file` with `data` as workerData and resolves with the first message it posts. */
export function runWorker<T>(file: string, data: unknown, limits: WorkerLimits): Promise<T> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(bootstrap(file), {
            eval: true,
            workerData: data,
            resourceLimits: { maxOldGenerationSizeMb: limits.heapMb },
        });
        let settled = false;
        const finish = (settle: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            settle();
            void worker.terminate();
        };
        const timer = setTimeout(
            () => finish(() => reject(new WorkerTimeout(`worker did not answer within ${limits.timeoutMs} ms`))),
            limits.timeoutMs,
        );
        worker.once("message", (message: T) => finish(() => resolve(message)));
        worker.once("error", (err: NodeJS.ErrnoException) =>
            finish(() => reject(err.code === "ERR_WORKER_OUT_OF_MEMORY" ? new WorkerOutOfMemory(err.message) : err)),
        );
        worker.once("exit", (code) => finish(() => reject(new Error(`worker exited with code ${code} without an answer`))));
    });
}