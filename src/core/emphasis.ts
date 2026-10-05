// Automatic importance (spec §6.5 M2 and the M2 "OKLab-weighted objective" experiment, §13.5): factors that
// multiply the weight map W, computed from the target picture itself.
//  - edge emphasis: more weight where the picture's lightness changes quickly, so outlines win over flat areas;
//  - tone emphasis: more weight where the picture is dark. The generator minimises the squared error in linear
//    light, in which a dark detail that comes out mid-grey costs little; the eye, which works roughly with the
//    cube root of the light, sees it as a large error. Weighting a pixel by (T + eps)^(-p) makes the linear
//    error count more like a lightness error there: p = 4/3 is the first-order weight of an OKLab lightness
//    error, since L ~ Y^(1/3) gives dL/dY ~ Y^(-2/3) (DECISIONS D-45 records what it does to a picture).
import { gaussianBlur } from "./image.ts";
import { oklab } from "./stringart.ts";

/** OKLab lightness of every pixel of a linear-RGB image. */
export function lightnessMap(target: Float64Array, px: number): Float64Array {
  const L = new Float64Array(px);
  for (let p = 0; p < px; p++) L[p] = oklab(target[3 * p]!, target[3 * p + 1]!, target[3 * p + 2]!)[0];
  return L;
}

/** Edges are measured on the picture blurred by this share of its width (a Gaussian's sigma), so that an
 * outline is as steep at 1,200 pixels as at 240 and a soft shading is not an edge at any size. */
export const EDGE_BLUR = 1 / 200;
/** The change of OKLab lightness per picture width that counts as a full edge: what a step of 0.2 in lightness
 * (a clear outline) has left after that blur. */
export const EDGE_FULL = 16;

/**
 * Edge strength 0..1 per pixel: the gradient magnitude (Sobel) of the OKLab lightness of the blurred picture,
 * in lightness per picture width, divided by EDGE_FULL and clipped at 1. The scale is fixed, not taken from
 * the picture: a share of the pixels (say the strongest 5 %) is mostly shading on a picture with few outlines,
 * and the fewer the larger the picture, since outlines grow with its side and areas with its square. Border
 * pixels use their nearest neighbours.
 */
export function edgeStrength(target: Float64Array, res: number): Float64Array {
  const px = res * res, L = gaussianBlur(lightnessMap(target, px), res, res, res * EDGE_BLUR, 1, true), g = new Float64Array(px);
  const at = (x: number, y: number) => L[Math.min(res - 1, Math.max(0, y)) * res + Math.min(res - 1, Math.max(0, x))]!;
  const scale = res / (8 * EDGE_FULL); // Sobel sums eight one-pixel differences
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    // as differences of opposite neighbours, so that a flat area gives exactly 0
    const gx = (at(x + 1, y - 1) - at(x - 1, y - 1)) + 2 * (at(x + 1, y) - at(x - 1, y)) + (at(x + 1, y + 1) - at(x - 1, y + 1));
    const gy = (at(x - 1, y + 1) - at(x - 1, y - 1)) + 2 * (at(x, y + 1) - at(x, y - 1)) + (at(x + 1, y + 1) - at(x + 1, y - 1));
    g[y * res + x] = Math.min(1, scale * Math.hypot(gx, gy));
  }
  return g;
}

/** The weight factor of edge emphasis: 1 on flat areas, up to 1 + strength on the strongest edges. */
export function edgeFactor(target: Float64Array, res: number, strength: number): Float64Array {
  const g = edgeStrength(target, res);
  for (let p = 0; p < g.length; p++) g[p] = 1 + strength * g[p]!;
  return g;
}

export const TONE_EPS = 0.05;

/**
 * The weight factor of tone emphasis, (Y + eps)^(-p) with p = amount * 4/3, where Y is the pixel's luminance;
 * scaled so that the factors average 1 over the pixels where `mask` is positive (the total weight, and with it
 * the meaning of the line budget, stays the same). amount 0 gives all ones.
 */
export function toneFactor(target: Float64Array, mask: ArrayLike<number>, amount: number, eps = TONE_EPS): Float64Array {
  const px = mask.length, f = new Float64Array(px).fill(1);
  if (!(amount > 0)) return f;
  const p = (amount * 4) / 3;
  let sum = 0, n = 0;
  for (let i = 0; i < px; i++) {
    const Y = 0.2126 * target[3 * i]! + 0.7152 * target[3 * i + 1]! + 0.0722 * target[3 * i + 2]!;
    f[i] = (Math.max(0, Y) + eps) ** -p;
    if (mask[i]! > 0) { sum += f[i]!; n++; }
  }
  const scale = n && sum > 0 ? n / sum : 1;
  for (let i = 0; i < px; i++) f[i]! *= scale;
  return f;
}

/** `weight` times the factors, as a new array. */
export function applyFactors(weight: Float64Array, ...factors: (Float64Array | null)[]): Float64Array {
  const out = weight.slice();
  for (const f of factors) if (f) for (let p = 0; p < out.length; p++) out[p]! *= f[p]!;
  return out;
}

/**
 * The weight map with the automatic emphasis applied: `edges` (0..2) is the strength of the edge factor and
 * `tone` (0..1) the amount of the tone factor, both computed from `target`, the picture the generator will
 * get. The factors only multiply, so what the brush set to 0 stays 0 and nothing appears outside the circle;
 * with both at 0 the map is returned as it is.
 */
export function emphasizedWeights(weight: Float64Array, target: Float64Array, res: number, edges: number, tone: number): Float64Array {
  if (!(edges > 0) && !(tone > 0)) return weight;
  return applyFactors(weight, edges > 0 ? edgeFactor(target, res, edges) : null, tone > 0 ? toneFactor(target, weight, tone) : null);
}
