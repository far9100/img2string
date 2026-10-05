// Picture -> target and importance map (spec §6.1, §6.2, §6.4, §6.5): the crop onto the working grid, the
// adjustments, and the weights W of §4.5. Pure functions over typed arrays, so the same code runs in a worker
// and in the Node tests. Targets are linear RGB, 3 values per pixel, row-major (see strokes.ts for coordinates).
import { gaussianBlur, SRGB_TO_LINEAR } from "./image.ts";
import { NEUTRAL_ADJUST, type Adjust, type Crop, type ImportancePreset, type Mode, type Stroke } from "./project.ts";
import { circleMask, linearToSrgb, oklab, srgbToLinear, type RGB } from "./stringart.ts";
import { cropTransform, paintStrokes } from "./strokes.ts";

/** A decoded picture: sRGB bytes with straight alpha, 4 per pixel, row 0 at the top. */
export interface Source { width: number; height: number; rgba: Uint8Array | Uint8ClampedArray }

/** The picture seen through a crop and laid on the board: 3 * res * res linear RGB. */
export type Cropper = (crop: Crop, res: number, board: RGB) => Float64Array;

/** The picture shrunk by a whole factor: linear RGBA with the colour already multiplied by alpha. */
interface Level { n: number; w: number; h: number; data: Float64Array }

/** A ratio this close above a whole number counts as that number: a crop meant to map pixels one to one (or
 * n to one) must not fall on the other side through rounding in the caller's arithmetic. */
const SNAP = 1e-9;

/**
 * Every pixel of the result is the mean of an n x n block of the picture, in linear light and weighted by
 * alpha. Blocks start at the top left corner; where the last ones hang over the right or bottom edge the
 * missing pixels count as transparent, as everything outside the picture does.
 */
function shrink(source: Source, n: number): Level {
  const { width, height, rgba } = source, w = Math.ceil(width / n), h = Math.ceil(height / n), data = new Float64Array(4 * w * h);
  for (let y = 0; y < height; y++) {
    const row = 4 * w * Math.floor(y / n);
    for (let x = 0, o = row; x < width; o += 4) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const end = Math.min(width, x + n); x < end; x++) {
        const q = 4 * (y * width + x), alpha = rgba[q + 3]!;
        if (alpha === 0) continue;
        const f = alpha === 255 ? 1 : alpha / 255;
        r += f * SRGB_TO_LINEAR[rgba[q]!]!;
        g += f * SRGB_TO_LINEAR[rgba[q + 1]!]!;
        b += f * SRGB_TO_LINEAR[rgba[q + 2]!]!;
        a += f;
      }
      data[o]! += r;
      data[o + 1]! += g;
      data[o + 2]! += b;
      data[o + 3]! += a;
    }
  }
  for (let i = 0; i < data.length; i++) data[i]! /= n * n;
  return { n, w, h, data };
}

/**
 * Prepares a picture for cropping. With k picture pixels per working pixel, a crop first shrinks the picture by
 * n = floor(k) (at least 1) with box averages, then reads it with bilinear interpolation between pixel centres;
 * when the remaining ratio k / n is above 1, each working pixel is the mean of 2 x 2 such readings a quarter
 * pixel either side of its centre. All of it in linear light with the colour multiplied by alpha, and
 * transparent outside the picture, so the board shows through there and the picture's edge is antialiased:
 * T = colour x alpha + (1 - alpha) x board.
 *
 * The shrunk picture of the last n is kept, so panning and turning cost only the res x res readings; a new n
 * (zooming past a whole ratio) costs one pass over the picture. Nothing the size of the picture is allocated:
 * at n = 1 the bytes are read through the sRGB table directly. The result depends only on the arguments, never
 * on what was cropped before. `source.rgba` must hold 4 x width x height bytes and must not change afterwards.
 */
