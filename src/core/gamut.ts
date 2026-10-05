// Which colours a palette can make (spec §1 "partitive mixing", §6.3 M2). Opaque threads lie side by side, so
// the eye sees a weighted average of the board colour and the thread colours in linear light: the reachable
// colours are the convex hull of those colours. This module finds the nearest reachable colour to a wanted
// one, groups a picture's colours, and from the two answers §6.3's questions: which parts of the picture are
// out of reach (gamut check), which thread would help most, and which K threads of a list serve a picture
// best (auto palette).
import { oklab, type RGB } from "./stringart.ts";

export interface HullFit {
  /** The nearest colour the palette can mix (linear RGB). */
  nearest: RGB;
  /** How much of each palette colour that takes; non-negative, summing to 1. */
  weights: number[];
  /** Distance in linear RGB (what the fit minimises) and Delta-E_OK x 100 between the two colours. */
  distance: number;
  deltaE: number;
}

export const deltaE = (a: RGB, b: RGB): number => {
  const A = oklab(a[0], a[1], a[2]), B = oklab(b[0], b[1], b[2]);
  return 100 * Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};

/** Solves the n x n system A y = b in place (n <= 3) by elimination with pivoting; null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[pivot]![c]!)) pivot = r;
    if (Math.abs(A[pivot]![c]!) < 1e-12) return null;
    [A[c], A[pivot]] = [A[pivot]!, A[c]!];
    [b[c], b[pivot]] = [b[pivot]!, b[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k < n; k++) A[r]![k]! -= f * A[c]![k]!;
      b[r]! -= f * b[c]!;
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < n; k++) s -= A[r]![k]! * y[k]!;
    y[r] = s / A[r]![r]!;
  }
  return y;
}

/**
 * The colour of the palette's convex hull nearest to `colour`, exactly: the nearest point lies in the affine
 * hull of at most four of the colours with non-negative weights, so every subset of one to four colours is
 * tried (98 subsets for seven colours) and the closest valid one kept. This is the "small non-negative
 * least-squares fit" of §6.3 with the weights also summing to 1.
 */
export function hullFit(colour: RGB, palette: readonly RGB[]): HullFit {
  const n = palette.length;
  let best: { d2: number; idx: number[]; w: number[] } | null = null;
  const consider = (idx: number[]) => {
    const v0 = palette[idx[0]!]!, m = idx.length - 1;
    const D = idx.slice(1).map((i) => [palette[i]![0] - v0[0], palette[i]![1] - v0[1], palette[i]![2] - v0[2]]);
    const rhs = [colour[0] - v0[0], colour[1] - v0[1], colour[2] - v0[2]];
    let y: number[] = [];
    if (m > 0) {
      const A = D.map((a) => D.map((b) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!));
      const b = D.map((a) => a[0]! * rhs[0]! + a[1]! * rhs[1]! + a[2]! * rhs[2]!);
      const solved = solve(A, b);
      if (!solved) return; // these colours are not independent: a smaller subset covers the same points
      y = solved;
    }
    const w = [1 - y.reduce((a, c) => a + c, 0), ...y];
    if (w.some((x) => x < -1e-9)) return;
    let d2 = 0;
    for (let c = 0; c < 3; c++) {
      let p = v0[c]!;
      for (let j = 0; j < m; j++) p += y[j]! * D[j]![c]!;
      d2 += (p - colour[c]!) ** 2;
    }
    if (!best || d2 < best.d2 - 1e-15) best = { d2, idx, w };
  };
  for (let a = 0; a < n; a++) {
    consider([a]);
    for (let b = a + 1; b < n; b++) {
      consider([a, b]);
      for (let c = b + 1; c < n; c++) {
        consider([a, b, c]);
        for (let d = c + 1; d < n; d++) consider([a, b, c, d]);
      }
    }
  }
  const found = best as { d2: number; idx: number[]; w: number[] } | null;
  if (!found) throw new RangeError("a palette needs at least one colour");
  const weights = new Array<number>(n).fill(0);
  found.idx.forEach((i, j) => { weights[i] = Math.max(0, found.w[j]!); });
  const nearest: RGB = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) nearest[c]! += weights[i]! * palette[i]![c]!;
  return { nearest, weights, distance: Math.sqrt(found.d2), deltaE: deltaE(nearest, colour) };
}

