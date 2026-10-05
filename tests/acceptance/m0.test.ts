// M0 (spec §13.3): the ten checks of the core. They run against the shipped src/core/stringart.ts and, when the
// spec file is present, against the code read straight out of the spec, so the spec's own claim ("§12 passes
// all of them") is tested as well. The two benchmarks of §13.1 follow, for the shipped core.
import { describe, expect, it } from "vitest";
import * as shipped from "../../src/core/stringart.ts";
import { BENCHMARK_EXPECTED, benchmark, type BenchmarkId } from "../../src/core/benchmarks.ts";
import { errorReduction, meanDeltaE, meanDeltaEFlat } from "../../src/core/metrics.ts";
import { mulberry32, pinPair } from "../helpers/rng.ts";
import { loadSpecReference, specPresent } from "../helpers/spec.ts";

type Core = typeof shipped;
type Options = shipped.Options;

const cores: [string, Core][] = [["the shipped core", shipped]];
if (specPresent) cores.push(["the spec's text", loadSpecReference()]);

const base = (over: Partial<Options> = {}): Options => ({
  res: 120, pins: 96, diameterMm: 500, threadWidthMm: 0.25, board: [1, 1, 1], threads: [[0, 0, 0]], maxLines: [100], minSkip: 5, allowRepeat: false, ...over,
});

/** A smooth colour picture for the generator tests: a few soft blobs on a light ground (linear RGB). */
function blobs(res: number, seed: number): Float64Array {
  const r = mulberry32(seed), T = new Float64Array(3 * res * res);
  const B = Array.from({ length: 6 }, () => [r() * res, r() * res, (0.1 + 0.2 * r()) * res, r(), r(), r()] as const);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    let c = [0.9, 0.9, 0.9];
    for (const b of B) {
      const w = Math.exp(-((x - b[0]) ** 2 + (y - b[1]) ** 2) / (2 * b[2] ** 2));
      c = [c[0]! * (1 - w) + b[3] * w, c[1]! * (1 - w) + b[4] * w, c[2]! * (1 - w) + b[5] * w];
    }
    T.set(c, 3 * (y * res + x));
  }
  return T;
}

