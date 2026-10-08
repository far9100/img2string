// A piece with pins inside the picture (DECISIONS D-60, D-61): the generator over all its pins, the trips a
// thread makes when no line from its pin helps, whose a line is when there are several threads, and what the
// true-width render shows of such a piece.
import { describe, expect, it } from "vitest";
import { allowedPairs, frameMask, framePins, isRound, pinCount, pinOf, roundTo, type FrameOptions } from "../../src/core/frame.ts";
import { GreedyRun, replayModel, runGreedy } from "../../src/core/greedy.ts";
import { placeInside, placeRes } from "../../src/core/inside.ts";
import { coverageAlpha, hexToLinear, Model, pixelMm, rasterLine, type RGB } from "../../src/core/stringart.ts";
import { Ranking } from "../../src/core/travel.ts";
import { PIN_HEAD, trueWidthComposite } from "../../src/core/truewidth.ts";
import { lineGain } from "../helpers/lineGain.ts";
import { blobs, discAndBar, lineDrawing } from "../helpers/pictures.ts";
import { mulberry32 } from "../helpers/rng.ts";
import { travelReference } from "../helpers/travelReference.ts";

const PALETTE: RGB[] = ["#FFE000", "#00A0E0", "#E0007A", "#111111"].map(hexToLinear);

/** 64 pins on a 200 mm circle and `count` pins on the ink of the test line drawing. */
function pinned(count: number, over: Partial<FrameOptions> = {}): FrameOptions {
  const at = placeRes(200), inside = placeInside(lineDrawing(at, 2), frameMask({ res: at }), { res: at, board: [1, 1, 1], diameterMm: 200, pinDiameterMm: 1.5 }, count);
  return { res: 96, pins: 64, diameterMm: 200, threadWidthMm: 0.5, board: [1, 1, 1], threads: [[0, 0, 0]], maxLines: [3000], minSkip: 6, allowRepeat: false, inside, pinDiameterMm: 1.5, ...over };
}

/**
 * generate() of stringart.ts over pins inside the picture, with nothing remembered: every candidate scored
 * afresh at every step (lineGain.ts), every pair drawn once, a thread ends where no line from its pin helps, and a thread
 * that has not begun is tried again when the others have ended. With several threads a line is a thread's
 * only if no other would gain more from it (or as much, and comes before it): D-61.
 */
