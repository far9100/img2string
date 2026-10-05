// M2 (spec §13.5), the parts a unit test can hold.
//  - "The gamut check flags the green sector of the colour benchmark with the CMYK palette."
//  - "Accelerated generation stays within 1 % of the exact greedy's error": the app's generator draws exactly
//    the reference's lines, which tests/acceptance/m1.test.ts already asserts for both benchmarks; here the
//    same is held for the option M2 adds (repeats). "At least 2x faster on the colour benchmark" is a timing,
//    so it is asserted by `npm run bench -- --assert` (DECISIONS D-08), not here.
//  - "Auto order picks the best of all orders on the colour benchmark (verified by brute force)" takes
//    minutes: tests/slow/autoOrder.test.ts, run with `npm run test:slow`.
import { describe, expect, it } from "vitest";
import { benchmark } from "../../src/core/benchmarks.ts";
import { gamutCheck, GAMUT_THRESHOLD, hullFit } from "../../src/core/gamut.ts";
import { runGreedy } from "../../src/core/greedy.ts";
import { MAX_REPEAT } from "../../src/core/project.ts";
import { circleMask, generate, linearToSrgb, type Options } from "../../src/core/stringart.ts";
import { discAndBar } from "../helpers/pictures.ts";

describe("M2 (§13.5): gamut check", () => {
  const { options: o, target, weight } = benchmark("colour");
  const report = gamutCheck(target, weight, o.board, o.threads);
  const px = o.res * o.res;
  /** Pixels of the wheel whose colour is a saturated hue near the given sRGB colour. */
  const sector = (r: number, g: number, b: number) => {
    const out: number[] = [];
    for (let p = 0; p < px; p++) {
      if (!weight[p]) continue;
      const s = [linearToSrgb(target[3 * p]!), linearToSrgb(target[3 * p + 1]!), linearToSrgb(target[3 * p + 2]!)];
      if (Math.abs(s[0]! - r) < 0.25 && Math.abs(s[1]! - g) < 0.25 && Math.abs(s[2]! - b) < 0.25) out.push(p);
    }
    return out;
  };
  const flagged = (pixels: number[]) => pixels.filter((p) => report.clusters[report.labels[p]!]!.out).length / pixels.length;

  it("flags the green sector of the colour benchmark with the CMYK palette", () => {
    const green = sector(0, 1, 0);
    expect(green.length).toBeGreaterThan(500);
    expect(flagged(green)).toBe(1);
    // and the reason is the one §1 gives: the nearest mixable colour is a dull yellow-green
    const fit = hullFit([0, 1, 0], [o.board, ...o.threads]);
    expect(fit.deltaE).toBeGreaterThan(2 * GAMUT_THRESHOLD);
    expect(fit.nearest[1]).toBeGreaterThan(fit.nearest[2]!); // greener than blue
    expect(fit.weights[1]).toBeGreaterThan(0.3); // mostly yellow ...
    expect(fit.weights[2]).toBeGreaterThan(0.2); // ... and cyan
  });

  it("flags the blue sector too, and leaves what the threads can mix alone", () => {
    expect(flagged(sector(0, 0, 1))).toBe(1);
    expect(flagged(sector(1, 1, 0))).toBe(0); // yellow: there is a yellow thread
    const centre = Math.floor(o.res / 2) * o.res + Math.floor(o.res / 2);
    expect(report.clusters[report.labels[centre]!]!.out).toBe(false); // the white centre: the board itself
    expect(report.outShare).toBeGreaterThan(0.2);
    expect(report.outShare).toBeLessThan(0.8);
  });

  it("suggests a thread whose colour is among those out of reach", () => {
    const s = report.suggestion!;
    expect(hullFit(s, [o.board, ...o.threads]).deltaE).toBeGreaterThan(GAMUT_THRESHOLD);
  });
});

describe("M2 (§13.5): repeats, up to 3 per pin pair", () => {
  const o: Options = { res: 90, pins: 64, diameterMm: 500, threadWidthMm: 0.7, board: [1, 1, 1], threads: [[0, 0, 0]], maxLines: [400], minSkip: 6, allowRepeat: false };
  const T = discAndBar(o.res), W = circleMask(o.res);
  const uses = (seq: number[][]) => {
    const count = new Map<number, number>();
    for (const s of seq) for (let i = 1; i < s.length; i++) {
      const key = Math.min(s[i - 1]!, s[i]!) * o.pins + Math.max(s[i - 1]!, s[i]!);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    return Math.max(...count.values());
  };

  it("off: the generator is the reference", () => {
    expect(runGreedy(o, T, W, null, { maxRepeat: MAX_REPEAT }).seq).toEqual(generate(o, T, W).sequences);
  });

  it("on: no pair is used more than three times, and the error is no worse than without repeats", () => {
    const without = runGreedy(o, T, W, null, { maxRepeat: MAX_REPEAT });
    const withRepeats = runGreedy({ ...o, allowRepeat: true }, T, W, null, { maxRepeat: MAX_REPEAT });
    expect(MAX_REPEAT).toBe(3);
    expect(uses(without.seq)).toBe(1);
    expect(uses(withRepeats.seq)).toBeGreaterThan(1);
    expect(uses(withRepeats.seq)).toBeLessThanOrEqual(3);
    expect(withRepeats.error()).toBeLessThanOrEqual(without.error());
  });
});
