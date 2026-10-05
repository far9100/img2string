// The winding player's logic (spec §7.4), without any DOM: the sequences of a result laid out as one list of
// lines in winding order, and what to show at a given position. A position is the number of lines already
// wound: 0 before the first line, plan.steps.length when the piece is finished. What the user sees and types
// is a step of a thread, numbered as on the printed instructions (DECISIONS D-35).
import { clockHint } from "../core/instructions.ts";

export interface Step {
  thread: number;
  /** The number of this line within its thread, from 1. */
  line: number;
  from: number;
  to: number;
}

export interface Plan {
  pins: number;
  steps: Step[];
  /** For every thread: where its steps begin in `steps`, and how many lines it has. */
  threads: { start: number; lines: number }[];
}

/** All threads' lines in winding order: thread 0 completely, then thread 1, and so on (§2 "Layer"). */
export function buildPlan(sequences: readonly (readonly number[])[], pins: number): Plan {
  const steps: Step[] = [], threads: Plan["threads"] = [];
  sequences.forEach((s, k) => {
    threads.push({ start: steps.length, lines: Math.max(0, s.length - 1) });
    for (let i = 1; i < s.length; i++) steps.push({ thread: k, line: i, from: s[i - 1]!, to: s[i]! });
  });
  return { pins, steps, threads };
}

export const clampPosition = (plan: Plan, position: number): number => Math.max(0, Math.min(plan.steps.length, Math.round(Number.isFinite(position) ? position : 0)));

export interface View {
  position: number;
  total: number;
  done: boolean;
  /** The line to wind now; null when the piece is finished. Pins are 1-based here, as the user sees them. */
  thread: number;
  threadLine: number;
  threadLines: number;
  /** Where `nextPin` stands in its thread's sequence, counted as the printed instructions count: the pin the
   * thread is tied to is step 1, so the pin reached by line n is step n + 1 (DECISIONS D-35). */
  step: number;
  /** Steps of this thread: its lines + 1. */
  steps: number;
  /** True at the first line of a thread: the thread is tied on at `fromPin` before going to `nextPin` (and,
   * from the second thread on, the previous thread is cut and tied off first). */
  tieOn: boolean;
  fromPin: number;
  nextPin: number;
  nextClock: string;
  /** The pin after the next one, 0 when there is none in this thread. */
  thenPin: number;
  remainingLines: number;
}

/** What the player shows at a position. At the end (`done`), the pin fields describe the last line wound. */
export function viewAt(plan: Plan, position: number): View {
  const total = plan.steps.length, p = clampPosition(plan, position), done = p >= total;
  const step = plan.steps[Math.min(p, total - 1)];
  if (!step) return { position: 0, total: 0, done: true, thread: 0, threadLine: 0, threadLines: 0, step: 0, steps: 0, tieOn: false, fromPin: 0, nextPin: 0, nextClock: "", thenPin: 0, remainingLines: 0 };
  const after = plan.steps[p + 1];
  return {
    position: p,
    total,
    done,
    thread: step.thread,
    threadLine: step.line,
    threadLines: plan.threads[step.thread]!.lines,
    step: step.line + 1,
    steps: plan.threads[step.thread]!.lines + 1,
    tieOn: !done && step.line === 1,
    fromPin: step.from + 1,
    nextPin: step.to + 1,
    nextClock: clockHint(step.to, plan.pins),
    thenPin: !done && after && after.thread === step.thread ? after.to + 1 : 0,
    remainingLines: total - p,
  };
}

/**
 * The position at which the player shows a step of a thread, steps being counted as on the printed
 * instructions (step 1 is the pin the thread is tied to). Steps 1 and 2 are the same position: the thread is
 * tied on at step 1's pin and the first line goes to step 2's.
 */
export function positionOfStep(plan: Plan, thread: number, step: number): number {
  const th = plan.threads[Math.max(0, Math.min(plan.threads.length - 1, Math.round(thread)))];
  if (!th) return 0;
  const s = Number.isFinite(step) ? Math.round(step) : 1;
  return th.start + Math.max(0, Math.min(th.lines - 1, s - 2));
}

/**
 * The thread and the step (counted as on the printed instructions) that a position shows, from the threads'
 * line counts alone: what viewAt reports as thread, step and steps, without building the plan.
 */
export function stepAt(lines: readonly number[], position: number): { thread: number; step: number; steps: number; done: boolean } {
  const total = lines.reduce((a, n) => a + Math.max(0, n), 0);
  const p = Math.max(0, Math.min(total, Math.round(Number.isFinite(position) ? position : 0)));
  let start = 0, last = -1;
  for (let k = 0; k < lines.length; k++) {
    const n = Math.max(0, lines[k]!);
    if (n > 0) {
      last = k;
      if (p < start + n) return { thread: k, step: p - start + 2, steps: n + 1, done: false };
    }
    start += n;
  }
  return last < 0 ? { thread: 0, step: 0, steps: 0, done: true } : { thread: last, step: lines[last]! + 1, steps: lines[last]! + 1, done: true };
}

/** The nearest thread before (-1) or after (+1) `thread` that has lines, or -1 when there is none. */
export function neighbourThread(plan: Plan, thread: number, by: -1 | 1): number {
  for (let k = thread + by; k >= 0 && k < plan.threads.length; k += by) if (plan.threads[k]!.lines > 0) return k;
  return -1;
}

/** Seconds of winding left at a position. */
export const remainingSeconds = (plan: Plan, position: number, secondsPerLine: number): number => (plan.steps.length - clampPosition(plan, position)) * secondsPerLine;

/** "2 h 05 min" style parts of a duration. */
export function hoursMinutes(seconds: number): { h: number; min: number } {
  const m = Math.round(seconds / 60);
  return { h: Math.floor(m / 60), min: m % 60 };
}

/** A short key of a piece (pin count and sequences only) for remembering the position (§7.4): two FNV-1a
 * hashes, so it needs neither crypto.subtle nor a promise. */
export function planKey(sequences: readonly (readonly number[])[], pins: number): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ pins;
  const eat = (v: number) => {
    a = Math.imul(a ^ (v & 0xff), 0x01000193);
    a = Math.imul(a ^ (v >>> 8), 0x01000193);
    b = Math.imul(b ^ (v + 0x9e3779b9), 0x85ebca6b);
    b ^= b >>> 13;
  };
  eat(pins);
  for (const s of sequences) {
    eat(0xffff);
    for (const v of s) eat(v);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

export const progressStorageKey = (key: string): string => `img2string.progress.${key}`;
