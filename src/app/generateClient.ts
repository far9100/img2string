// The page's side of the generate worker (after img2shadow's designClient): one run at a time. While a run
// goes on, the client rebuilds the sequences from the progress messages, so a run can always be stopped with
// what it has: if the worker does not answer a stop within a second it is replaced, and the run ends with the
// lines the page already holds.
import type { StopReason } from "../core/project.ts";
import type { Options } from "../core/stringart.ts";
import type { FromGen, ToGen } from "../workers/protocol.ts";

export interface Progress {
  lines: number[];
  error: number;
  initialError: number;
  rgba: Uint8ClampedArray | null;
  /** (thread, pin) pairs added since the last progress, for animating the new lines. */
  tail: Int32Array;
}

export interface Finished {
  reason: StopReason;
  sequences: number[][];
  error: number;
  initialError: number;
  /** Missing when the worker had to be replaced: the caller replays the sequences to get them. */
  deltaE: [number, number] | null;
  rgba: Uint8ClampedArray | null;
  unstarted: number[];
  budgetBlocked: number[];
  ms: number;
}

/** How long a stop may go unanswered before the worker is replaced (ms). */
export const STOP_GRACE = 1000;

export interface GenWorker {
  postMessage(msg: ToGen, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<FromGen>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
  terminate(): void;
}

export class GenerateError extends Error {
  code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export interface GenerateClient {
  start(options: Options, target: Float64Array, weight: Float64Array, resume: number[][] | null, onProgress?: (p: Progress) => void): Promise<Finished>;
  /** Ends the running start(); its promise resolves with reason "stopped". */
  stop(): void;
  running(): boolean;
}

export function createGenerateClient(factory: () => GenWorker, grace = STOP_GRACE): GenerateClient {
  let worker: GenWorker | null = null;
  let nextId = 1;
  let job: {
    id: number; sequences: number[][]; error: number; initialError: number; started: number; onProgress?: (p: Progress) => void;
    resolve: (f: Finished) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> | null;
  } | null = null;

  const finish = (f: Finished) => {
    const j = job;
    if (!j) return;
    if (j.timer) clearTimeout(j.timer);
    job = null;
    j.resolve(f);
  };

  const boot = (): GenWorker => {
    const w = factory();
    w.onmessage = (e) => {
      const m = e.data;
      if (!job || m.id !== job.id) return; // an answer for a run that is over
      if (m.t === "progress") {
        for (let i = 0; i < m.tail.length; i += 2) job.sequences[m.tail[i]!]!.push(m.tail[i + 1]!);
        job.error = m.error;
        job.initialError = m.initialError;
        job.onProgress?.({ lines: m.lines, error: m.error, initialError: m.initialError, rgba: m.rgba, tail: m.tail });
      } else if (m.t === "done") {
        finish({ reason: m.reason, sequences: m.sequences, error: m.error, initialError: m.initialError, deltaE: m.deltaE, rgba: m.rgba, unstarted: m.unstarted, budgetBlocked: m.budgetBlocked, ms: m.ms });
      } else if (m.t === "error") {
        const j = job;
        if (j.timer) clearTimeout(j.timer);
        job = null;
        j.reject(new GenerateError(m.code, m.detail));
      }
    };
    w.onerror = (e) => {
      const j = job;
      if (!j) return;
      if (j.timer) clearTimeout(j.timer);
      job = null;
      worker?.terminate();
      worker = null;
      j.reject(new GenerateError("worker", e.message));
    };
    return w;
  };

  return {
    start(options, target, weight, resume, onProgress) {
      if (job) return Promise.reject(new GenerateError("busy"));
      worker ??= boot();
      const id = nextId++;
      return new Promise<Finished>((resolve, reject) => {
        job = {
          id, sequences: resume ? resume.map((s) => s.slice()) : options.threads.map(() => []), error: 0, initialError: 0, started: Date.now(),
          onProgress, resolve, reject, timer: null,
        };
        // copies go to the worker: the page keeps the target for the next run and for the measurements
        const t = target.slice(), w = weight.slice();
        worker!.postMessage({ t: "start", id, options, target: t, weight: w, resume, preview: true }, [t.buffer, w.buffer]);
      });
    },
    stop() {
      const j = job;
      if (!j || j.timer || !worker) return;
      worker.postMessage({ t: "stop", id: j.id });
      j.timer = setTimeout(() => {
        // the worker is stuck: replace it and end the run with the lines reported so far (a trailing first pin
        // without a line is dropped, so every sequence is empty or has at least one line)
        worker?.terminate();
        worker = null;
        const sequences = j.sequences.map((s) => (s.length === 1 ? [] : s));
        finish({ reason: "stopped", sequences, error: j.error, initialError: j.initialError, deltaE: null, rgba: null, unstarted: [], budgetBlocked: [], ms: Date.now() - j.started });
      }, grace);
    },
    running: () => job !== null,
  };
}

/** The real worker. */
export const generateWorker = (): GenWorker => new Worker(new URL("../workers/generate.worker.ts", import.meta.url), { type: "module", name: "generate" }) as unknown as GenWorker;
