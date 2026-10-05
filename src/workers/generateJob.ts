// What the generate worker does, without the worker: the message handler takes the two things a worker gives
// it (a way to post, a way to let queued messages in), so Node tests drive it with a fake port.
// A run posts progress every 100 lines (§5.2) with the lines added since the last message, yields regularly so
// a stop can arrive, and always ends with one "done" message that carries the complete sequences.
import { GreedyRun } from "../core/greedy.ts";
import { toRgba8 } from "../core/image.ts";
import { meanDeltaE, meanDeltaEFlat } from "../core/metrics.ts";
import { circleMask, generate } from "../core/stringart.ts";
import type { FromGen, ToGen } from "./protocol.ts";

export interface JobPort {
  post(msg: FromGen, transfer?: Transferable[]): void;
  /** Resolves after the messages already queued for the worker have been handled. */
  pause(): Promise<void>;
  now(): number;
}

/** Lines between two progress messages (§5.2). */
export const PROGRESS_EVERY = 100;
/** How long the run computes before it lets queued messages in (ms). */
export const BREATH_MS = 25;

export function createGenerateJob(port: JobPort): (msg: ToGen) => void {
  /** The run in progress: a stop request or a newer start ends it after the current line. */
  let active: { id: number; stop: boolean } | null = null;

  async function start(msg: Extract<ToGen, { t: "start" }>): Promise<void> {
    const mine = { id: msg.id, stop: false };
    if (active) active.stop = true; // a newer start replaces the older run
    active = mine;
    const t0 = port.now();
    try {
      const run = new GreedyRun(msg.options, msg.target, msg.weight, msg.resume);
      const res = msg.options.res, mask = circleMask(res);
      const sent = run.seq.map((s) => s.length); // what the page already has (the resumed part)
      const tail = (): Int32Array => {
        const pairs: number[] = [];
        run.seq.forEach((s, k) => {
          for (let i = sent[k]!; i < s.length; i++) pairs.push(k, s[i]!);
          sent[k] = s.length;
        });
        return Int32Array.from(pairs);
      };
      const lineCounts = () => run.seq.map((s) => Math.max(0, s.length - 1));
      let posted = run.lines, breath = port.now(), more = true;
      while (more && !mine.stop) {
        more = run.step();
        if (run.lines - posted >= PROGRESS_EVERY) {
          posted = run.lines;
          const rgba = msg.preview ? toRgba8(run.model.C, res * res) : null;
          const pairs = tail();
          port.post({ t: "progress", id: msg.id, lines: lineCounts(), error: run.error(), initialError: run.initialError, tail: pairs, rgba }, rgba ? [pairs.buffer, rgba.buffer] : [pairs.buffer]);
        }
        if (port.now() - breath > BREATH_MS) {
          await port.pause();
          breath = port.now();
        }
      }
      const outcome = run.outcome();
      const rgba = toRgba8(run.model.C, res * res);
      port.post(
        {
          t: "done", id: msg.id, reason: more ? "stopped" : outcome.reason, sequences: run.seq.map((s) => s.slice()),
          error: run.error(), initialError: run.initialError,
          deltaE: [meanDeltaEFlat(msg.options.board, msg.target, mask), meanDeltaE(run.model.C, msg.target, mask)],
          unstarted: outcome.unstarted, budgetBlocked: outcome.budgetBlocked, ms: port.now() - t0, rgba,
        },
        [rgba.buffer],
      );
    } catch (err) {
      port.post({ t: "error", id: msg.id, code: err instanceof RangeError ? "settings" : "internal", detail: err instanceof Error ? err.message : String(err) });
    } finally {
      if (active === mine) active = null;
    }
  }

  function score(msg: Extract<ToGen, { t: "score" }>): void {
    const t0 = port.now();
    try {
      const run = new GreedyRun(msg.options, msg.target, msg.weight);
      while (run.step()) { /* to the end */ }
      port.post({ t: "scored", id: msg.id, error: run.error(), initialError: run.initialError, lines: run.seq.map((s) => Math.max(0, s.length - 1)), ms: port.now() - t0 });
    } catch (err) {
      port.post({ t: "error", id: msg.id, code: err instanceof RangeError ? "settings" : "internal", detail: err instanceof Error ? err.message : String(err) });
    }
  }

  function reference(msg: Extract<ToGen, { t: "reference" }>): void {
    const t0 = port.now();
    try {
      const result = generate(msg.options, msg.target, msg.weight);
      port.post({ t: "reference", id: msg.id, sequences: result.sequences, ms: port.now() - t0 });
    } catch (err) {
      port.post({ t: "error", id: msg.id, code: "internal", detail: err instanceof Error ? err.message : String(err) });
    }
  }

  return (msg) => {
    if (msg.t === "start") void start(msg);
    else if (msg.t === "score") score(msg);
    else if (msg.t === "reference") reference(msg);
    else if (active) active.stop = true; // "stop": the run answers with its "done"
  };
}