function plainSearch(o: FrameOptions, target: Float64Array, weight: Float64Array): { sequences: number[][]; error: number } {
  const N = pinCount(o), K = o.threads.length, P = framePins(o), ok = allowedPairs(o), alpha = coverageAlpha(o), model = new Model(o, target, weight);
  const line = (u: number, v: number) => rasterLine(o.res, alpha, P[2 * u]!, P[2 * u + 1]!, P[2 * v]!, P[2 * v + 1]!);
  const gain = (k: number, u: number, v: number) => lineGain(model, k, line(u, v));
  /** The thread's gain from the line, or nothing where the line is another thread's. */
  const worth = (k: number, u: number, v: number): number => {
    const own = gain(k, u, v);
    if (!(own > 0)) return own;
    for (let j = 0; j < K; j++) {
      if (j === k) continue;
      const other = gain(j, u, v);
      if (other > own || (other === own && j < k)) return 0;
    }
    return own;
  };
  const key = (u: number, v: number) => (u < v ? u * N + v : v * N + u);
  const seq: number[][] = o.threads.map(() => []), used = o.threads.map(() => new Set<number>()), cur: number[] = o.threads.map(() => -1);
  const draw = (k: number, u: number, v: number) => { model.apply(k, line(u, v)); seq[k]!.push(v); used[k]!.add(key(u, v)); cur[k] = v; };
  const pairs: [number, number][] = [];
  for (let u = 0; u < N; u++) for (let v = u + 1; v < N; v++) if (ok[u * N + v]) pairs.push([u, v]);
  /** The first line of a thread: of the pairs in this order, the first that is the thread's as things are. */
  const begin = (k: number, order: number[]): boolean => {
    for (const e of order) {
      const [u, v] = pairs[e]!;
      if (!(worth(k, u, v) > 0)) continue;
      seq[k]!.push(u);
      draw(k, u, v);
      return true;
    }
    return false;
  };
  const ranked = (score: number[], mine: (e: number) => boolean): number[] =>
    pairs.map((_, e) => e).filter((e) => score[e]! > 0 && mine(e)).sort((a, b) => score[b]! - score[a]! || a - b);
  // on the bare board: what every pair gains every thread, whose each pair is, and each thread's best of its own
  const bare = o.threads.map((_, k) => pairs.map(([u, v]) => gain(k, u, v)));
  const owner = pairs.map((_, e) => {
    let top = 0, by = -1;
    for (let k = 0; k < K; k++) if (bare[k]![e]! > top) { top = bare[k]![e]!; by = k; }
    return by;
  });
  for (let k = 0; k < K; k++) begin(k, ranked(bare[k]!, (e) => owner[e] === k));
  for (;;) {
    let best = 0, bk = -1, bv = -1;
    for (let k = 0; k < K; k++) {
      const u = cur[k]!;
      if (u < 0 || seq[k]!.length - 1 >= o.maxLines[k]!) continue;
      for (let v = 0; v < N; v++) {
        if (!ok[u * N + v] || used[k]!.has(key(u, v))) continue;
        const g = worth(k, u, v);
        if (g > best) { best = g; bk = k; bv = v; }
      }
    }
    if (bk >= 0) { draw(bk, cur[bk]!, bv); continue; }
    let late = false;
    for (let k = 0; k < K; k++) if (cur[k]! < 0 && begin(k, ranked(pairs.map(([u, v]) => gain(k, u, v)), () => true))) late = true;
    if (!late) break;
  }
  return { sequences: seq, error: model.error() };
}

/** What every sequence of a piece with pins inside must be: each step a line its pins allow, or a way round the
 * frame between two of the frame's pins; a pair run along again only after it was drawn. Returns the counts. */
function check(o: FrameOptions, seq: readonly (readonly number[])[]): { lines: number; walks: number; retraces: number } {
  const N = pinCount(o), F = o.pins, ok = allowedPairs(o);
  let lines = 0, walks = 0, retraces = 0;
  for (const s of seq) {
    const drawn = new Set<number>();
    if (s.length) expect(isRound(s[0]!)).toBe(false);
    for (let i = 1; i < s.length; i++) {
      const u = pinOf(s[i - 1]!), v = pinOf(s[i]!);
      expect(v).toBeLessThan(N);
      if (isRound(s[i]!)) {
        expect(u < F && v < F && u !== v, `a walk from ${u} to ${v}`).toBe(true);
        walks++;
        continue;
      }
      expect(ok[u * N + v], `the line ${u}-${v}`).toBe(1);
      const key = u < v ? u * N + v : v * N + u;
      if (drawn.has(key)) retraces++;
      else { drawn.add(key); lines++; }
    }
  }
  return { lines, walks, retraces };
}

