// src/core/truewidth.ts: every line as an opaque stripe of true thread width (spec §7.1), and the check of the
// image model against it (§13.1 "Model check", DECISIONS D-10).
import { describe, expect, it } from "vitest";
import { benchmark } from "../../src/core/benchmarks.ts";
import { errorReduction, weightedError } from "../../src/core/metrics.ts";
import { chordMm, circDist, circleMask, coverageAlpha, generate, linearToSrgb, Model, pinPositions, pixelMm, rasterLine, type Options, type RGB } from "../../src/core/stringart.ts";
import { colourWheel } from "../../src/core/targets.ts";
import { renderTrueWidth, trueWidthComposite, viewingSigmaMm } from "../../src/core/truewidth.ts";
import { mulberry32, pinPair } from "../helpers/rng.ts";

/** A thick thread on a small frame, so that a render is a few million sub-pixels: alpha = 0.238, 13 sub-pixels per pixel. */
const base = (over: Partial<Options> = {}): Options => ({
  res: 120, pins: 96, diameterMm: 300, threadWidthMm: 0.6, board: [1, 1, 1], threads: [[0, 0, 0]], maxLines: [100], minSkip: 5, allowRepeat: false, ...over,
});

/** The model's composite after replaying the sequences (spec §4). */
function replay(o: Options, T: Float64Array, W: Float64Array, sequences: number[][]): Model {
  const m = new Model(o, T, W), P = pinPositions(o.pins, o.res), alpha = coverageAlpha(o);
  sequences.forEach((s, k) => { for (let i = 1; i < s.length; i++) m.apply(k, rasterLine(o.res, alpha, P[2 * s[i - 1]!]!, P[2 * s[i - 1]! + 1]!, P[2 * s[i]!]!, P[2 * s[i]! + 1]!)); });
  return m;
}

/** Model against render inside the circle, in sRGB values: mean |difference| and mean difference (model - render). */
function compare(model: Float64Array, render: Float64Array, mask: Float64Array) {
  let abs = 0, signed = 0, n = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    for (let c = 0; c < 3; c++) { const d = linearToSrgb(model[3 * p + c]!) - linearToSrgb(render[3 * p + c]!); abs += Math.abs(d); signed += d; n++; }
  }
  return { abs: abs / n, signed: signed / n };
}

const bare = (o: Options, pixels = o.res * o.res): Float64Array => { const B = new Float64Array(3 * pixels); for (let p = 0; p < pixels; p++) B.set(o.board, 3 * p); return B; };
/** Area covered by a black thread on a white board, in pixels of the picture. */
const covered = (img: Float64Array): number => { let a = 0; for (let p = 0; p < img.length; p += 3) a += 1 - img[p]!; return a; };
const worst = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let w = a.length === b.length ? 0 : Infinity;
  for (let i = 0; i < a.length; i++) w = Math.max(w, Math.abs(a[i]! - b[i]!));
  return w;
};
/** A chord runs along the grid's rows, columns or diagonals when its two pins add up to a multiple of a quarter of the pins. */
const alongGrid = (u: number, v: number, pins: number): boolean => (u + v) % (pins / 4) === 0;
/** Lines that are neither short nor along the grid. */
function genericPairs(o: Options, count: number, seed: number): [number, number][] {
  const r = mulberry32(seed), out: [number, number][] = [];
  while (out.length < count) {
    const [u, v] = pinPair(r, o.pins);
    if (circDist(u, v, o.pins) >= 10 && !alongGrid(u, v, o.pins)) out.push([u, v]);
  }
  return out;
}

