// The greedy generator of spec §5.1 as a stepper: the same choices as generate() in stringart.ts, one line at
// a time, so a worker can report progress, stop, and continue later from the sequences alone.
//
// Two accelerations, both exact (the sequences equal generate()'s, which the tests assert):
//  - scoring is "fused": a candidate line is rasterised and its gain summed in one loop, with the arithmetic
//    and the order of rasterLine() + Model.gain(), so nothing is allocated per candidate;
//  - with several threads, a thread keeps the gains of its candidates and re-scores only those whose chord can
//    share a pixel with the line just drawn (DECISIONS D-26).
// One addition to §5.1, "late start" (DECISIONS D-04): a thread whose first-line search found nothing is
// searched again when the run would otherwise stop. When every thread starts at once (both benchmarks), the
// run is identical to generate().
//
// The pins and the pairs a thread may join come from frame.ts: stringart.ts's circle and its minimum skip for a
// round frame (so nothing here changes for one), and their like for a rectangular frame (DECISIONS D-58).
import { allowedPairs, framePins, type FrameOptions } from "./frame.ts";
import { coverageAlpha, Model, rasterLine } from "./stringart.ts";

export interface Outcome {
  /** Why the run ended: nothing lowers the error any more, a budget ran out while lines would still help, or
   * no line was ever worth drawing. */
  reason: "converged" | "budget" | "empty";
  /** Threads that never found a first line. */
  unstarted: number[];
  /** Threads whose budget is spent although a line from their current pin would still lower the error. */
  budgetBlocked: number[];
}

export interface Extras {
  /** How often one thread may use the same pin pair when o.allowRepeat is true (§13.5: up to 3). Without it,
   * allowRepeat means "no limit", as in the reference. */
  maxRepeat?: number;
}

/** Two rasters can share a pixel only if the segments come within 2*sqrt(2) px of each other: a raster pixel
 * lies less than sqrt(2) px from its own segment. */
const TOUCH = 3;

export class GreedyRun {
  readonly o: FrameOptions;
  readonly model: Model;
  /** One pin sequence per thread, growing as lines are added. */
  readonly seq: number[][];
  readonly initialError: number;
  lines = 0;

  private readonly N: number;
  private readonly K: number;
  private readonly res: number;
  private readonly alpha: number;
  private readonly P: Float64Array;
  /** 1 at [u * N + v] where a thread may go from pin u to pin v. */
  private readonly ok: Uint8Array;
  private readonly limit: number;
  private readonly cur: Int32Array;
  private readonly used: Uint8Array[];
  private readonly gains: Float64Array[];
  private readonly valid: Uint8Array[];
  private started = false;
  private finished = false;

  constructor(o: FrameOptions, target: Float64Array, weight: Float64Array, resume?: readonly (readonly number[])[] | null, extras: Extras = {}) {
    const N = o.pins, K = o.threads.length;
    if (o.maxLines.length !== K) throw new RangeError("one budget per thread");
    // a budget of 0 makes the reference draw a line that is not in its sequence (DECISIONS D-03)
    for (const m of o.maxLines) if (!(m >= 1)) throw new RangeError("every budget must be at least 1");
    if (N < 2 * o.minSkip + 1) throw new RangeError("too few pins for this minimum skip");
    this.o = o;
    this.N = N;
    this.K = K;
    this.res = o.res;
    this.alpha = coverageAlpha(o);
    this.P = framePins(o);
    this.ok = allowedPairs(o);
    this.limit = o.allowRepeat ? Math.min(255, extras.maxRepeat ?? 255) : 1;
    this.model = new Model(o, target, weight);
    this.initialError = this.model.error();
    this.seq = o.threads.map(() => []);
    this.cur = new Int32Array(K).fill(-1);
    this.used = o.threads.map(() => new Uint8Array(N * N));
    this.gains = o.threads.map(() => new Float64Array(N));
    this.valid = o.threads.map(() => new Uint8Array(N));
    if (resume && resume.some((s) => s.length > 0)) this.replay(resume);
  }

  /** Winds stored sequences into the fresh model: the state is then exactly what the original run had. */
  private replay(sequences: readonly (readonly number[])[]): void {
    if (sequences.length !== this.K) throw new RangeError("one sequence per thread");
    sequences.forEach((s, k) => {
      if (s.length === 1) throw new RangeError("a sequence is empty or has at least one line");
      for (let i = 0; i < s.length; i++) {
        const v = s[i]!;
        if (!Number.isInteger(v) || v < 0 || v >= this.N) throw new RangeError("pin out of range");
        if (i === 0) this.seq[k]!.push(v);
        else this.draw(k, s[i - 1]!, v);
      }
      this.cur[k] = s.length ? s[s.length - 1]! : -1;
    });
    this.started = true;
    for (const v of this.valid) v.fill(0);
  }

