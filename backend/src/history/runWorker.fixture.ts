//! A worker for the runWorker tests: answers, runs out of memory, throws, hangs or exits, as workerData asks.

import { parentPort, workerData } from "node:worker_threads";

const { mode } = workerData as { mode: "answer" | "oom" | "throw" | "hang" | "exit" };
const kept: number[][] = [];

if (mode === "answer") parentPort!.postMessage({ echo: workerData });
if (mode === "oom") for (;;) kept.push(new Array(1_000_000).fill(1));
if (mode === "throw") throw new Error("fixture failed");
if (mode === "hang") setInterval(() => {}, 1_000);
if (mode === "exit") process.exit(3);