describe("the model against the true-width render (§13.1, D-10)", () => {
  it("mono benchmark: mean |difference| 0.045 in sRGB, no bias, and 87.2 % of the error removed where the model says 90.7 %", { timeout: 120_000 }, () => {
    const { options: o, target, weight } = benchmark("mono"), R = generate(o, target, weight);
    const model = replay(o, target, weight, R.sequences), render = trueWidthComposite(o, R.sequences);
    expect(model.error()).toBe(R.error);
    expect((100 * errorReduction(R.error, R.initialError)).toFixed(2)).toBe("90.70");

    const d = compare(model.C, render, circleMask(o.res));
    expect(Math.abs(d.abs - 0.045)).toBeLessThan(0.004);
    expect(Math.abs(d.signed)).toBeLessThan(0.02);

    const before = weightedError(bare(o), target, weight), after = weightedError(render, target, weight);
    expect(before).toBe(R.initialError);
    expect(Math.abs(100 * errorReduction(after, before) - 87.2)).toBeLessThan(0.6);
    // the screen render of the whole grid at the working resolution is the same picture
    expect(worst(renderTrueWidth(o, R.sequences, o.res, o.res), render)).toBeLessThan(1e-12);
  });

  it("several colours: the render is close to the model, and the winding order shows in it", () => {
    // 300 lines a colour: enough crossings between the colours for the order to matter
    const o = base({ res: 100, pins: 72, diameterMm: 500, minSkip: 6, threads: [[1, 0.75, 0], [0, 0.35, 0.75], [0.005, 0.005, 0.005]], maxLines: [300, 300, 300] });
    const target = colourWheel(o.res), weight = circleMask(o.res), R = generate(o, target, weight);
    expect(R.lines).toBe(900);
    const model = replay(o, target, weight, R.sequences), render = trueWidthComposite(o, R.sequences), d = compare(model.C, render, weight);
    expect(d.abs).toBeLessThan(0.04); // 0.028
    expect(Math.abs(d.signed)).toBeLessThan(0.02);
    // measured on the render, the threads remove nearly as much of the error as the model says (70.9 % against 71.6 %)
    const before = weightedError(bare(o), target, weight), told = errorReduction(R.error, R.initialError), seen = errorReduction(weightedError(render, target, weight), before);
    expect(before).toBe(R.initialError);
    expect(seen).toBeGreaterThan(0.6);
    expect(Math.abs(told - seen)).toBeLessThan(0.03);
    // wound in the opposite order the same lines give another picture, twice as far from the model's
    const reversed = trueWidthComposite({ ...o, threads: [...o.threads].reverse() }, [...R.sequences].reverse());
    expect(compare(model.C, reversed, weight).abs).toBeGreaterThan(1.5 * d.abs);
    expect(compare(render, reversed, weight).abs).toBeGreaterThan(0.03);
  });
});

