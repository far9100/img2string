// A small pool of generate workers for the winding-order search (spec §6.3): every job is one whole run that
// answers with its error only. After img2fold's searchPool: the worker factory is injected, so the pool is
// tested in Node with fake workers; stopping terminates the busy workers, because a score-only run does not
// listen for messages (and SharedArrayBuffer is not available on GitHub Pages, DECISIONS D-18).
import type { Options } from "../core/stringart.ts";
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

/** Workers to use on a machine with this many cores: one core stays free for the page; four at most. */
export const defaultPoolSize = (cores: number): number => Math.min(4, Math.max(1, (cores || 2) - 1));

export class ScorePool {
  private readonly factory: () => GenWorker;
  private readonly size: number;
  private workers: (GenWorker | null)[] = [];
  private runId = 0;
  private settle: ((scores: (Score | null)[]) => void) | null = null;
  private scores: (Score | null)[] = [];

  constructor(factory: () => GenWorker, size: number) {
    this.factory = factory;
    this.size = Math.max(1, size);
  }

  /** Runs every job and resolves with their scores in order (null for a job that failed or was stopped). */
  run(jobs: readonly ScoreJob[], onScore?: (index: number, score: Score | null, done: number) => void): Promise<(Score | null)[]> {
    if (this.settle) this.stop(); // a run still going is abandoned; idle workers are kept for this one
    const run = ++this.runId;
    const scores: (Score | null)[] = jobs.map(() => null);
    this.scores = scores;
    let next = 0, done = 0;
    return new Promise((resolve) => {
      this.settle = resolve;
      if (!jobs.length) { this.settle = null; resolve(scores); return; }
      const feed = (slot: number) => {
        if (run !== this.runId) return;
        if (next >= jobs.length) return;
        const index = next++, job = jobs[index]!;
        const worker = (this.workers[slot] ??= this.factory());
        const finish = (score: Score | null) => {
          if (run !== this.runId) return;
          scores[index] = score;
          done++;
          onScore?.(index, score, done);
          if (done === jobs.length) { this.settle = null; resolve(scores); }
          else feed(slot);
        };
        worker.onmessage = (e) => {
          const m = e.data;
          if (m.id !== index) return;
          if (m.t === "scored") finish({ error: m.error, initialError: m.initialError, lines: m.lines, ms: m.ms });
          else if (m.t === "error") finish(null);
        };
        worker.onerror = () => {
          worker.terminate();
          this.workers[slot] = null;
          finish(null);
        };
        const t = job.target.slice(), w = job.weight.slice();
        worker.postMessage({ t: "score", id: index, options: job.options, target: t, weight: w }, [t.buffer, w.buffer]);
      };
      for (let slot = 0; slot < Math.min(this.size, jobs.length); slot++) feed(slot);
    });
  }

  /** Ends the current run: its promise resolves with what was scored so far. */
  stop(): void {
    this.runId++;
    for (const w of this.workers) w?.terminate();
    this.workers = [];
    const settle = this.settle;
    this.settle = null;
    settle?.(this.scores);
  }
}