export interface Cluster {
  /** Mean colour of the cluster (linear RGB) and its position in OKLab. */
  colour: RGB;
  lab: RGB;
  /** Share of the picture's weighted pixels in this cluster, 0..1. */
  share: number;
}

export interface Clustering {
  clusters: Cluster[];
  /** For every pixel the index of its cluster, or -1 outside the mask. */
  labels: Int16Array;
}

/**
 * The picture's colours in k groups: k-means in OKLab over the pixels with a positive mask. Deterministic:
 * the first centre is the pixel nearest the mean colour, every next one the pixel farthest from the centres
 * so far (so small but distinct colours get a group of their own), then at most `iterations` rounds. Every
 * pixel then joins the group whose centre is nearest.
 *
 * With more than `maxSamples` pixels the centres are found on every n-th pixel only (a large picture has no
 * more distinct colours than a small one), which keeps the cost flat; all pixels are still labelled.
 */
export function clusterColours(target: Float64Array, mask: ArrayLike<number>, k: number, iterations = 12, maxSamples = Infinity): Clustering {
  const px = mask.length, inside: number[] = [];
  for (let p = 0; p < px; p++) if (mask[p]! > 0) inside.push(p);
  const labels = new Int16Array(px).fill(-1);
  if (!inside.length) return { clusters: [], labels };
  const stride = Math.max(1, Math.ceil(inside.length / maxSamples)), n = Math.ceil(inside.length / stride), lab = new Float64Array(3 * n);
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const p = inside[i * stride]!, L = oklab(target[3 * p]!, target[3 * p + 1]!, target[3 * p + 2]!);
    lab.set(L, 3 * i);
    for (let c = 0; c < 3; c++) mean[c]! += L[c]! / n;
  }
  const dist2 = (i: number, c: readonly number[]) => (lab[3 * i]! - c[0]!) ** 2 + (lab[3 * i + 1]! - c[1]!) ** 2 + (lab[3 * i + 2]! - c[2]!) ** 2;
  const centres: number[][] = [];
  const nearest = new Float64Array(n).fill(Infinity);
  let seed = 0, bestD = Infinity;
  for (let i = 0; i < n; i++) { const d = dist2(i, mean); if (d < bestD) { bestD = d; seed = i; } }
  for (let j = 0; j < Math.min(k, n); j++) {
    const c = [lab[3 * seed]!, lab[3 * seed + 1]!, lab[3 * seed + 2]!];
    centres.push(c);
    let far = 0, farD = -1;
    for (let i = 0; i < n; i++) {
      const d = Math.min(nearest[i]!, dist2(i, c));
      nearest[i] = d;
      if (d > farD) { farD = d; far = i; }
    }
    if (farD <= 1e-12) break; // fewer distinct colours than k
    seed = far;
  }
  const K = centres.length, own = new Int16Array(n).fill(-1);
  for (let round = 0; round < iterations; round++) {
    let moved = 0;
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let b = 0, bd = Infinity;
      for (let j = 0; j < K; j++) { const d = dist2(i, centres[j]!); if (d < bd) { bd = d; b = j; } }
      if (own[i] !== b) { own[i] = b; moved++; }
      const s = sum[b]!;
      s[0]! += lab[3 * i]!; s[1]! += lab[3 * i + 1]!; s[2]! += lab[3 * i + 2]!; s[3]!++;
    }
    if (!moved) break; // every centre is the mean of its group already
    for (let j = 0; j < K; j++) if (sum[j]![3]! > 0) centres[j] = [sum[j]![0]! / sum[j]![3]!, sum[j]![1]! / sum[j]![3]!, sum[j]![2]! / sum[j]![3]!];
  }
  // every pixel to its nearest centre; a group's colour is the mean of its pixels in linear light
  const acc = centres.map(() => [0, 0, 0, 0]);
  for (const p of inside) {
    const L = oklab(target[3 * p]!, target[3 * p + 1]!, target[3 * p + 2]!);
    let b = 0, bd = Infinity;
    for (let j = 0; j < K; j++) {
      const c = centres[j]!, d = (L[0] - c[0]!) ** 2 + (L[1] - c[1]!) ** 2 + (L[2] - c[2]!) ** 2;
      if (d < bd) { bd = d; b = j; }
    }
    labels[p] = b;
    const a = acc[b]!;
    a[0]! += target[3 * p]!; a[1]! += target[3 * p + 1]!; a[2]! += target[3 * p + 2]!; a[3]!++;
  }
  // empty groups are dropped and the labels renumbered
  const keep: number[] = [];
  acc.forEach((a, j) => { if (a[3]! > 0) keep.push(j); });
  const renumber = new Int16Array(K).fill(-1);
  keep.forEach((j, i) => { renumber[j] = i; });
  for (const p of inside) labels[p] = renumber[labels[p]!]!;
  const clusters = keep.map((j): Cluster => {
    const a = acc[j]!, colour: RGB = [a[0]! / a[3]!, a[1]! / a[3]!, a[2]! / a[3]!];
    return { colour, lab: oklab(colour[0], colour[1], colour[2]), share: a[3]! / inside.length };
  });
  return { clusters, labels };
}