describe("the generator over pins inside the picture, without trips", () => {
  it("draws the lines a search that remembers nothing draws, for 1 to 3 threads: what it remembers is exact", { timeout: 240_000 }, () => {
    let compared = 0, lines = 0;
    for (const K of [1, 2, 3]) for (const seed of [1, 2]) {
      const r = mulberry32(10 * K + seed);
      const o = pinned(24 + 8 * seed, { threads: PALETTE.slice(4 - K), maxLines: Array.from({ length: K }, () => 90 + Math.floor(r() * 60)), minSkip: 5 + seed });
      const T = blobs(o.res, 300 + 10 * K + seed), W = frameMask(o);
      if (seed % 2) for (let p = 0; p < W.length; p++) if (W[p]) W[p] = r() < 0.2 ? 0.2 : r() < 0.2 ? 3 : 1;
      const plain = plainSearch(o, T, W);
      const run = runGreedy(o, T, W, null, { travel: false });
      expect(run.seq, `${K} threads, seed ${seed}`).toEqual(plain.sequences);
      expect(run.error()).toBe(plain.error);
      compared++;
      lines += run.lines;
    }
    expect(compared).toBe(6);
    expect(lines).toBeGreaterThan(500);
  });

  it("and so it is with four threads on a picture in greys, where three of them begin late or never", { timeout: 240_000 }, () => {
    for (const budget of [400, 25]) {
      const o = pinned(30, { threads: PALETTE, maxLines: [budget, budget, budget, budget] }), T = discAndBar(o.res), W = frameMask(o);
      const plain = plainSearch(o, T, W), run = runGreedy(o, T, W, null, { travel: false });
      expect(run.seq, `budget ${budget}`).toEqual(plain.sequences);
      expect(run.error()).toBe(plain.error);
    }
  });

  it("with an empty list of pins inside is the frame's own run, and it ignores the repeat setting when there are pins", () => {
    const o = pinned(0), T = lineDrawing(o.res, 1.5), W = frameMask(o), { inside: _none, pinDiameterMm: _d, ...frame } = o;
    expect(o.inside).toEqual([]);
    expect(runGreedy(o, T, W).seq).toEqual(runGreedy(frame, T, W).seq);
    const some = pinned(30), once = runGreedy(some, T, W, null, { travel: false });
    expect(runGreedy({ ...some, allowRepeat: true }, T, W, null, { travel: false, maxRepeat: 3 }).seq).toEqual(once.seq);
  });
});

