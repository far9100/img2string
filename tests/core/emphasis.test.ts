// Automatic importance: edges (§6.5 M2) and tone (the OKLab-weighted objective experiment of §13.5).
import { describe, expect, it } from "vitest";
import { applyFactors, EDGE_BLUR, EDGE_FULL, edgeFactor, edgeStrength, emphasizedWeights, toneFactor } from "../../src/core/emphasis.ts";
import { circleMask } from "../../src/core/stringart.ts";
import { colourWheel, face, gradient } from "../../src/core/targets.ts";

const flat = (res: number, v: number) => new Float64Array(3 * res * res).fill(v);

describe("edge emphasis", () => {
  it("is zero on a flat picture and full along a hard edge", () => {
    const res = 200;
    expect(edgeStrength(flat(res, 0.4), res).reduce((a, b) => Math.max(a, b), 0)).toBe(0);
    const T = flat(res, 0.8);
    for (let y = 0; y < res; y++) for (let x = 0; x < 100; x++) T.fill(0.05, 3 * (y * res + x), 3 * (y * res + x) + 3);
    const g = edgeStrength(T, res);
    expect(g[50 * res + 99]).toBe(1); // on the edge
    expect(g[50 * res + 100]).toBe(1);
    expect(g[50 * res + 80]).toBe(0); // well inside either side
    expect(g[50 * res + 130]).toBe(0);
    const f = edgeFactor(T, res, 1.5);
    expect(f[50 * res + 99]).toBe(2.5);
    expect(f[50 * res + 80]).toBe(1);
  });

  it("counts an edge by how much the lightness changes: a step of 0.2 is a full edge, a fainter one less", () => {
    const res = 400, step = (dL: number) => {
      // two greys whose OKLab lightness (the cube root of a grey's luminance) differs by dL
      const T = flat(res, 0.5 ** 3);
      for (let y = 0; y < res; y++) for (let x = 200; x < res; x++) T.fill((0.5 + dL) ** 3, 3 * (y * res + x), 3 * (y * res + x) + 3);
      return edgeStrength(T, res)[200 * res + 200]!;
    };
    expect(step(0.2)).toBeGreaterThan(0.93);
    expect(step(0.2)).toBeLessThanOrEqual(1);
    expect(step(0.1)).toBeCloseTo(step(0.2) / 2, 2);
    expect(step(0.4)).toBe(1);
    expect(EDGE_FULL * EDGE_BLUR * Math.sqrt(2 * Math.PI)).toBeCloseTo(0.2, 2); // where the 0.2 comes from
  });

  it("is the same at every size of the picture, and soft shading is not an edge at any", () => {
    const share = (res: number, least: number) => {
      const g = edgeStrength(face(res), res), mask = circleMask(res);
      let n = 0, inside = 0;
      for (let p = 0; p < g.length; p++) if (mask[p]) { inside++; if (g[p]! >= least) n++; }
      return n / inside;
    };
    // the outlines of the face sample are the same share of the picture at 240, 400 and 800 pixels
    for (const res of [240, 800]) expect(Math.abs(share(res, 0.5) - share(400, 0.5))).toBeLessThan(0.01);
    expect(share(400, 0.5)).toBeGreaterThan(0.05);
    expect(share(400, 0.5)).toBeLessThan(0.12);
    // the colour wheel and the gradient sample have no outlines at all
    for (const res of [120, 400]) {
      expect(edgeStrength(colourWheel(res), res).reduce((a, b) => Math.max(a, b), 0)).toBeLessThan(0.15);
      expect(edgeStrength(gradient(res), res).reduce((a, b) => Math.max(a, b), 0)).toBeLessThan(0.1);
    }
  });

  it("marks the features of the face sample, not its smooth areas", () => {
    const res = 160, g = edgeStrength(face(res), res), c = (res - 1) / 2;
    const at = (u: number, v: number) => g[Math.round(c + v * c) * res + Math.round(c + u * c)]!;
    // the outline of an eye is an edge; the middle of the cheek and of the background are not
    let eye = 0;
    for (let x = -0.4; x <= -0.08; x += 0.005) eye = Math.max(eye, at(x, -0.12));
    expect(eye).toBe(1);
    expect(at(0, 0.15)).toBeLessThan(0.1);
    expect(at(-0.85, 0.3)).toBeLessThan(0.1);
  });
});

describe("tone emphasis", () => {
  it("does nothing at amount 0 and keeps the total weight otherwise", () => {
    const res = 120, T = face(res), mask = circleMask(res);
    expect(Array.from(toneFactor(T, mask, 0)).every((v) => v === 1)).toBe(true);
    const f = toneFactor(T, mask, 1);
    let sum = 0, n = 0;
    for (let p = 0; p < mask.length; p++) if (mask[p]) { sum += f[p]!; n++; }
    expect(sum / n).toBeCloseTo(1, 10);
  });

  it("weights dark pixels more, by (Y + eps)^(-4/3) at full amount", () => {
    const res = 8, T = flat(res, 0.6), mask = new Float64Array(res * res).fill(1);
    T.fill(0.01, 0, 3); // one dark pixel
    const f = toneFactor(T, mask, 1);
    expect(f[0]! / f[1]!).toBeCloseTo(((0.01 + 0.05) / (0.6 + 0.05)) ** (-4 / 3), 10);
    const half = toneFactor(T, mask, 0.5);
    expect(half[0]! / half[1]!).toBeCloseTo(((0.01 + 0.05) / (0.6 + 0.05)) ** (-2 / 3), 10);
    expect(f[0]!).toBeGreaterThan(half[0]!);
  });

  it("combines with the weight map by multiplication, leaving 0 at 0", () => {
    const W = Float64Array.from([0, 1, 0.2, 3]);
    expect(Array.from(applyFactors(W, Float64Array.from([5, 2, 2, 0.5]), null, Float64Array.from([1, 3, 1, 1])))).toEqual([0, 6, 0.4, 1.5]);
    expect(Array.from(W)).toEqual([0, 1, 0.2, 3]);
  });
});

describe("the weight map with emphasis", () => {
  const res = 120, T = face(res), W = circleMask(res);

  it("is the map itself when both are off", () => {
    expect(emphasizedWeights(W, T, res, 0, 0)).toBe(W);
  });

  it("multiplies the edge and the tone factors in, and never adds weight where there was none", () => {
    const painted = W.slice();
    painted.fill(0, 0, 40 * res); // the brush set the top of the picture to 0
    const out = emphasizedWeights(painted, T, res, 1.5, 1);
    const edges = edgeFactor(T, res, 1.5), tone = toneFactor(T, painted, 1);
    for (let p = 0; p < out.length; p++) expect(out[p]).toBe(painted[p]! * edges[p]! * tone[p]!);
    expect(Math.max(...out.subarray(0, 40 * res))).toBe(0);
    expect(Array.from(painted)).toEqual(Array.from(W).map((v, p) => (p < 40 * res ? 0 : v))); // the input is not changed
    // the tone factor averages 1 over what counts, so the total weight is that of the edge emphasis alone
    const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0);
    expect(sum(emphasizedWeights(painted, T, res, 0, 1)) / sum(painted)).toBeCloseTo(1, 10);
    // the eyes weigh more than the cheek with either emphasis
    const c = (res - 1) / 2, at = (a: Float64Array, u: number, v: number) => a[Math.round(c + v * c) * res + Math.round(c + u * c)]!;
    expect(at(emphasizedWeights(W, T, res, 0, 1), -0.24, -0.12)).toBeGreaterThan(3 * at(emphasizedWeights(W, T, res, 0, 1), 0, 0.15));
  });
});
