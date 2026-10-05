// Small image tools shared by the preprocessing, the previews and the exports: the sRGB transfer curve as a
// table, 8-bit output for the screen, and a separable Gaussian blur (unsharp mask, viewing-distance blur).
// Pictures are linear RGB in 0..1, row-major, unless a function says otherwise.
import { linearToSrgb, srgbToLinear } from "./stringart.ts";

/** sRGB byte -> linear value. Entry i is srgbToLinear(i / 255), the expression hexToLinear uses, so a pixel of
 * colour #RRGGBB is the same three numbers as a board or thread of that colour, bit for bit. */
export const SRGB_TO_LINEAR: Float64Array = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

/** Linear value -> sRGB byte, clamped to 0..255 (anything that is not a number gives 0). */
export function linearToSrgb8(v: number): number {
  return v > 0 ? (v < 1 ? Math.round(255 * linearToSrgb(v)) : 255) : 0;
}

/** The error function, to about 1.5e-7 (Abramowitz and Stegun 7.1.26): enough for blur weights, which are
 * normalised afterwards. */
export function erf(x: number): number {
  const s = x < 0 ? -1 : 1, a = Math.abs(x), t = 1 / (1 + 0.3275911 * a);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return s * (1 - poly * Math.exp(-a * a));
}

/**
 * Separable Gaussian blur of a `width` x `height` picture with `channels` interleaved values per pixel; pixels
 * beyond an edge repeat the edge pixel. Returns a new array; sigma <= 0 returns a copy. The kernel is the
 * Gaussian sampled at whole pixels out to 3 sigma and normalised, so a flat picture stays flat and the mean
 * of the interior is kept; cutting it there makes its standard deviation up to 1.3 % less than sigma. Below
 * about 0.6 pixels the samples are too coarse to follow the curve and the blur is weaker than asked
 * (0.93 sigma at 0.5, 0.29 sigma at 0.3): a blur that small is finer than the pixels it is drawn on.
 *
 * With `integrated`, every weight is the Gaussian's area over that pixel instead of its value at the pixel's
 * centre. That is the blur of a picture whose pixels are little squares of even colour, and it stays right
 * however small sigma is (at 0.3 pixels a neighbour still gets 4.8 % each, where sampling gives 0.4 %): the
 * viewing-distance blur of a render that is coarser than the eye's blur needs this (DECISIONS D-40). From
 * about 0.7 pixels up its standard deviation is sqrt(sigma^2 + 1/12): the pixel's own width is added.
 */
export function gaussianBlur(data: Float64Array, width: number, height: number, sigma: number, channels = 1, integrated = false): Float64Array {
  const out = data.slice();
  if (!(sigma > 0) || width < 1 || height < 1) return out;
  const r = Math.max(1, Math.ceil(3 * sigma + (integrated ? 0.5 : 0))), taps = 2 * r + 1, kernel = new Float64Array(taps);
  let sum = 0;
  if (integrated) {
    const cdf = (x: number) => 0.5 * (1 + erf(x / (sigma * Math.SQRT2)));
    for (let i = 0; i < taps; i++) sum += kernel[i] = cdf(i - r + 0.5) - cdf(i - r - 0.5);
  } else {
    for (let i = 0; i < taps; i++) sum += kernel[i] = Math.exp(-((i - r) ** 2) / (2 * sigma * sigma));
  }
  for (let i = 0; i < taps; i++) kernel[i]! /= sum;

  // along x: each row is copied with r repeated pixels on both sides, so the inner loop has no edge test
  const stride = width * channels, tmp = new Float64Array(data.length), padded = new Float64Array((width + 2 * r) * channels);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = -r; x < width + r; x++) {
      const from = row + Math.min(width - 1, Math.max(0, x)) * channels, to = (x + r) * channels;
      for (let c = 0; c < channels; c++) padded[to + c] = data[from + c]!;
    }
    for (let i = 0; i < stride; i++) {
      let acc = 0;
      for (let k = 0, p = i; k < taps; k++, p += channels) acc += kernel[k]! * padded[p]!;
      tmp[row + i] = acc;
    }
  }
  // along y: whole rows at a time, which keeps the memory access sequential
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    out.fill(0, row, row + stride);
    for (let k = 0; k < taps; k++) {
      const from = Math.min(height - 1, Math.max(0, y + k - r)) * stride, w = kernel[k]!;
      for (let i = 0; i < stride; i++) out[row + i]! += w * tmp[from + i]!;
    }
  }
  return out;
}

/** Linear RGB (3 values per pixel) -> sRGB RGBA bytes for the screen (ImageData) or a PNG; alpha is 255. */
export function toRgba8(linear: Float64Array, pixels: number): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(4 * pixels);
  for (let p = 0, q = 0; p < pixels; p++, q += 4) {
    out[q] = linearToSrgb8(linear[3 * p]!);
    out[q + 1] = linearToSrgb8(linear[3 * p + 1]!);
    out[q + 2] = linearToSrgb8(linear[3 * p + 2]!);
    out[q + 3] = 255;
  }
  return out;
}