/** Clusters of the gamut check and the threshold above which a colour counts as out of reach (Delta-E x 100). */
export const GAMUT_CLUSTERS = 12;
export const GAMUT_THRESHOLD = 10;
/** Pixels the colour groups are found on; larger pictures are sampled (see clusterColours). */
export const GAMUT_SAMPLES = 20000;

export interface GamutReport {
  clusters: (Cluster & { fit: HullFit; out: boolean })[];
  labels: Int16Array;
  /** Share of the picture that is out of reach. */
  outShare: number;
  /** The colour whose thread would help most (see suggestThread), or null when everything is within reach. */
  suggestion: RGB | null;
}

/** §6.3 "gamut check": which parts of the picture the board and threads cannot mix. */
export function gamutCheck(target: Float64Array, mask: ArrayLike<number>, board: RGB, threads: readonly RGB[], k = GAMUT_CLUSTERS, threshold = GAMUT_THRESHOLD, maxSamples = Infinity): GamutReport {
  const { clusters, labels } = clusterColours(target, mask, k, 12, maxSamples), palette = [board, ...threads];
  let outShare = 0;
  const out = clusters.map((c) => {
    const fit = hullFit(c.colour, palette), isOut = fit.deltaE > threshold;
    if (isOut) outShare += c.share;
    return { ...c, fit, out: isOut };
  });
  return { clusters: out, labels, outShare, suggestion: suggestThread(out, palette) };
}

/**
 * §6.3 "suggest a thread colour to add": among the colours of the groups that are out of reach, the one whose
 * thread brings the palette closest to the whole picture (the lowest paletteCost once it is added). That is
 * not always the group that is farthest out: a thread between two missing colours can serve both.
 */
export function suggestThread(clusters: readonly (Group & { out: boolean })[], palette: readonly RGB[]): RGB | null {
  let best: RGB | null = null, bestCost = Infinity;
  for (const c of clusters) {
    if (!c.out) continue;
    const cost = paletteCost(clusters, [...palette, c.colour]);
    if (cost < bestCost - 1e-12) { bestCost = cost; best = c.colour; }
  }
  return best;
}

/**
 * The out-of-reach parts of a res x res picture as an image to lay over it (sRGB RGBA): diagonal bands, light
 * and dark in turn so that they show on any colour, and clear where the palette can mix the picture's colour.
 */
