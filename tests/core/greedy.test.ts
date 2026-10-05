// The stepper makes the reference's choices (so its accelerations are exact), can be stopped and continued
// from the sequences alone, and adds "late start" (DECISIONS D-04) without touching runs that do not need it.
import { describe, expect, it } from "vitest";
import { GreedyRun, replayModel, runGreedy } from "../../src/core/greedy.ts";
import { circDist, circleMask, generate, hexToLinear, type Options, type RGB } from "../../src/core/stringart.ts";
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