describe("trueWidthComposite", () => {
  it("one line alone covers thread width x length", () => {
    const o = base(), mm2 = pixelMm(o) ** 2;
    expect(coverageAlpha(o) * 13).toBeGreaterThan(3); // 13 sub-pixels per pixel make the stripe 3.09 wide
    for (const [u, v] of genericPairs(o, 30, 41)) {
      const area = covered(trueWidthComposite(o, [[u, v]])) * mm2;
      expect(Math.abs(area / (o.threadWidthMm * chordMm(u, v, o)) - 1), `pins ${u}-${v}`).toBeLessThan(0.02);
    }
    // a path is its lines together, less the little they share at each pin
    const path = [3, 40, 77, 20, 61], whole = covered(trueWidthComposite(o, [path])) * mm2;
    let sum = 0;
    for (let i = 1; i < path.length; i++) sum += o.threadWidthMm * chordMm(path[i - 1]!, path[i]!, o);
    expect(whole).toBeLessThan(sum);
    expect(whole).toBeGreaterThan(0.95 * sum);
  });

  it("a line along the grid's rows, columns or diagonals has a whole number of sub-pixels in every column", () => {
    // such a line meets every column of sub-pixels at the same place, so its 3.09 sub-pixels are 3 or 4 all the
    // way along (4.37 are 4 or 5 on a diagonal): up to one sub-pixel off, where any other line averages out
    const o = base(), S = 13, stripe = coverageAlpha(o) * S, counts = new Set<number>();
    for (const [u, v] of [[72, 24], [70, 26], [60, 36], [0, 48], [10, 38], [93, 51], [12, 60], [36, 84], [5, 19], [50, 70]] as const) {
      expect(alongGrid(u, v, o.pins)).toBe(true);
      const diagonal = (u + v) % (o.pins / 2) !== 0, across = stripe * (diagonal ? Math.SQRT2 : 1);
      // sub-pixels painted, over the number of columns the line crosses
      const perColumn = (covered(trueWidthComposite(o, [[u, v]])) * S * S) / ((chordMm(u, v, o) / pixelMm(o)) * S * (diagonal ? Math.SQRT1_2 : 1));
      expect(Math.abs(perColumn - Math.round(perColumn)), `pins ${u}-${v}: ${perColumn}`).toBeLessThan(0.03);
      expect(Math.abs(Math.round(perColumn) - across), `pins ${u}-${v}`).toBeLessThan(1);
      counts.add(Math.round(perColumn));
    }
    expect(counts.size).toBeGreaterThan(1);
  });

  it("the stripe is the set of sub-pixel centres within half the thread width of the line, between its pins", () => {
    const o = base({ res: 24, pins: 14, diameterMm: 100, threadWidthMm: 1.3, board: [0.9, 0.8, 0.7], threads: [[0.1, 0.5, 0.2], [0.6, 0.1, 0.9]] }), S = 12;
    const sequences = [[0, 5, 11, 2, 8], [3, 9, 13, 6]], P = pinPositions(o.pins, o.res), half = (coverageAlpha(o) * S) / 2;
    expect(2 * half).toBeGreaterThan(3);
    const side = o.res * S, labels = new Uint8Array(side * side);
    sequences.forEach((s, k) => {
      for (let i = 1; i < s.length; i++) {
        const ax = (P[2 * s[i - 1]!]! + 0.5) * S, ay = (P[2 * s[i - 1]! + 1]! + 0.5) * S, bx = (P[2 * s[i]!]! + 0.5) * S, by = (P[2 * s[i]! + 1]! + 0.5) * S;
        const dx = bx - ax, dy = by - ay, length = Math.hypot(dx, dy), tall = Math.abs(dy) > Math.abs(dx);
        for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
          const along = tall ? y + 0.5 : x + 0.5, from = tall ? Math.min(ay, by) : Math.min(ax, bx), to = tall ? Math.max(ay, by) : Math.max(ax, bx);
          const distance = Math.abs(dx * (y + 0.5 - ay) - dy * (x + 0.5 - ax)) / length;
          if (along >= from && along < to && distance < half) labels[y * side + x] = k + 1;
        }
      }
    });
    const colours = [o.board, ...o.threads], expected = new Float64Array(3 * o.res * o.res);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const p = 3 * (Math.floor(y / S) * o.res + Math.floor(x / S));
      for (let c = 0; c < 3; c++) expected[p + c]! += colours[labels[y * side + x]!]![c]! / (S * S);
    }
    expect(worst(trueWidthComposite(o, sequences, S), expected)).toBeLessThan(1e-12);
    expect(labels.filter((l) => l === 1).length).toBeGreaterThan(2500);
    expect(labels.filter((l) => l === 2).length).toBeGreaterThan(2500);
  });

  it("a later layer hides an earlier one where they cross", () => {
    const red: RGB = [1, 0, 0], blue: RGB = [0, 0, 1], S = 40, first = [10, 55], second = [30, 80];
    // on white, red adds to R only and blue to B only: the sub-pixels of each are counted from R - G and B - G
    const count = (img: Float64Array, channel: number): number => { let n = 0; for (let p = 0; p < img.length; p += 3) n += (img[p + channel]! - img[p + 1]!) * S * S; return Math.round(n); };
    const o = base({ threads: [red, blue] }), both = trueWidthComposite(o, [first, second], S);
    const redAlone = count(trueWidthComposite(o, [first, []], S), 0), blueAlone = count(trueWidthComposite(o, [[], second], S), 2);
    // the stripes are 9.5 sub-pixels wide and cross at 67.5 degrees: they share 9.5^2 / sin = 98 sub-pixels
    const stripe = coverageAlpha(o) * S, overlap = stripe ** 2 / Math.sin((Math.PI * (30 + 80 - 10 - 55)) / o.pins);
    expect(count(both, 2)).toBe(blueAlone);
    expect(redAlone - count(both, 0)).toBeGreaterThan(0.9 * overlap);
    expect(redAlone - count(both, 0)).toBeLessThan(1.1 * overlap);
    // the same two lines with the colours wound the other way round: now the red one is whole
    const swapped = trueWidthComposite({ ...o, threads: [blue, red] }, [second, first], S);
    expect(count(swapped, 0)).toBe(redAlone);
    expect(blueAlone - count(swapped, 2)).toBe(redAlone - count(both, 0));
    // lines of one thread simply merge
    const o1 = base(), merged = covered(trueWidthComposite(o1, [[...first, second[0]!, second[1]!]], S)), apart = [first, second, [55, 30]].map((s) => covered(trueWidthComposite(o1, [s], S)));
    expect(merged).toBeLessThan(apart[0]! + apart[1]! + apart[2]!);
    expect(merged).toBeGreaterThan(apart[0]! + apart[1]! + apart[2]! - 4 * overlap / (S * S) - 2 * stripe * 20 / (S * S));
  });

  it("is the same whether the grid is drawn in one band or in several", () => {
    // 128 px x 40 sub-pixels = 5,120 a side: 26 million labels, more than the 16 MB held at a time, and the
    // band's edge falls inside a row of pixels. Compared with the whole grid drawn at once, by the same rule.
    const r = mulberry32(42), o = base({ res: 128, pins: 90, diameterMm: 500, threadWidthMm: 0.5, board: [r(), r(), r()], threads: [[r(), r(), r()], [r(), r(), r()], [r(), r(), r()]] }), S = 40;
    const sequences = o.threads.map(() => { const s = [Math.floor(90 * r())]; while (s.length < 21) { const v = Math.floor(90 * r()); if (v !== s[s.length - 1]) s.push(v); } return s; });
    const side = o.res * S, labels = new Uint8Array(side * side), P = pinPositions(o.pins, o.res), half = (coverageAlpha(o) * S) / 2;
    expect(2 * half).toBeGreaterThan(3);
    expect(side * side).toBeGreaterThan(1 << 24);
    sequences.forEach((s, k) => {
      for (let i = 1; i < s.length; i++) {
        const ax = (P[2 * s[i - 1]!]! + 0.5) * S, ay = (P[2 * s[i - 1]! + 1]! + 0.5) * S, bx = (P[2 * s[i]!]! + 0.5) * S, by = (P[2 * s[i]! + 1]! + 0.5) * S;
        const tall = Math.abs(by - ay) > Math.abs(bx - ax);
        let a0 = tall ? ay : ax, a1 = tall ? by : bx, b0 = tall ? ax : ay, b1 = tall ? bx : by;
        if (a1 < a0) { [a0, a1] = [a1, a0]; [b0, b1] = [b1, b0]; }
        const slope = (b1 - b0) / (a1 - a0), ext = half * Math.sqrt(1 + slope * slope);
        for (let a = Math.ceil(a0 - 0.5); a + 0.5 < a1; a++) {
          const b = b0 + slope * (a + 0.5 - a0);
          for (let m = Math.ceil(b - ext - 0.5); m + 0.5 < b + ext; m++) labels[tall ? a * side + m : m * side + a] = k + 1;
        }
      }
    });
    const colours = [o.board, ...o.threads], counts = new Int32Array(4 * o.res * o.res), expected = new Float64Array(3 * o.res * o.res);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) counts[4 * (Math.floor(y / S) * o.res + Math.floor(x / S)) + labels[y * side + x]!]!++;
    for (let p = 0; p < o.res * o.res; p++) for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let l = 0; l < 4; l++) sum += counts[4 * p + l]! * colours[l]![c]!;
      expected[3 * p + c] = sum / (S * S);
    }
    expect(worst(trueWidthComposite(o, sequences, S), expected)).toBeLessThan(1e-12);
  });

  it("with too few sub-pixels for the stripe, every line still has its area, whatever its direction", () => {
    // 12, 4, 2 or 1 sub-pixels per pixel: the stripe is 2.9, 0.95, 0.48 or 0.24 of a sub-pixel wide. The sub-pixels
    // painted are the stripe's area in sub-pixels to the nearest whole one, give or take the line's first or last column
    const o = base(), alpha = coverageAlpha(o);
    const lines: [number, number][] = [...genericPairs(o, 10, 43), [72, 24], [70, 26], [0, 48], [10, 38], [12, 60], [36, 84]];
    for (const S of [12, 4, 2, 1]) {
      expect(alpha * S).toBeLessThan(3);
      for (const [u, v] of lines) {
        const painted = covered(trueWidthComposite(o, [[u, v]], S)) * S * S, area = alpha * S * (chordMm(u, v, o) / pixelMm(o)) * S;
        expect(Math.abs(painted - area), `pins ${u}-${v} at ${S}`).toBeLessThan(0.5 + alpha * S * Math.SQRT2 + 1e-6);
        if (S >= 2) expect(Math.abs(painted / area - 1), `pins ${u}-${v} at ${S}`).toBeLessThan(0.02);
      }
    }
    // and in a grid of several bands: 400 px x 12 = 4,800 a side, the stripe 2.4 sub-pixels wide
    const big = benchmark("mono").options;
    for (const [u, v] of [[192, 64], [0, 128], [32, 160], [7, 150], [201, 90]] as const) {
      const area = covered(trueWidthComposite(big, [[u, v]], 12)) * pixelMm(big) ** 2;
      expect(Math.abs(area / (big.threadWidthMm * chordMm(u, v, big)) - 1), `pins ${u}-${v}`).toBeLessThan(0.002);
    }
  });

  it("no lines leave the bare board, and what is not a line is not drawn", () => {
    const o = base({ board: [0.3, 0.6, 0.1], threads: [[0.9, 0.1, 0.1], [0, 0, 0]] });
    for (const sequences of [[], [[]], [[], []], [[5]], [[5, 5]], [[5, 999]], [[-1, 7]], [[], [], [3, 40]]]) expect(trueWidthComposite(o, sequences)).toEqual(bare(o));
    // the default is the smallest count that makes the stripe 3 sub-pixels wide
    expect(trueWidthComposite(o, [[3, 40]])).toEqual(trueWidthComposite(o, [[3, 40]], 13));
    expect(trueWidthComposite(o, [[3, 40]])).not.toEqual(trueWidthComposite(o, [[3, 40]], 14));
    // a pixel wholly under one thread is that thread's colour exactly
    const thick = trueWidthComposite(base({ threadWidthMm: 12, threads: [[0.1, 0.7, 0.3]] }), [[0, 48]], 3);
    expect(Array.from(thick.subarray(3 * (60 * 120 + 60), 3 * (60 * 120 + 60) + 3))).toEqual([0.1, 0.7, 0.3]);
    expect(() => trueWidthComposite(base({ threads: Array.from({ length: 256 }, (): RGB => [0, 0, 0]) }), [])).toThrow(RangeError);
  });
});

