// Reference core for img2string: image -> string art (one continuous thread per colour).
// Image model: every thread layer is an opaque, partially covering layer; layers are
// composited "over" each other in winding order (index 0 is wound first = bottom).

export type RGB = [number, number, number]; // linear RGB, 0..1

export const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
export function hexToLinear(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

export interface Options {
  res: number;            // working resolution: pixels across the frame diameter
  pins: number;           // pins evenly spaced on the circle
  diameterMm: number;     // frame (pin circle) diameter
  threadWidthMm: number;  // effective thread width
  board: RGB;             // board colour
  threads: RGB[];         // thread colours in winding order (0 = wound first = bottom layer)
  maxLines: number[];     // line budget per thread
  minSkip: number;        // minimum circular distance (in pins) between consecutive pins
  allowRepeat: boolean;   // may one thread use the same pin pair more than once
}

export interface Line { idx: Int32Array; w: Float64Array }
export interface Result { sequences: number[][]; error: number; initialError: number; lines: number }

/** Pixel centres are at integer coordinates. Pin 0 is at the top; numbering runs clockwise as seen from the front. */
export function pinPositions(pins: number, res: number): Float64Array {
  const c = (res - 1) / 2, r = (res - 1) / 2;
  const P = new Float64Array(2 * pins);
  for (let i = 0; i < pins; i++) {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / pins; // y axis points down, so increasing t is clockwise on screen
    P[2 * i] = c + r * Math.cos(t);
    P[2 * i + 1] = c + r * Math.sin(t);
  }
  return P;
}

export const pixelMm = (o: Options) => o.diameterMm / (o.res - 1);
export const coverageAlpha = (o: Options) => o.threadWidthMm / pixelMm(o);
export const circDist = (a: number, b: number, n: number) => { const d = Math.abs(a - b) % n; return Math.min(d, n - d); };
export const chordMm = (a: number, b: number, o: Options) => o.diameterMm * Math.sin((Math.PI * circDist(a, b, o.pins)) / o.pins);

/**
 * Coverage raster of a straight thread: one sample per pixel along the major axis, split between the two
 * nearest pixels on the minor axis. Each sample carries alpha * sqrt(1 + slope^2) (thread width x length),
 * so the weights sum to about alpha * length. No pixel appears twice.
 */
export function rasterLine(res: number, alpha: number, x0: number, y0: number, x1: number, y1: number): Line {
  const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
  let a0 = steep ? y0 : x0, a1 = steep ? y1 : x1, b0 = steep ? x0 : y0, b1 = steep ? x1 : y1;
  if (a1 < a0) { let t = a0; a0 = a1; a1 = t; t = b0; b0 = b1; b1 = t; }
  const slope = a1 === a0 ? 0 : (b1 - b0) / (a1 - a0);
  const per = alpha * Math.sqrt(1 + slope * slope);
  const start = Math.ceil(a0), end = Math.floor(a1);
  const idx = new Int32Array(2 * Math.max(0, end - start + 1)), w = new Float64Array(idx.length);
  let k = 0;
  for (let a = start; a <= end; a++) {
    const b = b0 + slope * (a - a0), bf = Math.floor(b), f = b - bf;
    if (1 - f > 0 && bf >= 0 && bf < res) { idx[k] = steep ? a * res + bf : bf * res + a; w[k++] = per * (1 - f); }
    if (f > 0 && bf + 1 >= 0 && bf + 1 < res) { idx[k] = steep ? a * res + bf + 1 : (bf + 1) * res + a; w[k++] = per * f; }
  }
  return { idx: idx.subarray(0, k), w: w.subarray(0, k) };
}

export class Model {
  readonly o: Options;
  readonly T: Float64Array;          // target colour, linear RGB, 3 per pixel
  readonly Wt: Float64Array;         // importance weight per pixel (0 outside the circle)
  readonly K: number;
  readonly px: number;
  readonly C: Float64Array;          // composite colour, 3 per pixel
  readonly a: Float64Array[];        // coverage of each layer
  readonly below: Float64Array[];    // composite of layers < k over the board, 3 per pixel
  readonly U: Float64Array[];        // transmittance of all layers above k
  constructor(o: Options, T: Float64Array, Wt: Float64Array) {
    this.o = o; this.T = T; this.Wt = Wt;
    this.K = o.threads.length;
    this.px = o.res * o.res;
    this.C = new Float64Array(3 * this.px);
    this.a = Array.from({ length: this.K }, () => new Float64Array(this.px));
    this.below = Array.from({ length: this.K }, () => new Float64Array(3 * this.px));
    this.U = Array.from({ length: this.K }, () => new Float64Array(this.px).fill(1));
    for (let p = 0; p < this.px; p++) this.recompute(p);
  }
  /** Rebuild the caches of one pixel from the layer coverages (forward pass for below/C, backward pass for U). */
  recompute(p: number): void {
    const { board, threads } = this.o;
    let r = board[0], g = board[1], b = board[2];
    for (let k = 0; k < this.K; k++) {
      const B = this.below[k]; B[3 * p] = r; B[3 * p + 1] = g; B[3 * p + 2] = b;
      const ak = this.a[k][p], c = threads[k];
      r = ak * c[0] + (1 - ak) * r; g = ak * c[1] + (1 - ak) * g; b = ak * c[2] + (1 - ak) * b;
    }
    this.C[3 * p] = r; this.C[3 * p + 1] = g; this.C[3 * p + 2] = b;
    let u = 1;
    for (let k = this.K - 1; k >= 0; k--) { this.U[k][p] = u; u *= 1 - this.a[k][p]; }
  }
  /**
   * Exact decrease of the weighted squared error if the line is added to layer k.
   * Adding coverage w changes a_k by w(1 - a_k) and the composite by
   * dC = w(1 - a_k) * U_k * (c_k - below_k); the composite is affine in a_k, so this is exact.
   */
  gain(k: number, L: Line): number {
    const ak = this.a[k], Uk = this.U[k], Bk = this.below[k], c = this.o.threads[k], C = this.C, T = this.T, Wt = this.Wt;
    let g = 0;
    for (let i = 0; i < L.idx.length; i++) {
      const p = L.idx[i], wt = Wt[p];
      if (wt === 0) continue;
      const s = L.w[i] * (1 - ak[p]) * Uk[p], q = 3 * p;
      const d0 = s * (c[0] - Bk[q]), d1 = s * (c[1] - Bk[q + 1]), d2 = s * (c[2] - Bk[q + 2]);
      g -= wt * (2 * ((C[q] - T[q]) * d0 + (C[q + 1] - T[q + 1]) * d1 + (C[q + 2] - T[q + 2]) * d2) + d0 * d0 + d1 * d1 + d2 * d2);
    }
    return g;
  }
  apply(k: number, L: Line): void {
    const ak = this.a[k];
    for (let i = 0; i < L.idx.length; i++) {
      const p = L.idx[i];
      ak[p] += L.w[i] * (1 - ak[p]);
      this.recompute(p);
    }
  }
  error(): number {
    let e = 0;
    for (let p = 0; p < this.px; p++) {
      const q = 3 * p, wt = this.Wt[p];
      if (wt) e += wt * ((this.C[q] - this.T[q]) ** 2 + (this.C[q + 1] - this.T[q + 1]) ** 2 + (this.C[q + 2] - this.T[q + 2]) ** 2);
    }
    return e;
  }
}

/** Weight map: 1 inside the pin circle, 0 outside (multiply by a user importance map if any). */
export function circleMask(res: number): Float64Array {
  const W = new Float64Array(res * res), c = (res - 1) / 2, r2 = ((res - 1) / 2) ** 2;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) if ((x - c) ** 2 + (y - c) ** 2 <= r2) W[y * res + x] = 1;
  return W;
}