describe("the trips of a thread (travel.ts)", () => {
  const o = pinned(40), T = lineDrawing(o.res, 1.5), W = frameMask(o), run = runGreedy(o, T, W), stuck = runGreedy(o, T, W, null, { travel: false });

  it("are made of lines the pins allow, ways round the frame, and lines the thread has drawn before", () => {
    const counts = check(o, run.seq);
    expect(run.seq[0]!.length - 1).toBe(counts.lines + counts.walks + counts.retraces);
    expect(run.lines).toBe(run.seq[0]!.length - 1); // every step counts, whether it draws or not
    expect(counts.walks).toBeGreaterThan(0);
    expect(counts.lines).toBeGreaterThan(40);
    // a thread without trips has none of the other two
    expect(check(o, stuck.seq)).toMatchObject({ walks: 0, retraces: 0 });
  });

  it("take the thread on where it would have ended: more lines, a lower error", () => {
    expect(run.seq[0]!.length).toBeGreaterThan(stuck.seq[0]!.length);
    expect(run.error()).toBeLessThan(stuck.error());
    // and until the first trip the two are the same run
    const first = run.seq[0]!.findIndex((entry, i) => i >= stuck.seq[0]!.length || entry !== stuck.seq[0]![i]);
    expect(first).toBe(stuck.seq[0]!.length);
  });

  it("the piece wound again from its sequence is the piece: a walk and a retrace draw nothing", () => {
    expect(replayModel(o, T, W, run.seq).error()).toBe(run.error());
    // taken for lines across the picture, every one drawn, the same steps are another and a worse picture
    const P = framePins(o), alpha = coverageAlpha(o), wrong = new Model(o, T, W), s = run.seq[0]!;
    for (let i = 1; i < s.length; i++) {
      const u = pinOf(s[i - 1]!), v = pinOf(s[i]!);
      wrong.apply(0, rasterLine(o.res, alpha, P[2 * u]!, P[2 * u + 1]!, P[2 * v]!, P[2 * v + 1]!));
    }
    expect(wrong.error()).toBeGreaterThan(run.error());
  });

  it("are the same in every run with the same picture and pins", () => {
    expect(runGreedy(pinned(40), lineDrawing(o.res, 1.5), frameMask(o)).seq).toEqual(run.seq);
  });

  it("are the trips of the same run written straight down, step for step", { timeout: 240_000 }, () => {
    // other pins, pictures, importance maps and budgets (one too short for the trips that would be worth making)
    const cases: [FrameOptions, Float64Array][] = [
      [o, T],
      [pinned(25, { minSkip: 8, threadWidthMm: 0.7 }), blobs(o.res, 5).map((v, i, all) => (all[i - (i % 3)]! + all[i - (i % 3) + 1]! + all[i - (i % 3) + 2]!) / 3)],
      [pinned(60, { maxLines: [150] }), lineDrawing(o.res, 2.5)],
      [pinned(40, { threads: [hexToLinear("#8a2f1c")], board: hexToLinear("#f2e8d5") }), lineDrawing(o.res, 2)],
    ];
    let steps = 0;
    cases.forEach(([options, picture], i) => {
      const r = mulberry32(40 + i), weight = frameMask(options);
      if (i % 2) for (let p = 0; p < weight.length; p++) if (weight[p]) weight[p] = r() < 0.2 ? 0.2 : r() < 0.2 ? 3 : 1;
      const ours = runGreedy(options, picture, weight), straight = travelReference(options, picture, weight);
      expect(ours.seq[0], `case ${i}`).toEqual(straight.sequence);
      expect(ours.error()).toBe(straight.error);
      expect(check(options, ours.seq).walks + check(options, ours.seq).retraces, `case ${i}`).toBeGreaterThan(0);
      steps += ours.lines;
    });
    expect(steps).toBeGreaterThan(400);
  });

  it("keep within the budget, and a run that ends for want of budget says so", () => {
    for (const budget of [1, 7, 40]) {
      const short = runGreedy({ ...o, maxLines: [budget] }, T, W);
      expect(short.seq[0]!.length - 1).toBeLessThanOrEqual(budget);
      check(o, short.seq);
      expect(short.outcome().reason).toBe("budget");
    }
    expect(run.outcome()).toEqual({ reason: "converged", unstarted: [], budgetBlocked: [] });
  });

  it("a run stopped and continued from its sequence goes on from that piece, to a piece like any other", () => {
    for (const steps of [1, 5, 60]) {
      const part = new GreedyRun(o, T, W);
      for (let i = 0; i < steps && part.step(); i++) { /* stop here */ }
      const stored = JSON.parse(JSON.stringify(part.seq)) as number[][], error = part.error();
      const rest = runGreedy(o, T, W, stored), again = runGreedy(o, T, W, stored);
      expect(rest.seq[0]!.slice(0, stored[0]!.length), `stopped after ${steps} steps`).toEqual(stored[0]);
      expect(rest.seq).toEqual(again.seq);
      expect(rest.error()).toBeLessThanOrEqual(error);
      check(o, rest.seq);
      expect(replayModel(o, T, W, rest.seq).error()).toBe(rest.error());
      // as good as the run that was not stopped, give or take what the trips happened to find
      expect(rest.error()).toBeLessThan(1.1 * run.error());
    }
  });

  it("with two threads each makes its own trips", { timeout: 120_000 }, () => {
    const two = pinned(40, { threads: [hexToLinear("#111111"), hexToLinear("#FFFFFF")], maxLines: [400, 400] });
    const both = runGreedy(two, T, W), counts = check(two, both.seq);
    expect(both.seq.every((s) => s.length > 1)).toBe(true);
    expect(counts.walks).toBeGreaterThan(0);
    expect(replayModel(two, T, W, both.seq).error()).toBe(both.error());
    expect(both.error()).toBeLessThan(runGreedy(two, T, W, null, { travel: false }).error());
    expect(runGreedy(two, T, W).seq).toEqual(both.seq);
  });

  it("refuses a sequence that is not one of such a piece, and a pin off the grid", () => {
    const F = o.pins;
    expect(() => new GreedyRun(o, T, W, [[roundTo(3), 20]])).toThrow(RangeError); // begins with a walk
    expect(() => new GreedyRun(o, T, W, [[F + 1, roundTo(3)]])).toThrow(RangeError); // a walk from a pin inside
    expect(() => new GreedyRun(o, T, W, [[3, roundTo(F + 1)]])).toThrow(RangeError); // a walk to a pin inside
    expect(() => new GreedyRun(o, T, W, [[3, pinCount(o)]])).toThrow(RangeError);
    expect(() => new GreedyRun(o, T, W, [[3, roundTo(20)]])).not.toThrow();
    const { inside: _none, pinDiameterMm: _d, ...frame } = o;
    expect(() => new GreedyRun(frame, T, W, [[3, roundTo(20)]])).toThrow(RangeError); // no pins inside: no walks
    expect(() => new GreedyRun({ ...o, inside: [1.2, 0.5] }, T, W)).toThrow(RangeError);
    expect(() => new GreedyRun({ ...o, inside: [0.5, Number.NaN] }, T, W)).toThrow(RangeError);
  });
});

