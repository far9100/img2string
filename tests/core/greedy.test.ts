// The stepper makes the reference's choices (so its accelerations are exact), can be stopped and continued
// from the sequences alone, and adds "late start" (DECISIONS D-04) without touching runs that do not need it.
import { describe, expect, it } from "vitest";
import { allowedPairs, frameBounds, frameMask, framePins, type FrameOptions } from "../../src/core/frame.ts";
import { GreedyRun, replayModel, runGreedy } from "../../src/core/greedy.ts";
import { circDist, circleMask, coverageAlpha, generate, hexToLinear, Model, rasterLine, type Options, type RGB } from "../../src/core/stringart.ts";
import { blobs, discAndBar } from "../helpers/pictures.ts";
import { mulberry32 } from "../helpers/rng.ts";

const base = (over: Partial<Options> = {}): Options => ({
  res: 90, pins: 64, diameterMm: 500, threadWidthMm: 0.7, board: [1, 1, 1], threads: [[0, 0, 0]], maxLines: [150], minSkip: 6, allowRepeat: false, ...over,
});
const PALETTE: RGB[] = ["#FFE000", "#00A0E0", "#E0007A", "#111111"].map(hexToLinear);

describe("GreedyRun against generate()", () => {
  it("draws the same lines for 1 to 4 threads, with and without an importance map", { timeout: 120_000 }, () => {
    let compared = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const r = mulberry32(seed), K = 1 + (seed % 4);
      const o = base({ threads: PALETTE.slice(4 - K), maxLines: Array.from({ length: K }, () => 60 + Math.floor(r() * 80)), minSkip: 4 + Math.floor(r() * 5), pins: 56 + 8 * Math.floor(r() * 3) });
      const T = blobs(o.res, 100 + seed), W = circleMask(o.res);
      if (seed % 2) for (let p = 0; p < W.length; p++) if (W[p]) W[p] = r() < 0.2 ? 0.2 : r() < 0.2 ? 3 : 1; // a patchy importance map
      const ref = generate(o, T, W);
      if (ref.sequences.some((s) => s.length === 0)) continue; // a thread that never starts is where late start differs
      const run = runGreedy(o, T, W);
      expect(run.seq, `seed ${seed}`).toEqual(ref.sequences);
      expect(run.error()).toBe(ref.error);
      expect(run.initialError).toBe(ref.initialError);
      expect(run.lines).toBe(ref.lines);
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(6);
  });

  it("stopped at any line and continued from the sequences, ends exactly where an uninterrupted run ends", { timeout: 120_000 }, () => {
    const o = base({ threads: PALETTE.slice(1), maxLines: [90, 90, 90] }), T = blobs(o.res, 7), W = circleMask(o.res);
    const whole = runGreedy(o, T, W);
    for (const steps of [1, 2, 37, 150]) {
      const part = new GreedyRun(o, T, W);
      for (let i = 0; i < steps && part.step(); i++) { /* stop here */ }
      const stored = JSON.parse(JSON.stringify(part.seq)) as number[][];
      const rest = runGreedy(o, T, W, stored);
      expect(rest.seq, `stopped after ${steps} steps`).toEqual(whole.seq);
      expect(rest.error()).toBe(whole.error());
    }
    // the model of a finished run is the model of its replayed sequences
    expect(replayModel(o, T, W, whole.seq).error()).toBe(whole.error());
  });

  it("respects the budget, the minimum skip and the repeat rule", () => {
    const o = base({ maxLines: [70] }), T = discAndBar(o.res), W = circleMask(o.res);
    const check = (seq: number[][], limit: number) => {
      const count = new Map<number, number>();
      for (const s of seq) for (let i = 1; i < s.length; i++) {
        const a = s[i - 1]!, b = s[i]!;
        expect(circDist(a, b, o.pins)).toBeGreaterThanOrEqual(o.minSkip);
        const key = Math.min(a, b) * o.pins + Math.max(a, b);
        count.set(key, (count.get(key) ?? 0) + 1);
      }
      expect(Math.max(...count.values())).toBeLessThanOrEqual(limit);
      return Math.max(...count.values());
    };
    const once = runGreedy(o, T, W);
    expect(once.seq[0]!.length - 1).toBe(70);
    check(once.seq, 1);
    const thrice = runGreedy({ ...o, allowRepeat: true, maxLines: [400] }, T, W, null, { maxRepeat: 3 });
    expect(check(thrice.seq, 3)).toBeGreaterThan(1); // repeats are actually used on this picture
  });

  it("with repeats, a run continued from its sequences counts the pairs already used", () => {
    const o = base({ allowRepeat: true, maxLines: [400] }), T = discAndBar(o.res), W = circleMask(o.res);
    const whole = runGreedy(o, T, W, null, { maxRepeat: 3 });
    for (const at of [1, 57, 230]) {
      const first = new GreedyRun(o, T, W, null, { maxRepeat: 3 });
      while (first.lines < at && first.step()) { /* stop here */ }
      const stored = JSON.parse(JSON.stringify(first.seq)) as number[][];
      const rest = runGreedy(o, T, W, stored, { maxRepeat: 3 });
      expect(rest.seq, `continued at line ${at}`).toEqual(whole.seq);
      expect(rest.error()).toBe(whole.error());
    }
  });
});