export function makeCropper(source: Source): Cropper {
  const { width, height, rgba } = source;
  if (rgba.length < 4 * width * height) throw new RangeError(`a ${width} x ${height} picture needs ${4 * width * height} bytes, got ${rgba.length}`);
  let level: Level | null = null;
  return (crop, res, board) => {
    const t = cropTransform(crop, width, height, res), out = new Float64Array(3 * res * res);
    let n = Math.floor(t.k + SNAP);
    if (!(n >= 1)) n = 1;
    n = Math.min(n, Math.max(1, width, height));
    if (n > 1 && level?.n !== n) level = shrink(source, n);
    const data = n > 1 ? level!.data : null, w = n > 1 ? level!.w : width, h = n > 1 ? level!.h : height;
    // readings per side of a working pixel, and where the first one sits relative to the pixel's centre
    const side = t.k / n > 1 + SNAP ? 2 : 1, first = side === 2 ? -0.25 : 0, share = 1 / (side * side);
    for (let y = 0, o = 0; y < res; y++) {
      for (let x = 0; x < res; x++, o += 3) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let ty = 0; ty < side; ty++) {
          for (let tx = 0; tx < side; tx++) {
            // the reading point in the shrunk picture, measured from the centre of its first pixel
            const dx = x - t.c + first + 0.5 * tx, dy = y - t.c + first + 0.5 * ty;
            const u = (t.x0 + t.k * (dx * t.cos + dy * t.sin)) / n - 0.5, v = (t.y0 + t.k * (dy * t.cos - dx * t.sin)) / n - 0.5;
            const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
            if (!(i0 >= -1 && j0 >= -1 && i0 < w && j0 < h)) continue; // all four neighbours are outside the picture
            for (let m = 0; m < 4; m++) {
              const i = i0 + (m & 1), j = j0 + (m >> 1), weight = (m & 1 ? fu : 1 - fu) * (m >> 1 ? fv : 1 - fv);
              if (!(weight > 0) || i < 0 || j < 0 || i >= w || j >= h) continue;
              const q = 4 * (j * w + i);
              if (data) {
                r += weight * data[q]!;
                g += weight * data[q + 1]!;
                b += weight * data[q + 2]!;
                a += weight * data[q + 3]!;
              } else {
                const alpha = rgba[q + 3]!, f = alpha === 255 ? weight : (weight * alpha) / 255;
                r += f * SRGB_TO_LINEAR[rgba[q]!]!;
                g += f * SRGB_TO_LINEAR[rgba[q + 1]!]!;
                b += f * SRGB_TO_LINEAR[rgba[q + 2]!]!;
                a += f;
              }
            }
          }
        }
        const through = 1 - a * share;
        out[o] = r * share + through * board[0];
        out[o + 1] = g * share + through * board[1];
        out[o + 2] = b * share + through * board[2];
      }
    }
    return out;
  };
}

export interface Palette { mode: Mode; board: RGB; threads: readonly RGB[] }

/** Rec. 709 luminance of linear RGB. A grey is its own luminance exactly (the three weights do not sum to
 * exactly 1 in floating point), so a grey picture goes through the luminance steps below unchanged. */
const luminance = (r: number, g: number, b: number): number => (r === g && g === b ? r : 0.2126 * r + 0.7152 * g + 0.0722 * b);
const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);

/**
 * The adjustments of §6.4 on a target of res x res pixels, in this order; a step whose setting is neutral is
 * skipped entirely, and the tone steps (1 to 5) work on sRGB-encoded values, where the sliders feel even:
 *  1. invert: s = 1 - s
 *  2. brightness: s = s + brightness
 *  3. contrast: s = 0.5 + (s - 0.5)(1 + contrast)
 *  4. gamma: s = clamp(s) ^ (1 / gamma), so a gamma above 1 lightens the mid tones
 *  5. unsharp mask: s = s + unsharp x (s - blur(s)), the blur a Gaussian of sigma = res / 40
 *     then s is clamped to 0..1 and decoded to linear light
 *  6. colour mode, saturation: with Y the luminance, RGB = Y + saturation x (RGB - Y), clamped;
 *     mono mode: the picture is laid on the palette's lightness axis. With lo and hi the darkest and the
 *     lightest colour among the board and the threads, a pixel becomes the colour between lo and hi that has
 *     its luminance, or lo or hi itself when the picture is darker or lighter than the palette can show
 *  7. range compression (D-15): T = board + c (T - board)
 * Returns a new array. With neutral settings in colour mode the values are unchanged bit for bit, and so is a
 * grey picture in mono mode with a black thread on a white board.
 */