  private key(u: number, v: number): number {
    return u < v ? u * this.N + v : v * this.N + u;
  }

  /** Exactly Model.gain(k, rasterLine(...)) for the line between pins u and v, without building the raster. */
  private score(k: number, u: number, v: number): number {
    const P = this.P, res = this.res, m = this.model;
    const x0 = P[2 * u]!, y0 = P[2 * u + 1]!, x1 = P[2 * v]!, y1 = P[2 * v + 1]!;
    const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
    let a0 = steep ? y0 : x0, a1 = steep ? y1 : x1, b0 = steep ? x0 : y0, b1 = steep ? x1 : y1;
    if (a1 < a0) { let t = a0; a0 = a1; a1 = t; t = b0; b0 = b1; b1 = t; }
    const slope = a1 === a0 ? 0 : (b1 - b0) / (a1 - a0);
    const per = this.alpha * Math.sqrt(1 + slope * slope);
    const end = Math.floor(a1);
    const ak = m.a[k]!, Uk = m.U[k]!, Bk = m.below[k]!, c = m.o.threads[k]!, C = m.C, T = m.T, Wt = m.Wt;
    const c0 = c[0], c1 = c[1], c2 = c[2];
    let g = 0;
    for (let a = Math.ceil(a0); a <= end; a++) {
      const b = b0 + slope * (a - a0), bf = Math.floor(b), f = b - bf;
      if (1 - f > 0 && bf >= 0 && bf < res) {
        const p = steep ? a * res + bf : bf * res + a, wt = Wt[p]!;
        if (wt !== 0) {
          const s = per * (1 - f) * (1 - ak[p]!) * Uk[p]!, q = 3 * p;
          const d0 = s * (c0 - Bk[q]!), d1 = s * (c1 - Bk[q + 1]!), d2 = s * (c2 - Bk[q + 2]!);
          g -= wt * (2 * ((C[q]! - T[q]!) * d0 + (C[q + 1]! - T[q + 1]!) * d1 + (C[q + 2]! - T[q + 2]!) * d2) + d0 * d0 + d1 * d1 + d2 * d2);
        }
      }
      if (f > 0 && bf + 1 >= 0 && bf + 1 < res) {
        const p = steep ? a * res + bf + 1 : (bf + 1) * res + a, wt = Wt[p]!;
        if (wt !== 0) {
          const s = per * f * (1 - ak[p]!) * Uk[p]!, q = 3 * p;
          const d0 = s * (c0 - Bk[q]!), d1 = s * (c1 - Bk[q + 1]!), d2 = s * (c2 - Bk[q + 2]!);
          g -= wt * (2 * ((C[q]! - T[q]!) * d0 + (C[q + 1]! - T[q + 1]!) * d1 + (C[q + 2]! - T[q + 2]!) * d2) + d0 * d0 + d1 * d1 + d2 * d2);
        }
      }
    }
    return g;
  }

  /** Distance from pin w to the segment between pins u and v, in pixels. */
  private distance(w: number, u: number, v: number): number {
    const P = this.P, px = P[2 * w]!, py = P[2 * w + 1]!, ax = P[2 * u]!, ay = P[2 * u + 1]!, dx = P[2 * v]! - ax, dy = P[2 * v + 1]! - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }

  /** Adds the line u -> v to thread k and forgets every cached gain it may have changed. */
  private draw(k: number, u: number, v: number): void {
    const P = this.P, N = this.N;
    this.model.apply(k, rasterLine(this.res, this.alpha, P[2 * u]!, P[2 * u + 1]!, P[2 * v]!, P[2 * v + 1]!));
    this.seq[k]!.push(v);
    this.used[k]![this.key(u, v)]!++;
    this.cur[k] = v;
    this.lines++;
    this.valid[k]!.fill(0); // this thread moved: all its candidates are new
    // The other threads keep their current pins. A candidate chord (pin, w) changes only if it shares a pixel
    // with the new line: the chords cross (their ends interleave round the frame: the pins are numbered round
    // a convex outline, a circle or a rectangle, so crossing chords always do), or, since chords that do not
    // cross are closest at an endpoint, one of the four ends lies within TOUCH px of the other chord.
    const span = (v - u + N) % N;
    for (let j = 0; j < this.K; j++) {
      const pin = this.cur[j]!;
      if (j === k || pin < 0) continue;
      const vj = this.valid[j]!;
      if (this.distance(pin, u, v) < TOUCH) { vj.fill(0); continue; }
      const side = (pin - u + N) % N < span;
      for (let w = 0; w < N; w++) {
        if (!vj[w]) continue;
        if ((w - u + N) % N < span !== side || this.distance(w, u, v) < TOUCH || this.distance(u, pin, w) < TOUCH || this.distance(v, pin, w) < TOUCH) vj[w] = 0;
      }
    }
  }