/** generate() of stringart.ts for any frame: every candidate scored afresh at every step, nothing remembered. */
function plainSearch(o: FrameOptions, target: Float64Array, weight: Float64Array, maxRepeat = 255): { sequences: number[][]; error: number } {
  const N = o.pins, P = framePins(o), ok = allowedPairs(o), alpha = coverageAlpha(o), model = new Model(o, target, weight), limit = o.allowRepeat ? maxRepeat : 1;
  const line = (u: number, v: number) => rasterLine(o.res, alpha, P[2 * u]!, P[2 * u + 1]!, P[2 * v]!, P[2 * v + 1]!);
  const key = (u: number, v: number) => (u < v ? u * N + v : v * N + u);
  const seq: number[][] = o.threads.map(() => []), used = o.threads.map(() => new Map<number, number>()), cur: number[] = [];
  const draw = (k: number, u: number, v: number) => { model.apply(k, line(u, v)); seq[k]!.push(v); used[k]!.set(key(u, v), (used[k]!.get(key(u, v)) ?? 0) + 1); cur[k] = v; };
  for (let k = 0; k < o.threads.length; k++) {
    let best = 0, bu = -1, bv = -1;
    for (let u = 0; u < N; u++) for (let v = u + 1; v < N; v++) {
      if (!ok[u * N + v]) continue;
      const g = model.gain(k, line(u, v));
      if (g > best) { best = g; bu = u; bv = v; }
    }
    cur.push(bu);
    if (bu >= 0) { seq[k]!.push(bu); draw(k, bu, bv); }
  }
  for (;;) {
    let best = 0, bk = -1, bv = -1;
    for (let k = 0; k < o.threads.length; k++) {
      const u = cur[k]!;
      if (u < 0 || seq[k]!.length - 1 >= o.maxLines[k]!) continue;
      for (let v = 0; v < N; v++) {
        if (!ok[u * N + v] || (used[k]!.get(key(u, v)) ?? 0) >= limit) continue;
        const g = model.gain(k, line(u, v));
        if (g > best) { best = g; bk = k; bv = v; }
      }
    }
    if (bk < 0) break;
    draw(bk, cur[bk]!, bv);
  }
  return { sequences: seq, error: model.error() };
}

