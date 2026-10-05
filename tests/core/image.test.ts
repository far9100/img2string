// src/core/image.ts: the sRGB table, 8-bit output and the Gaussian blur.
import { describe, expect, it } from "vitest";
import { gaussianBlur, linearToSrgb8, SRGB_TO_LINEAR, toRgba8 } from "../../src/core/image.ts";
import { hexToLinear, linearToSrgb, srgbToLinear } from "../../src/core/stringart.ts";
import { mulberry32 } from "../helpers/rng.ts";

/** A w x h picture with one value of 1 at (x, y) of channel c. */
function impulse(w: number, h: number, x: number, y: number, channels = 1, c = 0): Float64Array {
  const data = new Float64Array(w * h * channels);
  data[(y * w + x) * channels + c] = 1;
  return data;
}

/** Sum, centre and standard deviation along x and y of one channel, taken as a distribution of mass. */
function moments(data: Float64Array, w: number, h: number, channels = 1, c = 0) {
  let sum = 0, mx = 0, my = 0, vx = 0, vy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = data[(y * w + x) * channels + c]!; sum += v; mx += v * x; my += v * y; }
  mx /= sum; my /= sum;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = data[(y * w + x) * channels + c]!; vx += v * (x - mx) ** 2; vy += v * (y - my) ** 2; }
  return { sum, mx, my, sx: Math.sqrt(vx / sum), sy: Math.sqrt(vy / sum) };
}

describe("sRGB", () => {
  it("the table is srgbToLinear at every byte, so a pixel and a hex colour are the same numbers", () => {
    expect(SRGB_TO_LINEAR).toHaveLength(256);
    for (let i = 0; i < 256; i++) expect(SRGB_TO_LINEAR[i]).toBe(srgbToLinear(i / 255));
    expect(SRGB_TO_LINEAR[0]).toBe(0);
    expect(SRGB_TO_LINEAR[255]).toBe(1);
    for (let i = 1; i < 256; i++) expect(SRGB_TO_LINEAR[i]!).toBeGreaterThan(SRGB_TO_LINEAR[i - 1]!);
    expect(hexToLinear("#1180F3")).toEqual([SRGB_TO_LINEAR[0x11], SRGB_TO_LINEAR[0x80], SRGB_TO_LINEAR[0xf3]]);
  });

  it("linearToSrgb8 undoes the table, rounds to the nearest byte and clamps", () => {
    for (let i = 0; i < 256; i++) expect(linearToSrgb8(SRGB_TO_LINEAR[i]!)).toBe(i);
    expect(linearToSrgb8(0.5)).toBe(188); // 0.5 linear is 0.7354 in sRGB, x 255 = 187.5
    expect(linearToSrgb8(0.2)).toBe(Math.round(255 * linearToSrgb(0.2)));
    expect(linearToSrgb8(-0.3)).toBe(0);
    expect(linearToSrgb8(-0)).toBe(0);
    expect(linearToSrgb8(1.7)).toBe(255);
    expect(linearToSrgb8(Infinity)).toBe(255);
    expect(linearToSrgb8(NaN)).toBe(0);
  });

  it("toRgba8 writes sRGB bytes with full alpha", () => {
    const linear = Float64Array.of(0, 0.5, 1, SRGB_TO_LINEAR[10]!, SRGB_TO_LINEAR[200]!, SRGB_TO_LINEAR[33]!, -1, 2, NaN);
    const out = toRgba8(linear, 3);
    expect(out).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(out)).toEqual([0, 188, 255, 255, 10, 200, 33, 255, 0, 255, 0, 255]);
    // only the first `pixels` pixels are read
    expect(Array.from(toRgba8(linear, 1))).toEqual([0, 188, 255, 255]);
    const r = mulberry32(11), many = new Float64Array(3 * 500).map(() => r());
    const bytes = toRgba8(many, 500);
    for (let p = 0; p < 500; p++) {
      for (let c = 0; c < 3; c++) expect(bytes[4 * p + c]).toBe(linearToSrgb8(many[3 * p + c]!));
      expect(bytes[4 * p + 3]).toBe(255);
    }
  });
});