  /** The first line of thread k: the best of all pin pairs, as in generate(). */
  private first(k: number): boolean {
    const N = this.N, ok = this.ok;
    let best = 0, bu = -1, bv = -1;
    for (let u = 0; u < N; u++) for (let v = u + 1; v < N; v++) {
      if (!ok[u * N + v]) continue;
      const g = this.score(k, u, v);
      if (g > best) { best = g; bu = u; bv = v; }
    }
    if (bu < 0) return false;
    this.seq[k]!.push(bu);
    this.draw(k, bu, bv);
    return true;
  }

  private canUse(k: number, u: number, v: number): boolean {
    return this.ok[u * this.N + v] === 1 && this.used[k]![this.key(u, v)]! < this.limit;
  }

  /**
   * One step of the run; false when it is finished. The first step finds every thread's first line (in one
   * go, so a stop can never fall between them); every later step adds one line, or starts threads late.
   */
  step(): boolean {
    if (this.finished) return false;
    const { K, N } = this;
    if (!this.started) {
      this.started = true;
      for (let k = 0; k < K; k++) this.first(k);
      return true;
    }
    let best = 0, bk = -1, bv = -1;
    for (let k = 0; k < K; k++) {
      const u = this.cur[k]!;
      if (u < 0 || this.seq[k]!.length - 1 >= this.o.maxLines[k]!) continue;
      const gains = this.gains[k]!, valid = this.valid[k]!;
      for (let v = 0; v < N; v++) {
        if (!this.canUse(k, u, v)) continue;
        let g: number;
        if (valid[v]) g = gains[v]!;
        else { g = this.score(k, u, v); gains[v] = g; valid[v] = 1; }
        if (g > best) { best = g; bk = k; bv = v; }
      }
    }
    if (bk >= 0) {
      this.draw(bk, this.cur[bk]!, bv);
      return true;
    }
    // nothing helps from where the threads are: give the threads that never started another chance
    let late = false;
    for (let k = 0; k < K; k++) if (this.cur[k]! < 0 && this.first(k)) late = true;
    if (!late) this.finished = true;
    return late;
  }

  /** The current weighted squared error. */
  error(): number {
    return this.model.error();
  }

  /** What to tell the user when the run has ended (§14). */
  outcome(): Outcome {
    const unstarted: number[] = [], budgetBlocked: number[] = [];
    for (let k = 0; k < this.K; k++) {
      const u = this.cur[k]!;
      if (u < 0) { unstarted.push(k); continue; }
      if (this.seq[k]!.length - 1 < this.o.maxLines[k]!) continue;
      for (let v = 0; v < this.N; v++) {
        if (this.canUse(k, u, v) && this.score(k, u, v) > 0) { budgetBlocked.push(k); break; }
      }
    }
    return { reason: this.lines === 0 ? "empty" : budgetBlocked.length ? "budget" : "converged", unstarted, budgetBlocked };
  }
}

/** Runs to the end: generate() with the accelerations and late start. */
export function runGreedy(o: FrameOptions, target: Float64Array, weight: Float64Array, resume?: readonly (readonly number[])[] | null, extras?: Extras): GreedyRun {
  const run = new GreedyRun(o, target, weight, resume, extras);
  while (run.step()) { /* one line at a time */ }
  return run;
}

/** A fresh model with the sequences wound into it: how a stored result is shown again without regenerating. */
export function replayModel(o: FrameOptions, target: Float64Array, weight: Float64Array, sequences: readonly (readonly number[])[]): Model {
  const m = new Model(o, target, weight), P = framePins(o), alpha = coverageAlpha(o);
  sequences.forEach((s, k) => {
    for (let i = 1; i < s.length; i++) m.apply(k, rasterLine(o.res, alpha, P[2 * s[i - 1]!]!, P[2 * s[i - 1]! + 1]!, P[2 * s[i]!]!, P[2 * s[i]! + 1]!));
  });
  return m;
}