describe("GreedyRun on a rectangular frame (DECISIONS D-58)", () => {
  const rect = (aspect: number, over: Partial<FrameOptions> = {}): FrameOptions => ({ ...base(over), shape: "rect", aspect });

  it("on the round frame the plain search is generate(), so it can stand in for it", () => {
    const o = base({ threads: PALETTE.slice(1), maxLines: [70, 70, 70] }), T = blobs(o.res, 3), W = circleMask(o.res), ref = generate(o, T, W), plain = plainSearch(o, T, W);
    expect(plain.sequences).toEqual(ref.sequences);
    expect(plain.error).toBe(ref.error);
  });

  it("draws the lines a plain search draws, for 1 to 4 threads: what it remembers between steps is exact", { timeout: 240_000 }, () => {
    let compared = 0, lines = 0;
    for (const [aspect, pins, res, minSkip] of [[0.75, 72, 96, 6], [1.5, 96, 120, 8], [1, 80, 110, 7], [0.4, 128, 120, 10], [2.5, 64, 100, 5], [4, 96, 110, 4]] as const) {
      for (const K of [1, 2, 3, 4]) for (const repeat of [false, true]) {
        const seed = Math.round(100 * aspect) + 10 * K + (repeat ? 1 : 0), r = mulberry32(seed);
        const o = rect(aspect, { pins, res, minSkip, threads: PALETTE.slice(4 - K), maxLines: Array.from({ length: K }, () => 120 + Math.floor(r() * 120)), allowRepeat: repeat, threadWidthMm: 0.6 });
        const T = blobs(res, 200 + seed), W = frameMask(o);
        if (seed % 2) for (let p = 0; p < W.length; p++) if (W[p]) W[p] = r() < 0.2 ? 0.2 : r() < 0.2 ? 3 : 1;
        const plain = plainSearch(o, T, W, 3);
        if (plain.sequences.some((s) => s.length === 0)) continue; // late start: see below
        const run = runGreedy(o, T, W, null, { maxRepeat: 3 });
        expect(run.seq, `aspect ${aspect}, ${K} threads, repeat ${repeat}`).toEqual(plain.sequences);
        expect(run.error()).toBe(plain.error);
        compared++;
        lines += run.lines;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(40);
    expect(lines).toBeGreaterThan(10_000);
  });

  it("joins only pins the frame allows, never two on one side, and stays inside the frame", () => {
    const o = rect(0.75, { pins: 96, res: 120, minSkip: 8, maxLines: [300] }), T = discAndBar(o.res), W = frameMask(o), ok = allowedPairs(o), P = framePins(o);
    const run = runGreedy(o, T, W), s = run.seq[0]!;
    expect(s.length - 1).toBeGreaterThan(100);
    for (let i = 1; i < s.length; i++) {
      expect(ok[s[i - 1]! * o.pins + s[i]!]).toBe(1);
      expect(circDist(s[i - 1]!, s[i]!, o.pins)).toBeGreaterThanOrEqual(o.minSkip);
    }
    // nothing is drawn beside the frame: a pixel away from its outline (a line is two pixels wide) the composite
    // is still the board
    const C = run.model.C, b = frameBounds(o);
    let bare = 0;
    for (let y = 0; y < o.res; y++) for (let x = 0; x < o.res; x++) {
      if (x >= b.x0 - 1 && x <= b.x1 + 1) continue;
      const p = y * o.res + x;
      expect(W[p]).toBe(0);
      expect(C[3 * p]! + C[3 * p + 1]! + C[3 * p + 2]!).toBe(3);
      bare++;
    }
    expect(bare).toBeGreaterThan(0.2 * o.res * o.res);
    expect(Math.max(...P)).toBeLessThanOrEqual(o.res - 1);
    expect(run.error()).toBeLessThan(0.5 * run.initialError);
  });

  it("stopped and continued from its sequences, ends where an uninterrupted run ends", () => {
    const o = rect(1.5, { pins: 96, res: 120, minSkip: 8, threads: PALETTE.slice(2), maxLines: [90, 90] }), T = blobs(o.res, 9), W = frameMask(o);
    const whole = runGreedy(o, T, W);
    for (const steps of [1, 40, 120]) {
      const part = new GreedyRun(o, T, W);
      for (let i = 0; i < steps && part.step(); i++) { /* stop here */ }
      const rest = runGreedy(o, T, W, JSON.parse(JSON.stringify(part.seq)) as number[][]);
      expect(rest.seq, `stopped after ${steps} steps`).toEqual(whole.seq);
      expect(rest.error()).toBe(whole.error());
    }
    expect(replayModel(o, T, W, whole.seq).error()).toBe(whole.error());
  });
});

describe("late start (DECISIONS D-04)", () => {
  const o = base({ res: 120, pins: 96, threadWidthMm: 0.5, threads: [[0, 0, 0], [1, 1, 1]], maxLines: [600, 600], minSkip: 8 });
  const T = discAndBar(o.res), W = circleMask(o.res);

  it("a thread of the board's colour never starts in the reference, and starts late here", { timeout: 120_000 }, () => {
    const ref = generate(o, T, W);
    expect(ref.sequences[1]).toEqual([]); // no white line helps on a bare white board
    const run = runGreedy(o, T, W);
    expect(run.seq[1]!.length).toBeGreaterThan(20);
    expect(run.error()).toBeLessThan(0.8 * ref.error);
    expect(run.outcome().unstarted).toEqual([]);
    // up to the moment the reference stops, both drew the same black lines
    expect(run.seq[0]!.slice(0, ref.sequences[0]!.length)).toEqual(ref.sequences[0]);
  });

  it("is continued correctly from stored sequences in which a thread has not started yet", { timeout: 120_000 }, () => {
    const whole = runGreedy(o, T, W);
    const part = new GreedyRun(o, T, W);
    for (let i = 0; i < 40 && part.step(); i++) { /* the white thread is still unstarted */ }
    expect(part.seq[1]).toEqual([]);
    expect(runGreedy(o, T, W, JSON.parse(JSON.stringify(part.seq)) as number[][]).seq).toEqual(whole.seq);
  });
});

describe("how a run ends (§14)", () => {
  const T = discAndBar(90), W = circleMask(90);

  it("says when the budget ran out while lines would still help", () => {
    const run = runGreedy(base({ maxLines: [25] }), T, W);
    expect(run.outcome()).toEqual({ reason: "budget", unstarted: [], budgetBlocked: [0] });
  });

  it("says when nothing is worth drawing: a thread of the board's colour alone", () => {
    const run = runGreedy(base({ threads: [[1, 1, 1]] }), T, W);
    expect(run.lines).toBe(0);
    expect(run.outcome()).toEqual({ reason: "empty", unstarted: [0], budgetBlocked: [] });
  });

  it("converges on its own when the budget is generous", () => {
    const run = runGreedy(base({ maxLines: [5000] }), T, W);
    expect(run.outcome().reason).toBe("converged");
    expect(run.seq[0]!.length - 1).toBeLessThan(5000);
  });

  it("refuses settings the reference mishandles", () => {
    expect(() => new GreedyRun(base({ maxLines: [0] }), T, W)).toThrow(RangeError); // DECISIONS D-03
    expect(() => new GreedyRun(base({ pins: 12, minSkip: 6 }), T, W)).toThrow(RangeError); // §14: 2 x minSkip + 1 pins
    expect(() => new GreedyRun(base(), T, W, [[3]])).toThrow(RangeError);
  });
});