describe("gaussianBlur", () => {
  it("returns a new array, and a plain copy when sigma is not positive", () => {
    const r = mulberry32(1), data = new Float64Array(12 * 9).map(() => r()), before = data.slice();
    for (const sigma of [0, -2, NaN]) {
      const out = gaussianBlur(data, 12, 9, sigma);
      expect(out).not.toBe(data);
      expect(out).toEqual(data);
    }
    const out = gaussianBlur(data, 12, 9, 1.5);
    expect(out).not.toBe(data);
    expect(out).not.toEqual(data);
    expect(data).toEqual(before); // the input is left alone
  });

  it("keeps a flat picture flat, right up to the edges", () => {
    const w = 23, h = 17, flat = new Float64Array(3 * w * h);
    for (let p = 0; p < w * h; p++) flat.set([0.2, 0.55, 0.9], 3 * p);
    for (const sigma of [0.4, 1, 3.3, 12]) {
      const out = gaussianBlur(flat, w, h, sigma, 3);
      let worst = 0;
      for (let i = 0; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i]! - flat[i]!));
      expect(worst).toBeLessThan(1e-12);
    }
  });

  it("keeps the mean of an impulse away from the edges, centred where it was", () => {
    const w = 61, h = 47, out = gaussianBlur(impulse(w, h, 30, 20), w, h, 2.5);
    const m = moments(out, w, h);
    expect(m.sum).toBeCloseTo(1, 12);
    expect(m.mx).toBeCloseTo(30, 10);
    expect(m.my).toBeCloseTo(20, 10);
    expect(Math.max(...out)).toBe(out[20 * w + 30]);
    for (const v of out) expect(v).toBeGreaterThanOrEqual(0);
    // the same either side of the centre, and along both axes
    expect(out[20 * w + 33]).toBeCloseTo(out[20 * w + 27]!, 15);
    expect(out[23 * w + 30]).toBeCloseTo(out[17 * w + 30]!, 15);
    expect(out[23 * w + 30]).toBeCloseTo(out[20 * w + 33]!, 15);
  });

  it("has the standard deviation it was asked for", () => {
    for (const sigma of [0.8, 1, 1.24, 2, 3.5, 6, 10]) {
      const side = 2 * Math.ceil(3 * sigma) + 21, mid = (side - 1) / 2, out = gaussianBlur(impulse(side, side, mid, mid), side, side, sigma);
      const m = moments(out, side, side);
      // the kernel stops at 3 sigma, which takes up to 1.3 % off
      expect(m.sx / sigma).toBeGreaterThan(0.985);
      expect(m.sx / sigma).toBeLessThan(1.0005);
      expect(m.sy).toBeCloseTo(m.sx, 12);
      // and the shape is the Gaussian's: the value k pixels from the centre along a row is exp(-k^2 / 2 sigma^2) of the centre's
      for (const k of [1, 2, Math.floor(2 * sigma)]) expect(out[mid * side + mid + k]! / out[mid * side + mid]!).toBeCloseTo(Math.exp(-(k * k) / (2 * sigma * sigma)), 12);
    }
    // a wide blur's peak is 1 / (2 pi sigma^2)
    const side = 81, out = gaussianBlur(impulse(side, side, 40, 40), side, side, 5);
    expect(out[40 * side + 40]! * 2 * Math.PI * 25).toBeCloseTo(1, 1);
  });

  it("blurs each channel on its own", () => {
    const w = 31, h = 29, sigma = 1.7;
    const out = gaussianBlur(impulse(w, h, 12, 15, 3, 1), w, h, sigma, 3), single = gaussianBlur(impulse(w, h, 12, 15), w, h, sigma);
    for (let p = 0; p < w * h; p++) {
      expect(out[3 * p]).toBe(0);
      expect(out[3 * p + 1]).toBe(single[p]);
      expect(out[3 * p + 2]).toBe(0);
    }
  });

  it("repeats the edge pixel beyond an edge", () => {
    // a picture that is the same in every row stays so, and likewise for columns: nothing dark creeps in from outside
    const w = 26, h = 14, r = mulberry32(5), profile = Array.from({ length: w }, () => r());
    const rows = new Float64Array(w * h), cols = new Float64Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { rows[y * w + x] = profile[x]!; cols[x * h + y] = profile[x]!; }
    const a = gaussianBlur(rows, w, h, 2.2), b = gaussianBlur(cols, h, w, 2.2);
    for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) {
      expect(a[y * w + x]).toBeCloseTo(a[x]!, 13);
      expect(b[x * h + y]).toBeCloseTo(b[x * h]!, 13);
    }
    // the two are the same blur along the other axis
    for (let x = 0; x < w; x++) expect(b[x * h]).toBeCloseTo(a[x]!, 13);
    // at the left edge the kernel's left half falls on copies of the first pixel
    const step = new Float64Array(w).fill(1, 0, 1), out = gaussianBlur(step, w, 1, 1);
    const k = [0, 1, 2, 3].map((i) => Math.exp(-(i * i) / 2)), total = k[0]! + 2 * (k[1]! + k[2]! + k[3]!);
    expect(out[0]).toBeCloseTo((k[0]! + k[1]! + k[2]! + k[3]!) / total, 13);
    expect(out[1]).toBeCloseTo((k[1]! + k[2]! + k[3]!) / total, 13);
    expect(out[3]).toBeCloseTo(k[3]! / total, 13);
    expect(out[4]).toBe(0);
  });

  it("handles a picture smaller than the kernel", () => {
    const out = gaussianBlur(Float64Array.of(0, 1, 0, 0, 0, 0), 3, 2, 4);
    let sum = 0;
    for (const v of out) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(1); sum += v; }
    expect(Number.isFinite(sum)).toBe(true);
    expect(gaussianBlur(new Float64Array(0), 0, 0, 2)).toHaveLength(0);
  });
});
