// Reachable colours (spec §1, §6.3): the convex hull of the board and thread colours.
import { describe, expect, it } from "vitest";
import { CMYK_HEX } from "../../src/core/benchmarks.ts";
import { autoPalette, clusterColours, deltaE, GAMUT_CLUSTERS, GAMUT_THRESHOLD, gamutCheck, gamutPicture, hueName, hullFit, paletteCost, suggestThread, summarize } from "../../src/core/gamut.ts";
import { circleMask, hexToLinear, type RGB } from "../../src/core/stringart.ts";
import { colourWheel, face } from "../../src/core/targets.ts";
import { mulberry32 } from "../helpers/rng.ts";

const WHITE: RGB = [1, 1, 1];
const CMYK = CMYK_HEX.map(hexToLinear);

describe("hullFit", () => {
  it("returns a colour inside the hull unchanged, with the weights that mix it", () => {
    const r = mulberry32(1), palette = [WHITE, ...CMYK];
    for (let i = 0; i < 200; i++) {
      const raw = palette.map(() => r() ** 2), sum = raw.reduce((a, b) => a + b, 0), w = raw.map((x) => x / sum);
      const colour = [0, 1, 2].map((c) => palette.reduce((s, p, j) => s + w[j]! * p[c]!, 0)) as RGB;
      const fit = hullFit(colour, palette);
      expect(fit.distance).toBeLessThan(1e-9);
      expect(fit.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      expect(Math.min(...fit.weights)).toBeGreaterThanOrEqual(0);
      for (let c = 0; c < 3; c++) expect(fit.nearest[c]).toBeCloseTo(colour[c]!, 9);
    }
  });

  it("is never beaten by any other mix (checked against random mixes)", () => {
    const r = mulberry32(2), palette = [WHITE, ...CMYK];
    for (let i = 0; i < 40; i++) {
      const colour: RGB = [r(), r(), r()], fit = hullFit(colour, palette);
      for (let j = 0; j < 300; j++) {
        const raw = palette.map(() => (r() < 0.4 ? 0 : r())), sum = raw.reduce((a, b) => a + b, 0) || 1;
        const mix = [0, 1, 2].map((c) => palette.reduce((s, p, q) => s + (raw[q]! / sum) * p[c]!, 0));
        expect(Math.hypot(mix[0]! - colour[0], mix[1]! - colour[1], mix[2]! - colour[2])).toBeGreaterThanOrEqual(fit.distance - 1e-9);
      }
    }
  });

  it("handles one colour, and colours that are not independent", () => {
    expect(hullFit([0.2, 0.3, 0.4], [WHITE])).toMatchObject({ nearest: [1, 1, 1], weights: [1] });
    // three greys on one line: the answer is on the segment between the outer two
    const fit = hullFit([0.4, 0.4, 0.4], [[0, 0, 0], [0.5, 0.5, 0.5], [1, 1, 1]]);
    expect(fit.distance).toBeLessThan(1e-12);
    expect(() => hullFit([0, 0, 0], [])).toThrow(RangeError);
  });

  it("shows why cyan, magenta and yellow threads cannot make a saturated green or blue (§1)", () => {
    const palette = [WHITE, ...CMYK];
    const residual = (hex: string) => hullFit(hexToLinear(hex), palette).deltaE;
    expect(residual("#00FF00")).toBeGreaterThan(25); // measured 28.0
    expect(residual("#0000FF")).toBeGreaterThan(25); // measured 29.3
    expect(residual("#FF0000")).toBeLessThan(13); // measured 11.0
    expect(residual("#FFFF00")).toBeLessThan(10); // measured 8.1: the yellow thread is close
    expect(residual("#FFE000")).toBeLessThan(1e-6); // a thread's own colour is always reachable
  });
});

describe("clusterColours", () => {
  it("finds the distinct colours of a picture and their shares", () => {
    const res = 60, T = new Float64Array(3 * res * res), mask = new Float64Array(res * res).fill(1);
    const colours: RGB[] = [[0.8, 0.1, 0.1], [0.1, 0.1, 0.7], [0.9, 0.9, 0.9]];
    for (let p = 0; p < res * res; p++) T.set(colours[p % 10 === 0 ? 0 : p % 3 === 0 ? 1 : 2]!, 3 * p);
    const { clusters, labels } = clusterColours(T, mask, 6);
    expect(clusters).toHaveLength(3);
    expect(clusters.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 12);
    for (const colour of colours) {
      const match = clusters.find((c) => deltaE(c.colour, colour) < 1e-6);
      expect(match, colour.join()).toBeDefined();
    }
    expect(clusters.find((c) => deltaE(c.colour, colours[0]!) < 1e-6)!.share).toBeCloseTo(0.1, 2);
    expect(labels[0]).toBe(labels[10]);
    expect(labels[0]).not.toBe(labels[1]);
  });

  it("ignores pixels outside the mask and is deterministic", () => {
    const res = 80, T = colourWheel(res), mask = circleMask(res);
    const a = clusterColours(T, mask, 12), b = clusterColours(T, mask, 12);
    expect(a.clusters).toEqual(b.clusters);
    expect(a.labels[0]).toBe(-1); // a corner is outside the circle
    expect(a.clusters.length).toBeGreaterThanOrEqual(10);
    expect(clusterColours(T, new Float64Array(res * res), 5).clusters).toEqual([]);
  });
});

describe("gamut check and auto palette (§6.3)", () => {
  const res = 120, wheel = colourWheel(res), mask = circleMask(res);

  it("with every colour reachable, nothing is flagged", () => {
    const grey = gamutCheck(face(res), mask, WHITE, [hexToLinear("#111111")]);
    expect(grey.outShare).toBe(0);
    expect(grey.suggestion).toBeNull();
  });

  it("suggests the colour that is missing most, and adding a thread of it helps", () => {
    const report = gamutCheck(wheel, mask, WHITE, CMYK);
    expect(report.outShare).toBeGreaterThan(0.15);
    const s = report.suggestion!;
    expect(s).not.toBeNull();
    const clusters = report.clusters;
    expect(paletteCost(clusters, [WHITE, ...CMYK, s])).toBeLessThan(0.8 * paletteCost(clusters, [WHITE, ...CMYK]));
  });

  it("picks from a list the threads that serve the picture best", () => {
    const { clusters } = clusterColours(wheel, mask, 12);
    const list = ["#D7261E", "#1E9E3E", "#1F4FD1", "#FFE000", "#00A0E0", "#E0007A", "#808080", "#111111"].map(hexToLinear);
    const four = autoPalette(clusters, WHITE, list, 4);
    expect(four).toHaveLength(4);
    expect(new Set(four).size).toBe(4);
    // the greedy choice is at least as good as the benchmark's fixed palette, and each step helped
    expect(paletteCost(clusters, [WHITE, ...four.map((i) => list[i]!)])).toBeLessThanOrEqual(paletteCost(clusters, [WHITE, ...CMYK]) + 1e-9);
    let last = paletteCost(clusters, [WHITE]);
    four.forEach((_, n) => {
      const cost = paletteCost(clusters, [WHITE, ...four.slice(0, n + 1).map((i) => list[i]!)]);
      expect(cost).toBeLessThan(last);
      last = cost;
    });
    // a grey picture needs one dark thread and nothing else
    const greys = clusterColours(face(res), mask, 12).clusters;
    const picked = autoPalette(greys, WHITE, list, 4);
    expect(picked[0]).toBe(7);
    expect(picked.length).toBeLessThanOrEqual(2);
  });
});

describe("the gamut check on a large picture, and what the page gets of it", () => {
  const res = 240, wheel = colourWheel(res), mask = circleMask(res);
  const exact = gamutCheck(wheel, mask, WHITE, CMYK);

  it("finds the same colours on a sample of the pixels", () => {
    const sampled = gamutCheck(wheel, mask, WHITE, CMYK, GAMUT_CLUSTERS, GAMUT_THRESHOLD, 5000);
    expect(sampled.clusters).toHaveLength(exact.clusters.length);
    expect(sampled.clusters.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 12);
    // every group of the exact run has a group of the sampled run close by, of about the same size
    for (const c of exact.clusters) {
      const near = sampled.clusters.reduce((a, b) => (deltaE(b.colour, c.colour) < deltaE(a.colour, c.colour) ? b : a));
      expect(deltaE(near.colour, c.colour)).toBeLessThan(2);
      expect(Math.abs(near.share - c.share)).toBeLessThan(0.01);
    }
    expect(deltaE(sampled.suggestion!, exact.suggestion!)).toBeLessThan(2);
    // every pixel inside the circle has a group, also those the sample skipped
    for (let p = 0; p < mask.length; p++) expect(sampled.labels[p]! >= 0).toBe(mask[p]! > 0);
  });

  it("suggests the thread that helps the whole picture most: a green, then a blue", () => {
    const hue = (c: RGB) => c.indexOf(Math.max(...c));
    expect(hue(exact.suggestion!)).toBe(1);
    const palette = [WHITE, ...CMYK];
    for (const c of exact.clusters) if (c.out) expect(paletteCost(exact.clusters, [...palette, exact.suggestion!])).toBeLessThanOrEqual(paletteCost(exact.clusters, [...palette, c.colour]) + 1e-9);
    const next = gamutCheck(wheel, mask, WHITE, [...CMYK, exact.suggestion!]);
    expect(next.outShare).toBeLessThan(0.7 * exact.outShare);
    expect(hue(next.suggestion!)).toBe(2);
    expect(suggestThread(exact.clusters.map((c) => ({ ...c, out: false })), palette)).toBeNull();
  });

  it("hatches exactly the pixels that are out of reach", () => {
    const rgba = gamutPicture(exact, res);
    expect(rgba.length).toBe(4 * res * res);
    let out = 0, light = 0;
    for (let p = 0; p < res * res; p++) {
      const label = exact.labels[p]!, isOut = label >= 0 && exact.clusters[label]!.out;
      expect(rgba[4 * p + 3]! > 0).toBe(isOut);
      if (isOut) { out++; if (rgba[4 * p] === 255) light++; }
    }
    expect(out / mask.reduce((a, b) => a + b, 0)).toBeCloseTo(exact.outShare, 2);
    expect(light / out).toBeGreaterThan(0.4); // light and dark bands in turn
    expect(light / out).toBeLessThan(0.6);
  });

  it("is summarised for the page as plain data, largest group first", () => {
    const s = summarize(exact);
    expect(s.outShare).toBe(exact.outShare);
    expect(s.suggestion).toEqual(exact.suggestion);
    expect(s.clusters).toHaveLength(exact.clusters.length);
    for (let i = 1; i < s.clusters.length; i++) expect(s.clusters[i - 1]!.share).toBeGreaterThanOrEqual(s.clusters[i]!.share);
    expect(structuredClone(s)).toEqual(s);
    for (const c of s.clusters) expect(c.out).toBe(c.deltaE > GAMUT_THRESHOLD);
  });
});

describe("hueName", () => {
  it("names the pure hues, the benchmark's threads and the colours without hue", () => {
    const name = (hex: string) => hueName(hexToLinear(hex));
    expect(["#FF0000", "#FFA500", "#FFFF00", "#00FF00", "#00FFFF", "#0000FF", "#8000FF", "#FF69B4"].map(name)).toEqual(["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"]);
    // the benchmark's cyan thread is a sky blue by its hue angle, and its magenta a pink
    expect(CMYK_HEX.map(name)).toEqual(["yellow", "blue", "pink", "black"]);
    expect(["#D7261E", "#1E9E3E", "#1F4FD1", "#F2F2F2"].map(name)).toEqual(["red", "green", "blue", "white"]); // the RGB + white preset
    expect(["#FFFFFF", "#808080", "#111111", "#5EFF52", "#3432FF"].map(name)).toEqual(["white", "grey", "black", "green", "blue"]);
  });
});