/**
 * Runs a piece step by step beside a model of its own and asks of every line, as it is drawn, whose it was:
 * the thread's own (it gains from the line, and no other thread would gain more, or as much and come first),
 * or not. `last` counts the steps whose last line was not the thread's when the step began: a line from where
 * the thread stood, the pair a trip was made for (chosen before the lines of its way were drawn), a first line.
 */
function audit(o: FrameOptions, target: Float64Array, weight: Float64Array, extras?: { travel?: boolean }) {
  const run = new GreedyRun(o, target, weight, null, extras), N = pinCount(o), K = o.threads.length, P = framePins(o), alpha = coverageAlpha(o), shadow = new Model(o, target, weight);
  const seen = o.threads.map(() => 1), drawn = o.threads.map(() => new Set<number>()), own = o.threads.map(() => 0);
  const lineOf = (u: number, v: number) => rasterLine(o.res, alpha, P[2 * u]!, P[2 * u + 1]!, P[2 * v]!, P[2 * v + 1]!);
  const mine = (k: number, u: number, v: number): boolean => {
    const line = lineOf(u, v), gain = lineGain(shadow, k, line);
    if (!(gain > 0)) return false;
    for (let j = 0; j < K; j++) if (j !== k) { const other = lineGain(shadow, j, line); if (other > gain || (other === gain && j < k)) return false; }
    return true;
  };
  let lines = 0, foreign = 0, last = 0;
  for (let more = true; more;) {
    more = run.step();
    // within a step the threads act in their order (the first lines, a late start) or only one of them does
    run.seq.forEach((seq, k) => {
      if (seq.length > seen[k]! && !isRound(seq.at(-1)!) && !mine(k, pinOf(seq.at(-2)!), seq.at(-1)!)) last++;
      for (let i = seen[k]!; i < seq.length; i++) {
        const entry = seq[i]!, u = pinOf(seq[i - 1]!), v = pinOf(entry), key = u < v ? u * N + v : v * N + u;
        if (isRound(entry) || drawn[k]!.has(key)) continue;
        drawn[k]!.add(key);
        lines++;
        if (mine(k, u, v)) own[k]!++;
        else foreign++;
        shadow.apply(k, lineOf(u, v));
      }
      seen[k] = Math.max(1, seq.length);
    });
  }
  expect(shadow.error()).toBe(run.error()); // the same lines in the same order
  return { run, lines, foreign, last, own };
}