describe("renderTrueWidth", () => {
  const o = base(), line = [[17, 58]], length = chordMm(17, 58, o) / pixelMm(o), alpha = coverageAlpha(o);

  it("of the whole grid at res x res is trueWidthComposite", () => {
    const r = mulberry32(44), many = base({ board: [0.95, 0.9, 0.8], threads: [[0.8, 0.1, 0.1], [0.1, 0.1, 0.5]] });
    const sequences = many.threads.map(() => Array.from({ length: 40 }, (_, i) => (i * 37 + Math.floor(20 * r())) % many.pins));
    const image = renderTrueWidth(many, sequences, many.res, many.res);
    expect(image).toHaveLength(3 * many.res * many.res);
    expect(worst(image, trueWidthComposite(many, sequences))).toBeLessThan(1e-12);
    expect(renderTrueWidth(many, sequences, 0, 50)).toHaveLength(0);
  });

  it("gives the thread its area at any output size, coarser or finer than the thread", () => {
    expect(alongGrid(17, 58, o.pins)).toBe(false);
    for (const size of [15, 30, 120, 200, 480, 1100]) {
      // an output pixel is (res / size)^2 working pixels; at 15 px a pixel is 34 threads wide, at 1100 a thread is 2.2 px
      const image = renderTrueWidth(o, line, size, size);
      expect(image).toHaveLength(3 * size * size);
      expect(Math.abs((covered(image) * (o.res / size) ** 2) / (alpha * length) - 1), `${size} px`).toBeLessThan(0.02);
    }
    // not square: the picture is stretched, the thread still covers the same share of it
    const wide = renderTrueWidth(o, line, 300, 90);
    expect(Math.abs((covered(wide) * (o.res / 300) * (o.res / 90)) / (alpha * length) - 1)).toBeLessThan(0.02);
  });

  it("shows a region: a quarter of the grid is the quarter of the whole picture at that scale", () => {
    const r = mulberry32(45), sequences = [Array.from({ length: 60 }, (_, i) => (i * 41 + Math.floor(15 * r())) % o.pins)];
    const whole = renderTrueWidth(o, sequences, 2 * o.res, 2 * o.res);
    const quarter = renderTrueWidth(o, sequences, o.res, o.res, { x0: -0.5, y0: -0.5, x1: o.res / 2 - 0.5, y1: o.res / 2 - 0.5 });
    let w = 0;
    for (let y = 0; y < o.res; y++) for (let x = 0; x < o.res; x++) for (let c = 0; c < 3; c++) w = Math.max(w, Math.abs(quarter[3 * (y * o.res + x) + c]! - whole[3 * (y * 2 * o.res + x) + c]!));
    expect(w).toBeLessThan(1e-12);
    // the opposite quarter, whose coordinates are rounded differently: the same picture but for a few edge sub-pixels
    const last = renderTrueWidth(o, sequences, o.res, o.res, { x0: o.res / 2 - 0.5, y0: o.res / 2 - 0.5, x1: o.res - 0.5, y1: o.res - 0.5 });
    let sum = 0;
    for (let y = 0; y < o.res; y++) for (let x = 0; x < o.res; x++) sum += Math.abs(last[3 * (y * o.res + x)]! - whole[3 * ((y + o.res) * 2 * o.res + x + o.res)]!);
    expect(sum / (o.res * o.res)).toBeLessThan(1e-4);
    expect(covered(last)).toBeGreaterThan(100);
  });

  it("magnified, the stripe has the thread's width and smooth edges", () => {
    // 4 x 4 working pixels around the middle of the line at 50 output pixels each: the thread is 11.9 px wide
    const P = pinPositions(o.pins, o.res), mx = (P[2 * 17]! + P[2 * 58]!) / 2, my = (P[2 * 17 + 1]! + P[2 * 58 + 1]!) / 2;
    const size = 200, image = renderTrueWidth(o, line, size, size, { x0: mx - 2, y0: my - 2, x1: mx + 2, y1: my + 2 });
    const dx = P[2 * 58]! - P[2 * 17]!, dy = P[2 * 58 + 1]! - P[2 * 17 + 1]!, tall = Math.abs(dy) > Math.abs(dx), slope = tall ? dx / dy : dy / dx;
    const across = 50 * alpha * Math.sqrt(1 + slope * slope); // the stripe's extent across its minor axis, in output pixels
    let partial = 0;
    for (const at of [20, 100, 180]) {
      let run = 0;
      for (let i = 0; i < size; i++) {
        const v = 1 - image[3 * (tall ? at * size + i : i * size + at)]!;
        run += v;
        if (v > 0.01 && v < 0.99) partial++;
      }
      expect(Math.abs(run - across)).toBeLessThan(0.5);
    }
    expect(partial).toBeGreaterThanOrEqual(3); // antialiased, not a staircase of whole pixels
    expect(image[0]).toBe(1);
    expect(1 - image[3 * (100 * size + 100)]!).toBe(1); // the middle of the picture is on the thread
  });

  it("beyond the grid there is only board", () => {
    // 20 x 20 working pixels, half of them off the right side of the grid, at 5 output pixels each. Pin 24 is the
    // rightmost point of the circle, the centre of the grid's last pixel: 47.5 output pixels in
    const image = renderTrueWidth(o, [[24, 60]], 100, 100, { x0: o.res - 10.5, y0: 49.5, x1: o.res + 9.5, y1: 69.5 });
    for (let y = 0; y < 100; y++) for (let x = 48; x < 100; x++) expect(image[3 * (y * 100 + x)]).toBe(1);
    // up to the pin the line is there: 1.19 output pixels wide at 22.5 degrees, so 1.29 down each column
    const across = 5 * alpha * Math.sqrt(1 + Math.tan(Math.PI / 8) ** 2);
    for (const x of [5, 20, 35, 45]) {
      let run = 0;
      for (let y = 0; y < 100; y++) run += 1 - image[3 * (y * 100 + x)]!;
      expect(Math.abs(run - across)).toBeLessThan(0.3);
    }
  });

  it("caps its work: a thread far thinner than the sub-pixels it can afford still gets its area", () => {
    // 0.05 mm on 1 m at 1,000 px would need 60 sub-pixels per pixel side; 8 are used and the stripe is 0.4 of one wide
    const thin = base({ res: 400, pins: 256, diameterMm: 1000, threadWidthMm: 0.05 });
    for (const [u, v] of [[192, 64], [0, 128], [7, 150], [201, 90]] as const) {
      const image = renderTrueWidth(thin, [[u, v]], 1000, 1000);
      expect(Math.abs((covered(image) * (thin.res / 1000) ** 2 * pixelMm(thin) ** 2) / (thin.threadWidthMm * chordMm(u, v, thin)) - 1), `pins ${u}-${v}`).toBeLessThan(0.02);
    }
  });
});

describe("viewingSigmaMm", () => {
  it("is the Gaussian whose full width at half maximum is one arcminute: 0.2909 mm per metre", () => {
    expect(viewingSigmaMm(2)).toBeCloseTo(0.2471, 4);
    expect(viewingSigmaMm(1) * 2 * Math.sqrt(2 * Math.log(2))).toBeCloseTo(0.2909, 4);
    expect(viewingSigmaMm(5)).toBeCloseTo(5 * viewingSigmaMm(1), 12);
    expect(viewingSigmaMm(0)).toBe(0);
    // half maximum at half the full width: exp(-(FWHM / 2)^2 / (2 sigma^2)) = 1/2
    const sigma = viewingSigmaMm(3), fwhm = 3 * 1000 * Math.tan(Math.PI / (180 * 60));
    expect(Math.exp(-((fwhm / 2) ** 2) / (2 * sigma * sigma))).toBeCloseTo(0.5, 6);
  });
});
