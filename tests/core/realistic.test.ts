// The realistic view (§7.1): the viewing-distance blur and the numbers measured on the true-width render.
import { describe, expect, it } from "vitest";
import { benchmark } from "../../src/core/benchmarks.ts";
import { runGreedy } from "../../src/core/greedy.ts";
import { erf, gaussianBlur } from "../../src/core/image.ts";
import { measureSubPixels, measureTrueWidth, viewedRender } from "../../src/core/realistic.ts";
import { pixelMm, type Options } from "../../src/core/stringart.ts";
import { renderTrueWidth, viewingSigmaMm } from "../../src/core/truewidth.ts";

describe("the blur whose weights are areas", () => {
  it("erf is accurate enough for blur weights", () => {
    for (const [x, v] of [[0, 0], [0.5, 0.5204998778], [1, 0.8427007929], [2, 0.995322265], [-1, -0.8427007929]] as const) expect(erf(x)).toBeCloseTo(v, 6);
  });

  it("keeps a blur finer than a pixel, which sampling the curve at pixel centres loses", () => {
    const w = 21, impulse = new Float64Array(w);
    impulse[10] = 1;
    const fine = gaussianBlur(impulse, w, 1, 0.3, 1, true), sampled = gaussianBlur(impulse, w, 1, 0.3);
    const centre = erf(0.5 / (0.3 * Math.SQRT2)); // the area of the curve over the middle pixel
    expect(fine[10]).toBeCloseTo(centre, 6);
    expect(fine[9]).toBeCloseTo((1 - centre) / 2, 4);
    expect(fine[9]!).toBeGreaterThan(0.045);
    expect(sampled[9]!).toBeLessThan(0.005);
    expect(fine.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("from about 0.7 pixels up, has the standard deviation of the curve with the pixel's width added", () => {
    for (const sigma of [0.7, 1.5, 4]) {
      const w = 2 * Math.ceil(3 * sigma + 0.5) + 21, mid = (w - 1) / 2, impulse = new Float64Array(w);
      impulse[mid] = 1;
      const out = gaussianBlur(impulse, w, 1, sigma, 1, true);
      let variance = 0;
      for (let i = 0; i < w; i++) variance += out[i]! * (i - mid) ** 2;
      expect(Math.sqrt(variance) / Math.sqrt(sigma * sigma + 1 / 12)).toBeGreaterThan(0.97);
      expect(Math.sqrt(variance) / Math.sqrt(sigma * sigma + 1 / 12)).toBeLessThan(1.001);
    }
  });
});

describe("viewedRender", () => {
  const o: Options = { res: 60, pins: 48, diameterMm: 300, threadWidthMm: 0.6, board: [1, 1, 1], threads: [[0, 0, 0]], maxLines: [1], minSkip: 4, allowRepeat: false };
  const sequences = [[0, 24, 6, 30, 12, 36]];

  it("without a distance it is the true-width render", () => {
    expect(viewedRender(o, sequences, 90, 90, null, 0)).toEqual(renderTrueWidth(o, sequences, 90, 90));
  });

  it("from farther away the lines are softer but no light is lost", () => {
    const near = viewedRender(o, sequences, 240, 240, null, 0);
    const far = viewedRender(o, sequences, 240, 240, null, viewingSigmaMm(5));
    const mean = (img: Float64Array) => img.reduce((a, b) => a + b, 0) / img.length;
    const min = (img: Float64Array) => img.reduce((a, b) => Math.min(a, b), 1);
    expect(mean(far)).toBeCloseTo(mean(near), 3);
    expect(min(far)).toBeGreaterThan(min(near) + 0.05); // the darkest spot is lighter once it is blurred
    // the blur is sized in millimetres on the piece: sigma of 0.618 mm at 5 m is 0.49 px at this size
    expect((viewingSigmaMm(5) / pixelMm(o)) * (240 / o.res)).toBeCloseTo(0.4860, 3);
  });

  it("blurs by the same amount on the piece whatever the size of the picture or the part shown", () => {
    const sigma = viewingSigmaMm(4);
    const whole = viewedRender(o, sequences, 120, 120, null, sigma);
    // the same view at twice the size, averaged back 2 x 2, is the same picture within the pixel grid's limits
    const big = viewedRender(o, sequences, 240, 240, null, sigma), back = new Float64Array(whole.length);
    for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) for (let c = 0; c < 3; c++) {
      back[3 * (y * 120 + x) + c] = (big[3 * (2 * y * 240 + 2 * x) + c]! + big[3 * (2 * y * 240 + 2 * x + 1) + c]! + big[3 * ((2 * y + 1) * 240 + 2 * x) + c]! + big[3 * ((2 * y + 1) * 240 + 2 * x + 1) + c]!) / 4;
    }
    let worst = 0;
    for (let i = 0; i < whole.length; i++) worst = Math.max(worst, Math.abs(whole[i]! - back[i]!));
    expect(worst).toBeLessThan(0.08);
    // a magnified part: 30 working pixels across in 120 output pixels is four times the scale of the whole
    const part = viewedRender(o, sequences, 120, 120, { x0: 14.5, y0: 14.5, x1: 44.5, y1: 44.5 }, sigma);
    expect(part.length).toBe(whole.length);
  });
});

describe("measureTrueWidth", () => {
  it("measures the mono benchmark as 87.2 % on the true-width render, against the model's 90.7 % (D-10)", { timeout: 120_000 }, () => {
    const b = benchmark("mono"), run = runGreedy(b.options, b.target, b.weight);
    expect(measureSubPixels(b.options)).toBe(16);
    const m = measureTrueWidth(b.options, run.seq, b.target, b.weight);
    expect(100 * m.errorReduction).toBeGreaterThan(86.6);
    expect(100 * m.errorReduction).toBeLessThan(87.8);
    expect(100 * (1 - run.error() / run.initialError)).toBeCloseTo(90.70, 1);
    expect(m.deltaE).toBeGreaterThan(9);
    expect(m.deltaE).toBeLessThan(13);
  });

  it("never asks for more than 16 sub-pixels per side, however thin the thread", () => {
    expect(measureSubPixels({ ...benchmark("mono").options, diameterMm: 1000, threadWidthMm: 0.05 })).toBe(16);
    expect(measureSubPixels({ ...benchmark("mono").options, threadWidthMm: 0.6 })).toBe(7);
  });
});