describe("several threads over pins inside the picture (D-61)", () => {
  // a picture in greys, and four threads of which only the last is grey
  const grey = (budget: number, over: Partial<FrameOptions> = {}) => pinned(30, { threads: PALETTE, maxLines: [budget, budget, budget, budget], ...over });

  it("a line is drawn by the thread that gains most from it: every line, where no thread makes a trip", { timeout: 240_000 }, () => {
    let lines = 0;
    for (const [o, T] of [[grey(300), discAndBar(96)], [pinned(36, { threads: PALETTE, maxLines: [150, 150, 150, 150] }), blobs(96, 7)], [pinned(30, { threads: PALETTE.slice(2), maxLines: [200, 200] }), blobs(96, 11)]] as const) {
      const a = audit(o, T, frameMask(o), { travel: false });
      expect(a.foreign).toBe(0);
      lines += a.lines;
    }
    expect(lines).toBeGreaterThan(400);
  });

  it("with trips too, but for lines on the way of a trip: the line a trip is made for is the thread's", { timeout: 240_000 }, () => {
    for (const [o, T] of [[grey(300), discAndBar(96)], [pinned(36, { threads: PALETTE, maxLines: [150, 150, 150, 150] }), blobs(96, 7)]] as const) {
      const a = audit(o, T, frameMask(o));
      expect(a.last).toBe(0);
      expect(a.foreign).toBeLessThan(0.05 * a.lines);
      expect(check(o, a.run.seq).walks).toBeGreaterThan(0);
    }
  });

  it("so a picture in greys is wound in black, and what the black thread cannot do for want of budget stays undone", { timeout: 240_000 }, () => {
    // a thread a quarter of a millimetre wide: an eighth of a pixel, about what a piece is made with
    const fine = grey(900, { threadWidthMm: 0.25 }), T = discAndBar(96), full = audit(fine, T, frameMask(fine));
    // nearly all of it is the black thread's; the others draw where a line of theirs is the finer step
    expect(full.own[3]).toBeGreaterThan(8 * (full.own[0]! + full.own[1]! + full.own[2]!));
    expect(full.own[3]).toBeGreaterThan(300);
    expect(full.run.outcome()).toEqual({ reason: "converged", unstarted: [], budgetBlocked: [] });
    // With a budget the black thread spends long before it is done, the others do not take its lines over
    // (in magenta they would lower the error too): they draw next to nothing, and the run says who ran out.
    const o = { ...fine, maxLines: [900, 900, 900, 60] }, short = audit(o, T, frameMask(o));
    expect(short.run.seq[3]!.length - 1).toBe(60);
    expect(short.last).toBe(0);
    expect(short.lines - short.own[3]!).toBeLessThan(5);
    expect(short.run.error()).toBeGreaterThan(2 * full.run.error());
    expect(short.run.outcome()).toMatchObject({ reason: "budget", budgetBlocked: [3] });
  });

  it("is the same in every run, and a run continued from its sequences is a piece like any other", { timeout: 240_000 }, () => {
    const o = pinned(36, { threads: PALETTE, maxLines: [150, 150, 150, 150] }), T = blobs(96, 7), W = frameMask(o), whole = runGreedy(o, T, W);
    expect(runGreedy(o, T, W).seq).toEqual(whole.seq);
    const part = new GreedyRun(o, T, W);
    for (let i = 0; i < 80 && part.step(); i++) { /* stop here */ }
    const stored = JSON.parse(JSON.stringify(part.seq)) as number[][], rest = runGreedy(o, T, W, stored);
    rest.seq.forEach((seq, k) => expect(seq.slice(0, stored[k]!.length)).toEqual(stored[k]));
    check(o, rest.seq);
    expect(replayModel(o, T, W, rest.seq).error()).toBe(rest.error());
    expect(rest.error()).toBeLessThan(1.1 * whole.error());
  });
});