/**
 * Greedy generation. Every thread is one continuous path: it starts with the best single line for that thread,
 * then always continues from its current pin. Each step evaluates the best next line of every thread that still has
 * budget and keeps the single best (thread, line) pair. Stops when no line lowers the error or all budgets are spent.
 */
export function generate(o: Options, target: Float64Array, weight: Float64Array, onProgress?: (lines: number) => void): Result {
  const N = o.pins, P = pinPositions(N, o.res), alpha = coverageAlpha(o);
  const line = (u: number, v: number) => rasterLine(o.res, alpha, P[2 * u], P[2 * u + 1], P[2 * v], P[2 * v + 1]);
  const key = (u: number, v: number) => (u < v ? u * N + v : v * N + u);
  const model = new Model(o, target, weight);
  const initialError = model.error();
  const seq: number[][] = o.threads.map(() => []);
  const used = o.threads.map(() => new Set<number>());
  const cur: number[] = [];
  let lines = 0;
  for (let k = 0; k < model.K; k++) {
    let best = 0, bu = -1, bv = -1;
    for (let u = 0; u < N; u++) for (let v = u + 1; v < N; v++) {
      if (circDist(u, v, N) < o.minSkip) continue;
      const g = model.gain(k, line(u, v));
      if (g > best) { best = g; bu = u; bv = v; }
    }
    cur.push(bu);
    if (bu >= 0 && o.maxLines[k] > 0) {
      model.apply(k, line(bu, bv)); seq[k].push(bu, bv); used[k].add(key(bu, bv)); cur[k] = bv; lines++;
    }
  }
  for (;;) {
    let best = 0, bk = -1, bv = -1;
    for (let k = 0; k < model.K; k++) {
      const u = cur[k];
      if (u < 0 || seq[k].length - 1 >= o.maxLines[k]) continue;
      for (let v = 0; v < N; v++) {
        if (circDist(u, v, N) < o.minSkip) continue;
        if (!o.allowRepeat && used[k].has(key(u, v))) continue;
        const g = model.gain(k, line(u, v));
        if (g > best) { best = g; bk = k; bv = v; }
      }
    }
    if (bk < 0) break;
    const u = cur[bk];
    model.apply(bk, line(u, bv));
    seq[bk].push(bv); used[bk].add(key(u, bv)); cur[bk] = bv; lines++;
    if (onProgress && lines % 500 === 0) onProgress(lines);
  }
  return { sequences: seq, error: model.error(), initialError, lines };
}

/** Thread needed for one sequence: chords plus a wrap allowance per pin (half the pin circumference). */
export function threadLengthMm(seq: number[], o: Options, pinDiameterMm = 1.5): number {
  let L = 0;
  for (let i = 1; i < seq.length; i++) L += chordMm(seq[i - 1], seq[i], o) + (Math.PI * pinDiameterMm) / 2;
  return L;
}

/** OKLab (Ottosson) from linear sRGB; Delta-E_OK is the Euclidean distance. */
export function oklab(r: number, g: number, b: number): RGB {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