describe.each(cores)("M0 (§13.3), %s", (_name, S) => {
  const line = (o: Options, P: Float64Array, u: number, v: number) => S.rasterLine(o.res, S.coverageAlpha(o), P[2 * u]!, P[2 * u + 1]!, P[2 * v]!, P[2 * v + 1]!);
  const replay = (o: Options, T: Float64Array, W: Float64Array, sequences: number[][]) => {
    const m = new S.Model(o, T, W), P = S.pinPositions(o.pins, o.res);
    sequences.forEach((s, k) => { for (let i = 1; i < s.length; i++) m.apply(k, line(o, P, s[i - 1]!, s[i]!)); });
    return m;
  };

  it("1. pin 0 is at the top centre and pin N/4 at the right: numbering is clockwise", () => {
    const N = 256, res = 400, P = S.pinPositions(N, res), c = (res - 1) / 2;
    expect(P[0]).toBeCloseTo(c, 9);
    expect(P[1]).toBeCloseTo(0, 9);
    expect(P[2 * (N / 4)]).toBeCloseTo(res - 1, 9);
    expect(P[2 * (N / 4) + 1]).toBeCloseTo(c, 9);
    expect(P[2]!).toBeGreaterThan(P[0]!); // pin 1 is to the right of pin 0 and lower: clockwise on screen
    expect(P[3]!).toBeGreaterThan(P[1]!);
  });

  it("2. opposite pins are one diameter apart; circular pin distance wraps around", () => {
    const o = base({ pins: 256 });
    expect(S.chordMm(0, 128, o)).toBeCloseTo(500, 9);
    expect(S.chordMm(10, 138, o)).toBeCloseTo(500, 9);
    expect(S.circDist(0, 255, 256)).toBe(1);
    expect(S.circDist(250, 5, 256)).toBe(11);
    expect(S.circDist(0, 128, 256)).toBe(128);
    expect(S.circDist(3, 3, 256)).toBe(0);
  });

  it("3. raster coverage: the weights of 300 random lines sum to alpha x length within 2 alpha sqrt2", () => {
    const r = mulberry32(1), res = 200, alpha = 0.2;
    for (let i = 0; i < 300; i++) {
      const [x0, y0, x1, y1] = [r() * (res - 1), r() * (res - 1), r() * (res - 1), r() * (res - 1)];
      const L = S.rasterLine(res, alpha, x0, y0, x1, y1);
      let sum = 0;
      for (const w of L.w) sum += w;
      expect(Math.abs(sum - alpha * Math.hypot(x1 - x0, y1 - y0))).toBeLessThanOrEqual(2 * alpha * Math.SQRT2);
    }
  });

  it("4. no pixel appears twice in one line raster, and pin-to-pin lines stay on the canvas", () => {
    const r = mulberry32(2), res = 200;
    for (let i = 0; i < 300; i++) {
      const L = S.rasterLine(res, 0.2, r() * (res - 1), r() * (res - 1), r() * (res - 1), r() * (res - 1));
      expect(new Set(L.idx).size).toBe(L.idx.length);
    }
    const o = base({ res: 160, pins: 128 }), P = S.pinPositions(o.pins, o.res);
    for (let u = 0; u < o.pins; u++) for (let v = u + 1; v < o.pins; v++) {
      const L = line(o, P, u, v);
      if (new Set(L.idx).size !== L.idx.length) throw new Error(`pixel twice on the line ${u}-${v}`);
      for (const p of L.idx) if (p < 0 || p >= o.res * o.res) throw new Error(`the line ${u}-${v} leaves the canvas`);
    }
  });

  it("5. one black thread on a white board: brightness is the product of (1 - w) over all lines", () => {
    const o = base(), px = o.res * o.res, r = mulberry32(3);
    const m = new S.Model(o, new Float64Array(3 * px), S.circleMask(o.res)), P = S.pinPositions(o.pins, o.res), product = new Float64Array(px).fill(1);
    for (let i = 0; i < 400; i++) {
      const L = line(o, P, ...pinPair(r, o.pins));
      m.apply(0, L);
      L.idx.forEach((p, j) => { product[p]! *= 1 - L.w[j]!; });
    }
    let worst = 0;
    for (let p = 0; p < px; p++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(m.C[3 * p + c]! - product[p]!));
    expect(worst).toBeLessThan(1e-12);
  });

  it("6. the incremental caches equal a full recomposition after 150 random lines on 3 random layers", () => {
    const r = mulberry32(4);
    const o = base({ board: [r(), r(), r()], threads: [[r(), r(), r()], [r(), r(), r()], [r(), r(), r()]], maxLines: [1, 1, 1] }), px = o.res * o.res;
    const T = new Float64Array(3 * px).map(() => r()), W = S.circleMask(o.res), m = new S.Model(o, T, W), P = S.pinPositions(o.pins, o.res);
    for (let i = 0; i < 150; i++) m.apply(Math.floor(r() * 3), line(o, P, ...pinPair(r, o.pins)));
    // against a fresh model given the same coverages and recomputed everywhere
    const fresh = new S.Model(o, T, W);
    for (let k = 0; k < 3; k++) fresh.a[k]!.set(m.a[k]!);
    for (let p = 0; p < px; p++) fresh.recompute(p);
    let worst = 0;
    const cmp = (a: Float64Array, b: Float64Array) => { for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i]! - b[i]!)); };
    cmp(m.C, fresh.C);
    for (let k = 0; k < 3; k++) { cmp(m.below[k]!, fresh.below[k]!); cmp(m.U[k]!, fresh.U[k]!); }
    // and against the definitions of §4.1 and §4.3, written out independently
    for (let p = 0; p < px; p++) {
      let X = [...o.board];
      for (let k = 0; k < 3; k++) {
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(m.below[k]![3 * p + c]! - X[c]!));
        const a = m.a[k]![p]!;
        X = X.map((x, c) => a * o.threads[k]![c]! + (1 - a) * x);
        let U = 1;
        for (let j = k + 1; j < 3; j++) U *= 1 - m.a[j]![p]!;
        worst = Math.max(worst, Math.abs(m.U[k]![p]! - U));
      }
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(m.C[3 * p + c]! - X[c]!));
    }
    expect(worst).toBeLessThan(1e-12);
  });

  it("7. the predicted gain equals the actual error decrease", () => {
    // The decrease is measured over the pixels the line touches. Measured as error-before minus error-after over
    // the whole image it is the difference of two large sums, and a near-zero gain then misses 1e-9 through
    // cancellation alone (up to 2.5e-8 at 400 px), although the formula is exact (DECISIONS D-06).
    const r = mulberry32(5);
    const o = base({ board: [r(), r(), r()], threads: [[r(), r(), r()], [r(), r(), r()], [r(), r(), r()]], maxLines: [1, 1, 1] }), px = o.res * o.res;
    const T = new Float64Array(3 * px).map(() => r()), W = S.circleMask(o.res), m = new S.Model(o, T, W), P = S.pinPositions(o.pins, o.res);
    let worstLocal = 0, worstScaled = 0;
    for (let i = 0; i < 300; i++) {
      const k = Math.floor(r() * 3), L = line(o, P, ...pinPair(r, o.pins));
      const local = () => {
        let e = 0;
        for (const p of L.idx) { const q = 3 * p; e += W[p]! * ((m.C[q]! - T[q]!) ** 2 + (m.C[q + 1]! - T[q + 1]!) ** 2 + (m.C[q + 2]! - T[q + 2]!) ** 2); }
        return e;
      };
      const gain = m.gain(k, L), before = local(), total = m.error();
      m.apply(k, L);
      worstLocal = Math.max(worstLocal, Math.abs(gain - (before - local())) / Math.abs(gain));
      worstScaled = Math.max(worstScaled, Math.abs(gain - (total - m.error())) / total);
    }
    expect(worstLocal).toBeLessThan(1e-9);
    expect(worstScaled).toBeLessThan(1e-12);
  });

  describe("generated sequences", () => {
    const o = base({ res: 100, pins: 72, minSkip: 6, threadWidthMm: 0.6, threads: ["#FFE000", "#00A0E0", "#111111"].map(S.hexToLinear), maxLines: [120, 120, 120] });
    const T = blobs(o.res, 9), W = S.circleMask(o.res), R = S.generate(o, T, W);

    it("8. are valid continuous paths: within budget, every step respects the minimum skip, no pin pair repeats", () => {
      expect(R.lines).toBe(R.sequences.reduce((n, s) => n + Math.max(0, s.length - 1), 0));
      expect(R.lines).toBeGreaterThan(100);
      R.sequences.forEach((s, k) => {
        expect(s.length - 1).toBeLessThanOrEqual(o.maxLines[k]!);
        const seen = new Set<number>();
        for (let i = 1; i < s.length; i++) {
          const a = s[i - 1]!, b = s[i]!;
          expect(Number.isInteger(b) && b >= 0 && b < o.pins).toBe(true);
          expect(S.circDist(a, b, o.pins)).toBeGreaterThanOrEqual(o.minSkip);
          const key = a < b ? a * o.pins + b : b * o.pins + a;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      });
    });

    it("9. replayed into a fresh model, reproduce the reported error", () => {
      expect(R.error).toBeLessThan(R.initialError);
      expect(replay(o, T, W, R.sequences).error()).toBe(R.error);
    });

    it("10. are the same for the same input", () => {
      const again = S.generate(o, T, W);
      expect(again.sequences).toEqual(R.sequences);
      expect(again.error).toBe(R.error);
    });
  });
});