describe("the order pairs are looked at in (travel.ts's Ranking)", () => {
  it("hands out the numbers by their keys, highest first, and the lower number first among equal keys", () => {
    const r = mulberry32(3), key = Float64Array.from({ length: 500 }, () => Math.floor(8 * r()) / 4 - 0.5);
    const items = Int32Array.from({ length: 300 }, (_, i) => (7 * i) % 500), want = Array.from(items).sort((a, b) => key[b]! - key[a]! || a - b);
    const ranking = new Ranking(items, 300, key), got: number[] = [];
    for (let e = ranking.next(); e >= 0; e = ranking.next()) got.push(e);
    expect(got).toEqual(want);
    expect(ranking.next()).toBe(-1);
    expect(new Ranking(new Int32Array(4), 0, key).next()).toBe(-1);
    // only the first `count` of the items
    const few = new Ranking(Int32Array.from([5, 9, 2, 400]), 3, Float64Array.from({ length: 500 }, (_, i) => i));
    expect([few.next(), few.next(), few.next(), few.next()]).toEqual([9, 5, 2, -1]);
  });
});

describe("the true-width render of a piece with pins inside", () => {
  const o = pinned(12), bare = trueWidthComposite(o, [[]]), F = o.pins;
  const { inside: _none, pinDiameterMm: _d, ...frame } = o;

  it("shows every pin inside as a disc of the pin's size, over the board", () => {
    const board = trueWidthComposite(frame, [[]]);
    expect(Array.from(board).every((v) => v === 1)).toBe(true);
    // what the discs take from a white board: their area x how dark the grey is
    let taken = 0;
    for (let p = 0; p < bare.length; p += 3) taken += 1 - bare[p]!;
    const disc = (Math.PI * 0.75 * 0.75) / pixelMm(o) ** 2;
    expect(taken / (12 * disc * (1 - PIN_HEAD[0]))).toBeGreaterThan(0.95);
    expect(taken / (12 * disc * (1 - PIN_HEAD[0]))).toBeLessThan(1.05);
    // and each where its pin is
    const P = framePins(o);
    for (let j = 0; j < 12; j++) {
      const x = Math.round(P[2 * (F + j)]!), y = Math.round(P[2 * (F + j) + 1]!);
      let near = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near += 1 - bare[3 * ((y + dy) * o.res + x + dx)]!;
      expect(near, `pin ${j}`).toBeGreaterThan(0.9 * disc * (1 - PIN_HEAD[0]));
    }
  });

  it("draws no line for a step round the frame, and the line after it starts where the walk ended", () => {
    expect(trueWidthComposite(o, [[0, roundTo(20)]])).toEqual(bare);
    expect(trueWidthComposite(o, [[0, roundTo(20), 40]])).toEqual(trueWidthComposite(o, [[20, 40]]));
    expect(trueWidthComposite(o, [[20, 40]])).not.toEqual(bare);
    // the same line twice is the line once: thread on thread
    expect(trueWidthComposite(o, [[5, 30, 5, 30]])).toEqual(trueWidthComposite(o, [[5, 30]]));
    // The head of a pin is above the thread wound round it. A pin in the very middle, and a thread 5 mm wide
    // straight through it from the left of the frame to the right: under that thread everything is black but
    // the quarter of the head each of the four pixels round the middle holds.
    const middle: FrameOptions = { ...o, inside: [0.5, 0.5], threadWidthMm: 5 }, wide = trueWidthComposite(middle, [[48, F, 16]], 12), row = 47 * o.res;
    expect(wide[3 * (row + 40)]).toBeLessThan(0.01);
    expect(wide[3 * (row + 47)]! - wide[3 * (row + 40)]!).toBeGreaterThan(0.015);
    expect(wide[3 * (row + 47)]).toBeLessThan(0.05);
  });

  it("of a piece without pins inside is what it was: a pin below zero is still no pin", () => {
    expect(trueWidthComposite(frame, [[-1, 7]])).toEqual(trueWidthComposite(frame, [[]]));
    expect(trueWidthComposite(frame, [[0, roundTo(20), 40]])).toEqual(trueWidthComposite(frame, [[]]));
  });
});
