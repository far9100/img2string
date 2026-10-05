// Small made-up targets for the tests (linear RGB, 3 values per pixel).
import { mulberry32 } from "./rng.ts";

/** A few soft colour blobs on a light ground. */
export function blobs(res: number, seed: number): Float64Array {
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

/**
 * A line drawing: thin dark outlines on white (a circle, an oval, a wavy line and a straight one), each
 * `width` pixels wide with soft edges; about a twentieth of the picture is ink. To the generator this is the
 * hard case: nearly all of it is as light as the board.
 */
export function lineDrawing(res: number, width = res / 100): Float64Array {
  const T = new Float64Array(3 * res * res), c = (res - 1) / 2;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const u = (x - c) / c, v = (y - c) / c;
    // how far the pixel is from the nearest outline, in pixels (near enough to a distance for thin outlines)
    const d = c * Math.min(
      Math.abs(Math.hypot(u + 0.15, v + 0.1) - 0.45),
      Math.abs(Math.hypot((u - 0.3) / 1.5, v - 0.4) - 0.22),
      Math.abs(v + 0.62 - 0.1 * Math.sin(7 * u)),
      Math.abs(u - 0.68),
    );
    const ink = Math.max(0, Math.min(1, 0.5 + width / 2 - d)), p = 3 * (y * res + x);
    T[p] = T[p + 1] = T[p + 2] = 1 - 0.95 * ink;
  }
  return T;
}

/** A grey picture: a dark disc and a dark bar on a light ground. */
export function discAndBar(res: number): Float64Array {
  const T = new Float64Array(3 * res * res), c = (res - 1) / 2;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const u = (x - c) / c, v = (y - c) / c;
    let l = 0.75;
    if ((u + 0.25) ** 2 + (v + 0.2) ** 2 < 0.09) l = 0.03;
    if (Math.abs(v - 0.45) < 0.08 && Math.abs(u) < 0.6) l = 0.05;
    const p = 3 * (y * res + x);
    T[p] = T[p + 1] = T[p + 2] = l;
  }
  return T;
}