export function gamutPicture(report: Pick<GamutReport, "clusters" | "labels">, res: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(4 * res * res), band = Math.max(2, Math.round(res / 60));
  for (let y = 0, p = 0; y < res; y++) for (let x = 0; x < res; x++, p++) {
    const label = report.labels[p]!;
    if (label < 0 || !report.clusters[label]!.out) continue;
    const q = 4 * p, light = Math.floor((x + y) / band) % 2 === 0;
    out[q] = out[q + 1] = out[q + 2] = light ? 255 : 0;
    out[q + 3] = light ? 150 : 110;
  }
  return out;
}

/** A colour group as the palette questions need it: its colour (linear RGB) and its share of the picture. */
export type Group = Pick<Cluster, "colour" | "share">;

/** How far a picture's colour groups are from what a palette can mix: the share-weighted mean squared Delta-E. */
export function paletteCost(clusters: readonly Group[], palette: readonly RGB[]): number {
  let cost = 0;
  for (const c of clusters) cost += c.share * hullFit(c.colour, palette).deltaE ** 2;
  return cost;
}

/**
 * §6.3 "auto palette": from `candidates`, greedily the `count` threads that bring the board's reachable
 * colours closest to the picture's colour groups. Returns indices into `candidates`, in the order chosen.
 */
export function autoPalette(clusters: readonly Group[], board: RGB, candidates: readonly RGB[], count: number): number[] {
  const chosen: number[] = [];
  let palette: RGB[] = [board], cost = paletteCost(clusters, palette);
  while (chosen.length < Math.min(count, candidates.length)) {
    let best = -1, bestCost = Infinity;
    candidates.forEach((c, i) => {
      if (chosen.includes(i)) return;
      const next = paletteCost(clusters, [...palette, c]);
      if (next < bestCost - 1e-12) { bestCost = next; best = i; }
    });
    if (best < 0 || bestCost >= cost - 1e-9) break; // nothing left that helps
    chosen.push(best);
    palette = [...palette, candidates[best]!];
    cost = bestCost;
  }
  return chosen;
}

/** What the page keeps of a report: plain data, without the per-pixel labels. */
export interface GamutSummary {
  outShare: number;
  suggestion: RGB | null;
  /** The picture's colour groups, largest first: the colour wanted, the nearest one the palette can mix, how
   * far apart they are (Delta-E x 100) and whether that counts as out of reach. */
  clusters: { colour: RGB; nearest: RGB; share: number; deltaE: number; out: boolean }[];
}

export function summarize(report: GamutReport): GamutSummary {
  const clusters = report.clusters.map((c) => ({ colour: c.colour, nearest: c.fit.nearest, share: c.share, deltaE: c.fit.deltaE, out: c.out }));
  return { outShare: report.outShare, suggestion: report.suggestion, clusters: clusters.sort((a, b) => b.share - a.share) };
}

export const HUES = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink", "white", "grey", "black"] as const;
export type Hue = (typeof HUES)[number];

/**
 * A plain word for a colour, for messages like §9's "This red can't be mixed from these threads": by its hue
 * angle in OKLab, or white, grey or black when it has hardly any colour. The borders lie about midway between
 * the pure hues (red 29 degrees, orange 71, yellow 110, green 142, cyan 195, blue 264, magenta 328).
 */
export function hueName(colour: RGB): Hue {
  const [L, a, b] = oklab(colour[0], colour[1], colour[2]);
  if (Math.hypot(a, b) < 0.04) return L > 0.9 ? "white" : L < 0.35 ? "black" : "grey";
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return h < 10 ? "pink" : h < 50 ? "red" : h < 90 ? "orange" : h < 125 ? "yellow" : h < 170 ? "green" : h < 225 ? "cyan" : h < 285 ? "blue" : h < 335 ? "purple" : "pink";
}