describe("the benchmarks of §13.1, with the shipped core", () => {
  const run = (id: BenchmarkId) => {
    const { options: o, target, weight } = benchmark(id), R = shipped.generate(o, target, weight);
    const m = new shipped.Model(o, target, weight), P = shipped.pinPositions(o.pins, o.res), alpha = shipped.coverageAlpha(o);
    R.sequences.forEach((s, k) => { for (let i = 1; i < s.length; i++) m.apply(k, shipped.rasterLine(o.res, alpha, P[2 * s[i - 1]!]!, P[2 * s[i - 1]! + 1]!, P[2 * s[i]!]!, P[2 * s[i]! + 1]!)); });
    return {
      lines: R.sequences.map((s) => s.length - 1),
      reduction: (100 * errorReduction(R.error, R.initialError)).toFixed(1),
      deltaE: [meanDeltaEFlat(o.board, target, weight).toFixed(1), meanDeltaE(m.C, target, weight).toFixed(1)],
      threadM: R.sequences.map((s) => (shipped.threadLengthMm(s, o) / 1000).toFixed(0)),
    };
  };
  const expected = (id: BenchmarkId) => {
    const e = BENCHMARK_EXPECTED[id];
    return { lines: e.lines, reduction: (100 * e.errorReduction).toFixed(1), deltaE: e.deltaE.map((v) => v.toFixed(1)), threadM: e.threadM.map((v) => v.toFixed(0)) };
  };

  it("mono: 1,410 lines, 90.7 %, mean Delta-E 24.6 -> 9.9, 586 m", { timeout: 180_000 }, () => {
    expect(run("mono")).toEqual(expected("mono"));
  });

  it("colour: 1500 / 1379 / 536 / 606 lines, 76.9 %, mean Delta-E 31.8 -> 18.2, 522 / 437 / 169 / 257 m", { timeout: 600_000 }, () => {
    expect(run("colour")).toEqual(expected("colour"));
  });
});
