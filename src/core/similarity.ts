// How close a piece is to the picture it was made from, as one number (DECISIONS D-54): 1 is the picture itself
// and 0 the bare board. The generator's own error cannot say this: it is measured against the adjusted target,
// in linear light and pixel by pixel, where a line drawing is "closest" to an almost empty board.
//
// Both pictures are taken as ink: their OKLab colour less the board's, so the bare board is nothing at all. The
// ink is split into six bands, from thread texture to the overall tone (differences of Gaussian blurs, the
// coarsest band keeping the mean), and in every band the two pictures are compared by
//     2 <piece, picture> / (|piece|^2 + |picture|^2),
// which is their correlation times how well their contrasts match: 1 when the band is the same in both, 0 when
// the piece has nothing there or something unrelated, less than the correlation when the piece is fainter or
// harsher than the picture. The bands are weighted as the eye weighs detail of that size.
import { gaussianBlur } from "./image.ts";
import { oklab, type RGB } from "./stringart.ts";

/** The scales are shares of the frame, not pixels: SCALE_SIGMAS are in pixels of a picture this many across. */
export const SCALE_GRID = 400;
/** Gaussian sigmas between the bands: 1/400 of the frame (1.25 mm on a 500 mm frame) and its doublings. */
export const SCALE_SIGMAS: readonly number[] = [1, 2, 4, 8, 16];
/** Weights of the bands, finest first: those of the five scales of MS-SSIM (Wang, Simoncelli and Bovik 2003),
 * which were measured on people; the coarsest band, which holds the overall tone, counts like the one before. */
export const BAND_WEIGHTS: readonly number[] = [0.0448, 0.2856, 0.3001, 0.2363, 0.1333, 0.1333];
/** Mean squared ink below which a band counts as empty in both pictures (a thousandth of the lightness range):
 * two empty bands are alike, and nothing is divided by zero. */
const EMPTY = 1e-6;

/** A picture as ink at every scale. */
export interface Ink {
  /** Pixels across: the picture's own, or fewer when it was averaged down. */
  size: number;
  /** 1 when the picture and the board are grey everywhere (only lightness is kept), else 3 (OKLab). */
  channels: 1 | 3;
  /** How much each pixel counts (0 outside the pin circle). */
  weight: Float64Array;
  /** The ink, then its blur at each of SCALE_SIGMAS; `channels` values per pixel. */
  levels: Float64Array[];
}

/**
 * The ink of a res x res picture (linear RGB, 3 values per pixel) on a board of this colour. `weight` is the
 * importance map as the user painted it: where it is 0 the picture does not count. A picture of 800 pixels or
 * more is first averaged down by a whole factor in linear light, as the eye would sum it: nothing finer than
 * the first scale is compared, and the blurs would otherwise cost as the cube of the size.
 */
export function inkOf(image: ArrayLike<number>, res: number, weight: ArrayLike<number>, board: Readonly<RGB>): Ink {
  const n = Math.max(1, Math.floor(res / SCALE_GRID)), size = Math.ceil(res / n), px = size * size;
  const rgb = new Float64Array(3 * px), w = new Float64Array(px);
  if (n === 1) {
    for (let i = 0; i < 3 * px; i++) rgb[i] = image[i]!;
    for (let p = 0; p < px; p++) w[p] = weight[p]!;
  } else {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, s = 0, count = 0;
      for (let v = y * n, vEnd = Math.min(res, v + n); v < vEnd; v++) for (let u = x * n, uEnd = Math.min(res, u + n); u < uEnd; u++) {
        const q = 3 * (v * res + u);
        r += image[q]!; g += image[q + 1]!; b += image[q + 2]!; s += weight[v * res + u]!; count++;
      }
      const p = y * size + x;
      rgb[3 * p] = r / count; rgb[3 * p + 1] = g / count; rgb[3 * p + 2] = b / count; w[p] = s / count;
    }
  }
  let grey = board[0] === board[1] && board[1] === board[2];
  for (let p = 0; grey && p < px; p++) if (w[p]! > 0 && (rgb[3 * p] !== rgb[3 * p + 1] || rgb[3 * p + 1] !== rgb[3 * p + 2])) grey = false;
  const channels = grey ? 1 : 3, ink = new Float64Array(channels * px), base = oklab(board[0], board[1], board[2]);
  for (let p = 0; p < px; p++) {
    if (!(w[p]! > 0)) continue;
    const c = oklab(rgb[3 * p]!, rgb[3 * p + 1]!, rgb[3 * p + 2]!);
    for (let k = 0; k < channels; k++) ink[channels * p + k] = c[k]! - base[k]!;
  }
  const levels: Float64Array[] = [ink];
  for (const sigma of SCALE_SIGMAS) levels.push(gaussianBlur(ink, size, size, (sigma * size) / SCALE_GRID, channels, true));
  return { size, channels, weight: w, levels };
}

export interface Similarity {
  /** The weighted mean of the bands: 1 for the picture itself, about 0 for the bare board. */
  value: number;
  /** Each band, finest first: thread texture, then detail of about 1/200, 1/100, 1/50 and 1/25 of the frame,
   * then the overall tone. */
  bands: number[];
}

/** How alike two pictures of the same size are, counted by the picture's weight map. */
export function similarity(piece: Ink, picture: Ink): Similarity {
  if (piece.size !== picture.size || piece.levels.length !== picture.levels.length) throw new RangeError("the two pictures must have the same size");
  const px = picture.size * picture.size, weight = picture.weight, ca = piece.channels, cb = picture.channels, count = picture.levels.length;
  let total = 0;
  for (let p = 0; p < px; p++) total += weight[p]!;
  const bands: number[] = [];
  let value = 0, weights = 0;
  for (let j = 0; j < count; j++) {
    const a = piece.levels[j]!, b = picture.levels[j]!, a2 = j + 1 < count ? piece.levels[j + 1]! : null, b2 = j + 1 < count ? picture.levels[j + 1]! : null;
    let aa = 0, bb = 0, ab = 0;
    for (let p = 0; p < px; p++) {
      const wt = weight[p]!;
      if (!(wt > 0)) continue;
      for (let k = 0; k < 3; k++) {
        const u = k < ca ? a[ca * p + k]! - (a2 ? a2[ca * p + k]! : 0) : 0, v = k < cb ? b[cb * p + k]! - (b2 ? b2[cb * p + k]! : 0) : 0;
        aa += wt * u * u; bb += wt * v * v; ab += wt * u * v;
      }
    }
    const band = total > 0 ? ((2 * ab) / total + EMPTY) / ((aa + bb) / total + EMPTY) : 1;
    bands.push(band);
    value += BAND_WEIGHTS[j]! * band;
    weights += BAND_WEIGHTS[j]!;
  }
  return { value: value / weights, bands };
}