export function adjustTarget(target: Float64Array, res: number, adjust: Adjust, palette: Palette): Float64Array {
  const out = target.slice(), { brightness, contrast, gamma, unsharp, saturation, rangeCompression } = adjust, board = palette.board;
  const curve = gamma > 0 && gamma !== 1;
  if (adjust.invert || brightness !== 0 || contrast !== 0 || curve || unsharp !== 0) {
    for (let i = 0; i < out.length; i++) {
      let s = linearToSrgb(out[i]!);
      if (adjust.invert) s = 1 - s;
      if (brightness !== 0) s += brightness;
      if (contrast !== 0) s = 0.5 + (s - 0.5) * (1 + contrast);
      if (curve) s = clamp01(s) ** (1 / gamma);
      out[i] = s;
    }
    if (unsharp !== 0) {
      const soft = gaussianBlur(out, res, res, res / 40, 3);
      for (let i = 0; i < out.length; i++) out[i]! += unsharp * (out[i]! - soft[i]!);
    }
    for (let i = 0; i < out.length; i++) out[i] = srgbToLinear(clamp01(out[i]!));
  }
  if (palette.mode === "colour") {
    if (saturation !== 1) {
      for (let q = 0; q < out.length; q += 3) {
        const y = luminance(out[q]!, out[q + 1]!, out[q + 2]!);
        for (let c = 0; c < 3; c++) out[q + c] = clamp01(y + saturation * (out[q + c]! - y));
      }
    }
  } else {
    // ties go to the board, then to the earlier thread
    let lo: Readonly<RGB> = board, hi: Readonly<RGB> = board, yLo = luminance(board[0], board[1], board[2]), yHi = yLo;
    for (const t of palette.threads) {
      const y = luminance(t[0], t[1], t[2]);
      if (y < yLo) { lo = t; yLo = y; }
      if (y > yHi) { hi = t; yHi = y; }
    }
    const span = yHi - yLo;
    for (let q = 0; q < out.length; q += 3) {
      // a palette of one lightness cannot show a picture: everything becomes that colour
      const u = span > 0 ? clamp01((luminance(out[q]!, out[q + 1]!, out[q + 2]!) - yLo) / span) : 0;
      // in this form u = 0 and u = 1 give lo and hi themselves, and black to white gives u
      for (let c = 0; c < 3; c++) out[q + c] = (1 - u) * lo[c]! + u * hi[c]!;
    }
  }
  if (rangeCompression !== 1) {
    for (let q = 0; q < out.length; q += 3) for (let c = 0; c < 3; c++) out[q + c] = board[c]! + rangeCompression * (out[q + c]! - board[c]!);
  }
  return out;
}

/**
 * The picture a piece is compared with (similarity.ts, D-54): the cropped picture with no adjustment, as the
 * palette can show it (mono mode lays it on the palette's lightness axis, D-32). Invert stays, because with it
 * the user chose which picture they want; everything else the sliders do is a means, not the goal.
 */
export function referencePicture(picture: Float64Array, res: number, invert: boolean, palette: Palette): Float64Array {
  return adjustTarget(picture, res, { ...NEUTRAL_ADJUST, invert }, palette);
}

/** A pixel is as good as bare board when its OKLab colour is within this of the board's. */
export const BLANK_DELTA = 0.1;
/** A picture with more than this share of bare board is mostly empty, like a line drawing: every one of the
 * 81 test drawings has 68 % or more, the three built-in samples a third or less (D-53). */
export const MOSTLY_BLANK = 0.6;

/**
 * The share of a picture, counted by `weight`, that is like the bare board. Lines drawn there can only take
 * the piece away from the picture, and every line crosses the whole circle: the more of the picture is blank,
 * the less of it one thread can show (D-53).
 */
export function blankShare(picture: Float64Array, weight: ArrayLike<number>, board: Readonly<RGB>): number {
  const base = oklab(board[0], board[1], board[2]);
  let blank = 0, total = 0;
  for (let p = 0; p < weight.length; p++) {
    const w = weight[p]!;
    if (!(w > 0)) continue;
    const c = oklab(picture[3 * p]!, picture[3 * p + 1]!, picture[3 * p + 2]!);
    total += w;
    if (Math.hypot(c[0] - base[0], c[1] - base[1], c[2] - base[2]) < BLANK_DELTA) blank += w;
  }
  return total > 0 ? blank / total : 0;
}

/** The "quiet rim" preset of §6.5 (D-14): this weight where the distance from the centre is above this share of the radius. */
export const QUIET_RIM = { radius: 0.82, weight: 0.2 } as const;

/**
 * The weight map W of §4.5: 1 everywhere, lowered on the rim by the preset, then the brush strokes (a stroke
 * replaces what is under it, the preset included), then 0 outside the pin circle, exactly as circleMask does.
 * `width` and `height` are the picture's, for placing the strokes through the crop.
 */
export function importanceWeights(res: number, preset: ImportancePreset, strokes: readonly Stroke[], crop: Crop, width: number, height: number): Float64Array {
  let W: Float64Array = new Float64Array(res * res).fill(1);
  if (preset === "quietRim") {
    const c = (res - 1) / 2, rim = (QUIET_RIM.radius * c) ** 2;
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) if ((x - c) ** 2 + (y - c) ** 2 > rim) W[y * res + x] = QUIET_RIM.weight;
  }
  if (strokes.length) W = paintStrokes(W, res, strokes, crop, width, height);
  const mask = circleMask(res);
  for (let p = 0; p < W.length; p++) W[p]! *= mask[p]!;
  return W;
}
