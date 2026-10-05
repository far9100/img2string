// A small pool of generate workers for the winding-order search (spec §6.3) and the automatic adjustment
// (DECISIONS D-55): every job is one whole run that answers with a number only. After img2fold's searchPool:
// the worker factory is injected, so the pool is tested in Node with fake workers; stopping terminates the busy
// workers, because such a run does not listen for messages (and SharedArrayBuffer is not available on GitHub
// Pages, DECISIONS D-18).
import type { TuneInput } from "../core/autoAdjust.ts";
import type { Options } from "../core/stringart.ts";
import type { FromGen } from "../workers/protocol.ts";
import type { GenWorker } from "./generateClient.ts";

export interface ScoreJob {
  options: Options;
  target: Float64Array;
  weight: Float64Array;
}

export interface Score {
  error: number;
  initialError: number;
  lines: number[];
  ms: number;
}

/** What a tune job answers: how close the piece at true thread width is to the picture. */
export interface Tune {
  similarity: number;
  lines: number[];
  ms: number;
}

/** Workers to use on a machine with this many cores: one core stays free for the page; four at most. */
export const defaultPoolSize = (cores: number): number => Math.min(4, Math.max(1, (cores || 2) - 1));

export class ScorePool {
  private readonly factory: () => GenWorker;
  private readonly size: number;
  private workers: (GenWorker | null)[] = [];
  private runId = 0;
  private settle: (() => void) | null = null;

  constructor(factory: () => GenWorker, size: number) {
    this.factory = factory;
    this.size = Math.max(1, size);
  }

  /** Runs every job and resolves with their scores in order (null for a job that failed or was stopped). */
  run(jobs: readonly ScoreJob[], onScore?: (index: number, score: Score | null, done: number) => void): Promise<(Score | null)[]> {
    return this.dispatch(
      jobs,
      (worker, id, job) => {
        const t = job.target.slice(), w = job.weight.slice();
        worker.postMessage({ t: "score", id, options: job.options, target: t, weight: w }, [t.buffer, w.buffer]);
      },
      (m) => (m.t === "scored" ? { error: m.error, initialError: m.initialError, lines: m.lines, ms: m.ms } : undefined),
      onScore,
    );
  }

  /** The same for settings of the automatic adjustment: each job makes its own target and is scored by similarity. */
  tune(jobs: readonly TuneInput[], onTuned?: (index: number, tuned: Tune | null, done: number) => void): Promise<(Tune | null)[]> {
    return this.dispatch(
      jobs,
      (worker, id, job) => {
        const picture = job.picture.slice(), painted = job.painted.slice();
        worker.postMessage({ t: "tune", id, options: job.options, mode: job.mode, picture, painted, invert: job.invert, tuning: job.tuning }, [picture.buffer, painted.buffer]);
      },
      (m) => (m.t === "tuned" ? { similarity: m.similarity, lines: m.lines, ms: m.ms } : undefined),
      onTuned,
    );
  }

  /** One job per free worker until all are answered. `read` picks the answer out of a worker's message. */
  private dispatch<J, R>(
    jobs: readonly J[], post: (worker: GenWorker, id: number, job: J) => void, read: (m: FromGen) => R | undefined,
    onDone?: (index: number, result: R | null, done: number) => void,
  ): Promise<(R | null)[]> {
    if (this.settle) this.stop(); // a run still going is abandoned; idle workers are kept for this one
    const run = ++this.runId;
    const results: (R | null)[] = jobs.map(() => null);
    let next = 0, done = 0;
    return new Promise((resolve) => {
      this.settle = () => resolve(results);
      if (!jobs.length) { this.settle = null; resolve(results); return; }
      const feed = (slot: number) => {
        if (run !== this.runId) return;
        if (next >= jobs.length) return;
        const index = next++, job = jobs[index]!;
        const worker = (this.workers[slot] ??= this.factory());
        const finish = (result: R | null) => {
          if (run !== this.runId) return;
          results[index] = result;
          done++;
          onDone?.(index, result, done);
          if (done === jobs.length) { this.settle = null; resolve(results); }
          else feed(slot);
        };
        worker.onmessage = (e) => {
          const m = e.data;
          if (m.id !== index) return;
          const result = read(m);
          if (result !== undefined) finish(result);
          else if (m.t === "error") finish(null);
        };
        worker.onerror = () => {
          worker.terminate();
          this.workers[slot] = null;
          finish(null);
        };
        post(worker, index, job);
      };
      for (let slot = 0; slot < Math.min(this.size, jobs.length); slot++) feed(slot);
    });
  }

  /** Whether a run is going. */
  busy(): boolean {
    return this.settle !== null;
  }

  /** Ends the current run: its promise resolves with what was answered so far. */
  stop(): void {
    this.runId++;
    for (const w of this.workers) w?.terminate();
    this.workers = [];
    const settle = this.settle;
    this.settle = null;
    settle?.();
  }
}
