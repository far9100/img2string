// Loaded only when the address has ?test: the end-to-end tests read the page's state through the controller
// and run the two benchmarks of §13.1 in the real generate worker (§13.4: "time no more than twice the
// reference in a current desktop browser").
import { BENCHMARK_EXPECTED, benchmark, type BenchmarkId } from "../core/benchmarks.ts";
import type { FromGen } from "../workers/protocol.ts";
import type { Controller } from "./controller.ts";
import { createGenerateClient, generateWorker } from "./generateClient.ts";
import { sha256 } from "./imageClient.ts";

const hash = (sequences: number[][]) => sha256(new TextEncoder().encode(JSON.stringify(sequences)).buffer as ArrayBuffer);

export interface BenchResult {
  id: BenchmarkId;
  /** Time inside the worker, in ms: the app's generator, and the specification's generate(). */
  appMs: number;
  referenceMs: number;
  appSha: string;
  referenceSha: string;
  expectedSha: string;
  lines: number[];
}

async function bench(id: BenchmarkId): Promise<BenchResult> {
  const b = benchmark(id);
  const done = await createGenerateClient(generateWorker).start(b.options, b.target, b.weight, null);
  const worker = generateWorker();
  const reference = await new Promise<Extract<FromGen, { t: "reference" }>>((resolve, reject) => {
    worker.onmessage = (e) => {
      if (e.data.t === "reference") resolve(e.data);
      else if (e.data.t === "error") reject(new Error(e.data.detail));
    };
    worker.onerror = (e) => reject(new Error(e.message));
    worker.postMessage({ t: "reference", id: 1, options: b.options, target: b.target, weight: b.weight });
  });
  worker.terminate();
  return {
    id, appMs: done.ms, referenceMs: reference.ms, appSha: await hash(done.sequences), referenceSha: await hash(reference.sequences),
    expectedSha: BENCHMARK_EXPECTED[id].sequencesSha256, lines: done.sequences.map((s) => Math.max(0, s.length - 1)),
  };
}

export function installTestHooks(ctl: Controller): void {
  const hooks = { ctl, state: () => ctl.state, bench };
  (window as unknown as { __i2s: typeof hooks }).__i2s = hooks;
}

export type TestHooks = { ctl: Controller; state: () => Controller["state"]; bench: typeof bench };
