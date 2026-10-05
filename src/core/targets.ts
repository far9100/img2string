// The benchmark targets of spec section 13.2 (the two functions below are the spec's text with "export" added;
// tests/core/specParity.test.ts keeps them identical), and the built-in samples made from them (section 6.1):
// the app ships no photographs. All return linear RGB, 3 values per pixel, row-major.
import { srgbToLinear } from "./stringart.ts";

// --- spec 13.2: begin
export function face(res: number): Float64Array { // grey "portrait-like" test: dark hair cap, eyes, mouth, shaded cheek, light background
  const T = new Float64Array(3 * res * res), c = (res - 1) / 2;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const u = (x - c) / c, v = (y - c) / c;
    let s = 0.92 - 0.25 * (u + 1) / 2;                                       // background gradient (sRGB value)
    const head = (u / 0.62) ** 2 + ((v + 0.05) / 0.8) ** 2;
    if (head < 1) s = 0.8 - 0.35 * Math.max(0, u);                           // face, darker on the right
    if (head < 1.15 && head > 0.75 && v < -0.1) s = 0.12;                     // hair band
    if (((u + 0.24) / 0.12) ** 2 + ((v + 0.12) / 0.06) ** 2 < 1) s = 0.08;   // eyes
    if (((u - 0.24) / 0.12) ** 2 + ((v + 0.12) / 0.06) ** 2 < 1) s = 0.08;
    if (Math.abs(v - 0.38 - 0.25 * u * u) < 0.035 && Math.abs(u) < 0.3) s = 0.15; // mouth
    const p = y * res + x, l = srgbToLinear(s);
    T[3 * p] = T[3 * p + 1] = T[3 * p + 2] = l;
  }
  return T;
}
export function colourWheel(res: number): Float64Array { // hue by angle, fading to white at the centre
  const T = new Float64Array(3 * res * res), c = (res - 1) / 2;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const u = (x - c) / c, v = (y - c) / c, r = Math.min(1, Math.hypot(u, v)), h = (Math.atan2(v, u) / (2 * Math.PI) + 1) % 1;
    const f = (n: number) => { const k = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); };
    const sat = Math.min(1, r * 1.2), p = y * res + x;
    T[3 * p] = srgbToLinear(1 - sat * (1 - f(5))); T[3 * p + 1] = srgbToLinear(1 - sat * (1 - f(3))); T[3 * p + 2] = srgbToLinear(1 - sat * (1 - f(1)));
  }
  return T;
}
// --- spec 13.2: end

/** The third built-in sample: a smooth diagonal ramp from near black to near white (sRGB 0.06 to 0.94). */
export function gradient(res: number): Float64Array {
  const T = new Float64Array(3 * res * res), c = (res - 1) / 2;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const u = (x - c) / c, v = (y - c) / c, p = y * res + x;
    const l = srgbToLinear(0.5 + 0.44 * Math.max(-1, Math.min(1, (u + v) / Math.SQRT2)));
    T[3 * p] = T[3 * p + 1] = T[3 * p + 2] = l;
  }
  return T;
}

export const SAMPLE_IDS = ["face", "colourWheel", "gradient"] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];
export const isSampleId = (v: unknown): v is SampleId => (SAMPLE_IDS as readonly unknown[]).includes(v);

/** A built-in sample at the working resolution. Samples are not cropped or resampled, so they stay exact. */
export function sampleTarget(id: SampleId, res: number): Float64Array {
  return id === "face" ? face(res) : id === "colourWheel" ? colourWheel(res) : gradient(res);
}
