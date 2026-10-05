// src/core/preprocess.ts: the crop onto the working grid, the adjustments of §6.4 and the importance map of §6.5.
import { describe, expect, it } from "vitest";
import { gaussianBlur, SRGB_TO_LINEAR } from "../../src/core/image.ts";
import { adjustTarget, BLANK_DELTA, blankShare, importanceWeights, makeCropper, MOSTLY_BLANK, QUIET_RIM, referencePicture, type Palette, type Source } from "../../src/core/preprocess.ts";
import { IDENTITY_CROP, NEUTRAL_ADJUST, type Adjust, type Crop } from "../../src/core/project.ts";
import { circleMask, hexToLinear, linearToSrgb, srgbToLinear, type RGB } from "../../src/core/stringart.ts";
import { pictureToGrid } from "../../src/core/strokes.ts";
import { colourWheel, face, gradient } from "../../src/core/targets.ts";
import { lineDrawing } from "../helpers/pictures.ts";
import { mulberry32 } from "../helpers/rng.ts";

type Rgba = [number, number, number, number];

function picture(width: number, height: number, pixel: (x: number, y: number) => Rgba): Source {
  const rgba = new Uint8ClampedArray(4 * width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(pixel(x, y), 4 * (y * width + x));
  return { width, height, rgba };
}

/** Random bytes; with `alpha`, a third of the pixels opaque, a sixth fully transparent and the rest in between. */
function noise(width: number, height: number, seed: number, alpha = false): Source {
  const r = mulberry32(seed), byte = () => Math.floor(256 * r());
  return picture(width, height, () => {
    const a = r();
    return [byte(), byte(), byte(), !alpha || a < 1 / 3 ? 255 : a < 1 / 2 ? 0 : byte()];
  });
}

/** A picture pixel in linear light, and its alpha as a fraction. */
const linear = (s: Source, x: number, y: number): RGB => [0, 1, 2].map((c) => SRGB_TO_LINEAR[s.rgba[4 * (y * s.width + x) + c]!]!) as RGB;
const alphaOf = (s: Source, x: number, y: number): number => s.rgba[4 * (y * s.width + x) + 3]! / 255;

/** The crop that reads a picture whose short side is m x res pixels at exactly m picture pixels per working pixel,
 * the centres of the working pixels on the centres of the m x m blocks. */
const aligned = (res: number): Crop => ({ cx: 0.5, cy: 0.5, scale: res / (res - 1), rotateDeg: 0 });

const BOARD: RGB = [0.9, 0.05, 0.4];
const worst = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let w = a.length === b.length ? 0 : Infinity;
  for (let i = 0; i < a.length; i++) w = Math.max(w, Math.abs(a[i]! - b[i]!));
  return w;
};
const sameBits = (a: Float64Array, b: Float64Array): boolean => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

/**
 * The definition of the crop written out slowly: linearise with the colour multiplied by alpha, box-shrink by
 * n = floor(R / c), read bilinearly between pixel centres with nothing outside the picture, average 2 x 2
 * readings when the remaining ratio is above 1, and lay the result on the board.
 */
function referenceCrop(s: Source, crop: Crop, res: number, board: RGB): Float64Array {
  const { width: W, height: H } = s, c = (res - 1) / 2, R = Math.min(W, H) / (2 * crop.scale), ratio = R / c, n = Math.max(1, Math.floor(ratio + 1e-9));
  const w = Math.ceil(W / n), h = Math.ceil(H / n), small = new Float64Array(4 * w * h);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = 4 * (Math.floor(y / n) * w + Math.floor(x / n)), a = alphaOf(s, x, y), rgb = linear(s, x, y);
    for (let ch = 0; ch < 3; ch++) small[o + ch]! += (a * rgb[ch]!) / (n * n);
    small[o + 3]! += a / (n * n);
  }
  const texel = (i: number, j: number, ch: number) => (i < 0 || j < 0 || i >= w || j >= h ? 0 : small[4 * (j * w + i) + ch]!);
  const read = (X: number, Y: number, ch: number) => {
    const u = X / n - 0.5, v = Y / n - 0.5, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    return (1 - fu) * (1 - fv) * texel(i, j, ch) + fu * (1 - fv) * texel(i + 1, j, ch) + (1 - fu) * fv * texel(i, j + 1, ch) + fu * fv * texel(i + 1, j + 1, ch);
  };
  const t = (crop.rotateDeg * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t), offsets = ratio / n > 1 + 1e-9 ? [-0.25, 0.25] : [0];
  const out = new Float64Array(3 * res * res);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const sum = [0, 0, 0, 0];
    for (const oy of offsets) for (const ox of offsets) {
      const u = (x + ox - c) / c, v = (y + oy - c) / c;
      const X = crop.cx * W + R * (u * cos + v * sin), Y = crop.cy * H + R * (-u * sin + v * cos);
      for (let ch = 0; ch < 4; ch++) sum[ch]! += read(X, Y, ch) / offsets.length ** 2;
    }
    for (let ch = 0; ch < 3; ch++) out[3 * (y * res + x) + ch] = sum[ch]! + (1 - sum[3]!) * board[ch]!;
  }
  return out;
}

describe("makeCropper", () => {
  it("one picture pixel per working pixel returns the picture's linearised pixels", () => {
    const res = 48, square = noise(res, res, 1), out = makeCropper(square)(aligned(res), res, BOARD);
    let w = 0;
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) w = Math.max(w, worst(out.subarray(3 * (y * res + x), 3 * (y * res + x) + 3), linear(square, x, y)));
    expect(w).toBeLessThan(1e-12);
    // a wider picture: the same, around its centre (the scale is counted on the short side)
    const wide = noise(res + 12, res, 2), outWide = makeCropper(wide)(aligned(res), res, BOARD);
    w = 0;
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) w = Math.max(w, worst(outWide.subarray(3 * (y * res + x), 3 * (y * res + x) + 3), linear(wide, x + 6, y)));
    expect(w).toBeLessThan(1e-12);
    // and the same crop moved by whole pixels reads the pixels beside them
    const moved = makeCropper(wide)({ ...aligned(res), cx: 0.5 + 4 / (res + 12) }, res, BOARD);
    w = 0;
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) w = Math.max(w, worst(moved.subarray(3 * (y * res + x), 3 * (y * res + x) + 3), linear(wide, x + 10, y)));
    expect(w).toBeLessThan(1e-12);
  });

  it("the identity crop puts the pin circle on the picture's short side, so its outer pixels sit on the picture's edge", () => {
    // with res pixels across res - 1 picture-pixel steps, a res x res picture is read at 1 + 1 / (res - 1) pixels
    // per working pixel: close to its own pixels but not them, and the outer row is half picture, half board
    const res = 65, colour: Rgba = [40, 200, 90, 255], flat = picture(res, res, () => colour), lin = linear(flat, 0, 0);
    const out = makeCropper(flat)(IDENTITY_CROP, res, BOARD), at = (x: number, y: number) => out.subarray(3 * (y * res + x), 3 * (y * res + x) + 3);
    const mix = (share: number) => lin.map((v, c) => share * v + (1 - share) * BOARD[c]!);
    expect(worst(at(32, 32), lin)).toBeLessThan(1e-12);
    expect(worst(at(1, 1), lin)).toBeLessThan(1e-12);
    expect(worst(at(32, 0), mix(0.5))).toBeLessThan(1e-12);
    expect(worst(at(64, 20), mix(0.5))).toBeLessThan(1e-12);
    expect(worst(at(0, 64), mix(0.25))).toBeLessThan(1e-12);
    // a noisy picture is close to itself: every working pixel is a mix of the picture pixels around its place
    const noisy = noise(res, res, 3), near = makeCropper(noisy)(IDENTITY_CROP, res, BOARD);
    expect(worst(near, referenceCrop(noisy, IDENTITY_CROP, res, BOARD))).toBeLessThan(1e-12);
  });

  it("a 2 x downscale is the 2 x 2 average in linear light, a 3 x downscale the 3 x 3 average", () => {
    const res = 48, big = noise(2 * res, 2 * res, 4), out = makeCropper(big)(aligned(res), res, BOARD);
    let w = 0;
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) for (let c = 0; c < 3; c++) {
      const mean = (linear(big, 2 * x, 2 * y)[c]! + linear(big, 2 * x + 1, 2 * y)[c]! + linear(big, 2 * x, 2 * y + 1)[c]! + linear(big, 2 * x + 1, 2 * y + 1)[c]!) / 4;
      w = Math.max(w, Math.abs(out[3 * (y * res + x) + c]! - mean));
    }
    expect(w).toBeLessThan(1e-12);
    // not the average of the sRGB values: a black and white checkerboard comes out at 0.5 linear (188 of 255)
    const checks = picture(2 * res, 2 * res, (x, y) => ((x + y) % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    expect(worst(makeCropper(checks)(aligned(res), res, BOARD), new Float64Array(3 * res * res).fill(0.5))).toBeLessThan(1e-12);

    // 3 x, on a picture one column short of 3 res: the last block has two columns and a third of board
    const W = 3 * res - 1, H = 3 * res, ragged = noise(W, H, 5, true);
    const crop: Crop = { cx: (1.5 * res) / W, cy: 0.5, scale: W / (3 * (res - 1)), rotateDeg: 0 };
    const out3 = makeCropper(ragged)(crop, res, BOARD);
    w = 0;
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      const sum = [0, 0, 0, 0];
      for (let j = 3 * y; j < 3 * y + 3; j++) for (let i = 3 * x; i < Math.min(W, 3 * x + 3); i++) {
        const a = alphaOf(ragged, i, j), rgb = linear(ragged, i, j);
        for (let c = 0; c < 3; c++) sum[c]! += (a * rgb[c]!) / 9;
        sum[3]! += a / 9;
      }
      for (let c = 0; c < 3; c++) w = Math.max(w, Math.abs(out3[3 * (y * res + x) + c]! - (sum[c]! + (1 - sum[3]!) * BOARD[c]!)));
    }
    expect(w).toBeLessThan(1e-12);
  });

  it("a picture smaller than the grid is enlarged by interpolating between its pixel centres", () => {
    // 2 x 2 pixels on 5 x 5: the corners of the grid are the four pixels' centres
    const tiny = picture(2, 2, (x, y) => [[10, 200, 30, 255], [250, 20, 90, 255], [0, 0, 0, 255], [128, 255, 64, 255]][2 * y + x] as Rgba);
    const out = makeCropper(tiny)({ cx: 0.5, cy: 0.5, scale: 2, rotateDeg: 0 }, 5, BOARD);
    const [A, B, C, D] = [linear(tiny, 0, 0), linear(tiny, 1, 0), linear(tiny, 0, 1), linear(tiny, 1, 1)];
    let w = 0;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) for (let c = 0; c < 3; c++) {
      const fx = x / 4, fy = y / 4;
      w = Math.max(w, Math.abs(out[3 * (5 * y + x) + c]! - ((1 - fx) * (1 - fy) * A[c]! + fx * (1 - fy) * B[c]! + (1 - fx) * fy * C[c]! + fx * fy * D[c]!)));
    }
    expect(w).toBeLessThan(1e-12);
    expect(Array.from(out.subarray(0, 3))).toEqual(A);
    expect(Array.from(out.subarray(3 * 4, 3 * 5))).toEqual(B);
    // a small photo on the default grid
    const small = noise(40, 30, 6), crop: Crop = { cx: 0.4, cy: 0.6, scale: 1.3, rotateDeg: 0 };
    expect(worst(makeCropper(small)(crop, 400, BOARD), referenceCrop(small, crop, 400, BOARD))).toBeLessThan(1e-12);
  });

  it("a constant picture stays constant under any crop that stays inside it", () => {
    const flat = picture(257, 181, () => [200, 90, 30, 255]), lin = linear(flat, 0, 0), crop = makeCropper(flat), r = mulberry32(7);
    const ratios = new Set<number>();
    for (let i = 0; i < 40; i++) {
      // the grid's corners are at most 0.71 / scale of the short side from the crop's centre, in any direction
      const res = [16, 33, 64, 200][i % 4]!, scale = 2 * 12 ** r(), c: Crop = { cx: 0.5 + 0.1 * (r() - 0.5), cy: 0.5 + 0.1 * (r() - 0.5), scale, rotateDeg: 720 * r() - 360 };
      ratios.add(Math.max(1, Math.floor(181 / (scale * (res - 1)))));
      const out = crop(c, res, BOARD);
      let w = 0;
      for (let p = 0; p < res * res; p++) for (let ch = 0; ch < 3; ch++) w = Math.max(w, Math.abs(out[3 * p + ch]! - lin[ch]!));
      expect(w).toBeLessThan(1e-12);
    }
    expect(ratios.size).toBeGreaterThan(3); // enlarged, one to one and several shrink factors were all used
    // on a board of its own colour the picture has no edge either: any crop gives that colour
    for (let i = 0; i < 20; i++) {
      const c: Crop = { cx: r(), cy: r(), scale: 0.2 * 100 ** r(), rotateDeg: 720 * r() - 360 }, out = crop(c, 40, lin);
      let w = 0;
      for (let p = 0; p < 40 * 40; p++) for (let ch = 0; ch < 3; ch++) w = Math.max(w, Math.abs(out[3 * p + ch]! - lin[ch]!));
      expect(w).toBeLessThan(1e-12);
    }
  });

  it("transparency is composited onto the board, in linear light and weighted by alpha", () => {
    const res = 32, veiled = noise(res, res, 8, true), out = makeCropper(veiled)(aligned(res), res, BOARD);
    let w = 0, clear = 0;
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      const a = alphaOf(veiled, x, y), rgb = linear(veiled, x, y), o = 3 * (y * res + x);
      for (let c = 0; c < 3; c++) w = Math.max(w, Math.abs(out[o + c]! - (a * rgb[c]! + (1 - a) * BOARD[c]!)));
      if (a === 0) { clear++; expect(Array.from(out.subarray(o, o + 3))).toEqual(BOARD); }
    }
    expect(w).toBeLessThan(1e-12);
    expect(clear).toBeGreaterThan(50);
    // half transparent white on a black board is 128 / 255 of white
    const half = makeCropper(picture(res, res, () => [255, 255, 255, 128]))(aligned(res), res, [0, 0, 0]);
    expect(worst(half, new Float64Array(3 * res * res).fill(128 / 255))).toBeLessThan(1e-12);
    // the colour of a fully transparent pixel does not leak into its neighbours when the picture is shrunk
    const hidden = picture(2 * res, 2 * res, (x, y) => (x % 2 === 0 && y % 2 === 0 ? [0, 255, 0, 0] : [255, 0, 0, 255]));
    const shrunk = makeCropper(hidden)(aligned(res), res, [0, 0, 1]);
    for (let p = 0; p < res * res; p++) expect(worst(shrunk.subarray(3 * p, 3 * p + 3), [0.75, 0, 0.25])).toBeLessThan(1e-12);
  });

  it("outside the picture the board shows, and the picture's edge is antialiased", () => {
    const res = 40, flat = picture(100, 60, () => [20, 20, 20, 255]), lin = linear(flat, 0, 0)[0]!, crop = makeCropper(flat);
    // zoomed out: the picture is a 2.5 times smaller rectangle in the middle
    const out = crop({ cx: 0.5, cy: 0.5, scale: 0.4, rotateDeg: 0 }, res, BOARD);
    const k = 60 / (0.4 * (res - 1));
    let inside = 0, outside = 0;
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      const X = 50 + k * (x - 19.5), Y = 30 + k * (y - 19.5), px = out.subarray(3 * (y * res + x), 3 * (y * res + x) + 3);
      // more than a working pixel (k picture pixels) away from the edge, the pixel is all board or all picture
      if (X < -1.5 * k || X > 100 + 1.5 * k || Y < -1.5 * k || Y > 60 + 1.5 * k) { outside++; expect(Array.from(px)).toEqual(BOARD); }
      else if (X > 1.5 * k && X < 100 - 1.5 * k && Y > 1.5 * k && Y < 60 - 1.5 * k) { inside++; expect(worst(px, [lin, lin, lin])).toBeLessThan(1e-12); }
      else for (let c = 0; c < 3; c++) { expect(px[c]!).toBeGreaterThanOrEqual(Math.min(lin, BOARD[c]!) - 1e-12); expect(px[c]!).toBeLessThanOrEqual(Math.max(lin, BOARD[c]!) + 1e-12); }
    }
    expect(inside).toBeGreaterThan(100);
    expect(outside).toBeGreaterThan(500);
    // a crop wholly off the picture is the bare board
    const off = crop({ cx: 0, cy: 0, scale: 20, rotateDeg: 45 }, res, BOARD), far = makeCropper(flat)({ cx: 3, cy: -2, scale: 1, rotateDeg: 0 }, res, BOARD);
    expect(off.some((v, i) => v !== BOARD[i % 3])).toBe(true); // this one still shows the picture's corner
    for (let p = 0; p < res * res; p++) expect(Array.from(far.subarray(3 * p, 3 * p + 3))).toEqual(BOARD);
    // one to one, moved half a pixel left: the first column is half board, the rest unchanged
    const shifted = makeCropper(picture(res, res, () => [20, 20, 20, 255]))({ ...aligned(res), cx: 0.5 - 0.5 / res }, res, [1, 1, 1]);
    for (let y = 0; y < res; y++) {
      expect(shifted[3 * y * res]).toBeCloseTo(0.5 * lin + 0.5, 12);
      expect(shifted[3 * (y * res + 1)]).toBeCloseTo(lin, 12);
    }
  });

  it("a quarter turn moves the pixels without resampling them: 90 degrees is the transpose, flipped", () => {
    const res = 36, src = noise(res, res, 9), crop = makeCropper(src);
    const turned = (deg: number) => crop({ ...aligned(res), rotateDeg: deg }, res, BOARD);
    const check = (out: Float64Array, from: (x: number, y: number) => [number, number]) => {
      let w = 0;
      for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) w = Math.max(w, worst(out.subarray(3 * (y * res + x), 3 * (y * res + x) + 3), linear(src, ...from(x, y))));
      return w;
    };
    // clockwise: the picture's top left corner goes to the top right, its left column becomes the top row
    expect(check(turned(90), (x, y) => [y, res - 1 - x])).toBeLessThan(1e-12);
    expect(check(turned(180), (x, y) => [res - 1 - x, res - 1 - y])).toBeLessThan(1e-12);
    expect(check(turned(270), (x, y) => [res - 1 - y, x])).toBeLessThan(1e-12);
    expect(check(turned(-90), (x, y) => [res - 1 - y, x])).toBeLessThan(1e-12);
    expect(check(turned(360), (x, y) => [x, y])).toBeLessThan(1e-12);
    // a turn that is not a quarter does resample
    expect(check(turned(89), (x, y) => [y, res - 1 - x])).toBeGreaterThan(0.01);
  });

  it("agrees with the definition read out slowly, for random pictures and crops", () => {
    const r = mulberry32(10), sources = [noise(37, 23, 11, true), noise(64, 48, 12), noise(150, 91, 13, true)];
    let enlarged = 0, shrunk = 0, doubled = 0;
    for (let i = 0; i < 45; i++) {
      const s = sources[i % 3]!, res = [16, 33, 50][Math.floor(3 * r())]!;
      const crop: Crop = { cx: r(), cy: r(), scale: 0.2 * 100 ** r(), rotateDeg: i % 5 === 0 ? 90 * Math.floor(8 * r() - 4) : 720 * r() - 360 };
      const ratio = Math.min(s.width, s.height) / (crop.scale * (res - 1));
      if (ratio < 1) enlarged++; else if (ratio >= 2) shrunk++;
      if (ratio > 1 && ratio / Math.floor(ratio) > 1) doubled++;
      expect(worst(makeCropper(s)(crop, res, BOARD), referenceCrop(s, crop, res, BOARD)), JSON.stringify({ ...crop, res, picture: i % 3 })).toBeLessThan(1e-12);
    }
    expect(enlarged).toBeGreaterThan(5);
    expect(shrunk).toBeGreaterThan(5);
    expect(doubled).toBeGreaterThan(5);
  });

  it("gives the same result whatever was cropped before", () => {
    const s = noise(300, 200, 14, true), a: Crop = { cx: 0.4, cy: 0.5, scale: 0.8, rotateDeg: 12 }, b: Crop = { cx: 0.6, cy: 0.5, scale: 0.31, rotateDeg: -70 }, c: Crop = { cx: 0.5, cy: 0.5, scale: 6, rotateDeg: 3 };
    const crop = makeCropper(s), first = [a, b, c].map((x) => crop(x, 64, BOARD));
    const again = [c, a, b, a].map((x) => crop(x, 64, BOARD));
    expect(sameBits(again[0]!, first[2]!)).toBe(true);
    expect(sameBits(again[1]!, first[0]!)).toBe(true);
    expect(sameBits(again[2]!, first[1]!)).toBe(true);
    expect(sameBits(again[3]!, first[0]!)).toBe(true);
    for (const [x, out] of [[a, first[0]!], [b, first[1]!], [c, first[2]!]] as const) expect(sameBits(makeCropper(s)(x, 64, BOARD), out)).toBe(true);
    // another resolution or board from the same cropper is not confused with the last one
    expect(crop(a, 32, BOARD)).toHaveLength(3 * 32 * 32);
    expect(sameBits(crop(a, 64, [0, 0, 0]), makeCropper(s)(a, 64, [0, 0, 0]))).toBe(true);
  });

  it("crops a 4096 x 3072 picture, and pans it from the shrunk copy it kept", () => {
    const W = 4096, H = 3072, rgba = new Uint8ClampedArray(4 * W * H).fill(255);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) rgba[4 * (y * W + x)] = rgba[4 * (y * W + x) + 1] = rgba[4 * (y * W + x) + 2] = x < W / 2 ? 60 : 200;
    const s: Source = { width: W, height: H, rgba }, crop = makeCropper(s), res = 400;
    const out = crop(IDENTITY_CROP, res, BOARD), dark = SRGB_TO_LINEAR[60]!, light = SRGB_TO_LINEAR[200]!;
    // 7.7 picture pixels per working pixel: shrunk 7 times, then read. Away from the middle the two halves are untouched
    for (let y = 1; y < res - 1; y += 7) {
      for (let x = 1; x <= 198; x += 3) expect(out[3 * (y * res + x)]).toBeCloseTo(dark, 12);
      for (let x = 201; x < res - 1; x += 3) expect(out[3 * (y * res + x)]).toBeCloseTo(light, 12);
      for (const x of [199, 200]) { expect(out[3 * (y * res + x)]!).toBeGreaterThan(dark); expect(out[3 * (y * res + x)]!).toBeLessThan(light); }
    }
    const panned: Crop = { cx: 0.45, cy: 0.52, scale: 1, rotateDeg: 0 };
    expect(sameBits(crop(panned, res, BOARD), makeCropper(s)(panned, res, BOARD))).toBe(true);
  });

  it("refuses a pixel buffer that is too short for the picture", () => {
    expect(() => makeCropper({ width: 10, height: 10, rgba: new Uint8Array(399) })).toThrow(RangeError);
    expect(makeCropper({ width: 0, height: 0, rgba: new Uint8Array(0) })(IDENTITY_CROP, 8, BOARD)).toEqual(new Float64Array(3 * 64).map((_, i) => BOARD[i % 3]!));
  });
});

describe("adjustTarget", () => {
  const colour: Palette = { mode: "colour", board: [1, 1, 1], threads: [[0, 0, 0]] }, mono: Palette = { ...colour, mode: "mono" };
  const adjust = (over: Partial<Adjust>): Adjust => ({ ...NEUTRAL_ADJUST, ...over });
  /** A grey target of res x res pixels with these sRGB values, row by row (repeated to fill it). */
  const greys = (res: number, values: number[]): Float64Array => {
    const T = new Float64Array(3 * res * res);
    for (let p = 0; p < res * res; p++) T.fill(srgbToLinear(values[p % values.length]!), 3 * p, 3 * p + 3);
    return T;
  };
  /** The sRGB values of the first channel. */
  const encoded = (T: Float64Array): number[] => Array.from({ length: T.length / 3 }, (_, p) => linearToSrgb(T[3 * p]!));
  const expectValues = (got: number[], want: number[]) => { expect(got).toHaveLength(want.length); got.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 12)); };

  it("with neutral settings in colour mode returns the same values bit for bit, in a new array", () => {
    const r = mulberry32(30), T = new Float64Array(3 * 20 * 20).map(() => r());
    T.set([0, 1, 0.5, 1, 1, 1, 0, 0, 0, -0, 1e-300, 0.999999999999]);
    const before = T.slice(), out = adjustTarget(T, 20, NEUTRAL_ADJUST, colour);
    expect(out).not.toBe(T);
    expect(sameBits(out, T)).toBe(true);
    expect(sameBits(T, before)).toBe(true);
    expect(sameBits(adjustTarget(T, 20, NEUTRAL_ADJUST, { mode: "colour", board: [0.2, 0.3, 0.4], threads: [[1, 0, 0], [0, 0, 1]] }), T)).toBe(true);
  });

  it("the input is never changed", () => {
    const r = mulberry32(31), T = new Float64Array(3 * 40 * 40).map(() => r()), before = T.slice();
    adjustTarget(T, 40, { brightness: 0.1, contrast: 0.3, gamma: 1.5, rangeCompression: 0.7, saturation: 1.4, unsharp: 0.8, invert: true }, colour);
    adjustTarget(T, 40, { brightness: 0.1, contrast: 0.3, gamma: 1.5, rangeCompression: 0.7, saturation: 1.4, unsharp: 0.8, invert: true }, mono);
    expect(sameBits(T, before)).toBe(true);
  });

  it("invert, brightness, contrast and gamma work on sRGB values", () => {
    const T = greys(2, [0.25, 0.5, 0.7, 0.9]);
    expectValues(encoded(adjustTarget(T, 2, adjust({ invert: true }), colour)), [0.75, 0.5, 0.3, 0.1]);
    expectValues(encoded(adjustTarget(T, 2, adjust({ brightness: 0.2 }), colour)), [0.45, 0.7, 0.9, 1]); // 1.1 is clamped
    expectValues(encoded(adjustTarget(T, 2, adjust({ brightness: -0.3 }), colour)), [0, 0.2, 0.4, 0.6]);
    expectValues(encoded(adjustTarget(T, 2, adjust({ contrast: 0.5 }), colour)), [0.125, 0.5, 0.8, 1]); // 0.5 + (s - 0.5) x 1.5
    expectValues(encoded(adjustTarget(T, 2, adjust({ contrast: -1 }), colour)), [0.5, 0.5, 0.5, 0.5]);
    expectValues(encoded(adjustTarget(T, 2, adjust({ gamma: 2 }), colour)), [0.5, Math.SQRT1_2, Math.sqrt(0.7), Math.sqrt(0.9)]); // s ^ (1 / 2): lighter
    expectValues(encoded(adjustTarget(T, 2, adjust({ gamma: 0.5 }), colour)), [0.0625, 0.25, 0.49, 0.81]); // s ^ 2: darker
  });

  it("the steps come in the order invert, brightness, contrast, gamma", () => {
    const T = greys(1, [0.25]), one = (over: Partial<Adjust>) => encoded(adjustTarget(T, 1, adjust(over), colour))[0]!;
    expect(one({ invert: true, brightness: 0.1 })).toBeCloseTo(0.85, 12); // (1 - 0.25) + 0.1, not 1 - (0.25 + 0.1)
    expect(one({ brightness: 0.35, contrast: 1 })).toBeCloseTo(0.7, 12); // 0.5 + (0.6 - 0.5) x 2, not (0.5 + (0.25 - 0.5) x 2) + 0.35
    expect(one({ brightness: 0.35, contrast: 0.5, gamma: 2 })).toBeCloseTo(Math.sqrt(0.65), 12); // contrast, then the curve
    expect(one({ invert: true, brightness: -0.15, contrast: 0.5, gamma: 2 })).toBeCloseTo(Math.sqrt(0.5 + 0.1 * 1.5), 12);
    // values pushed out of range are cut off only at the curve or at the end: +0.9 then contrast -0.5 brings 1.15 back to 0.825
    expect(one({ brightness: 0.9, contrast: -0.5 })).toBeCloseTo(0.5 + (1.15 - 0.5) * 0.5, 12);
  });

  it("unsharp mask adds the difference from a Gaussian blur of sigma = res / 40", () => {
    const res = 80, T = new Float64Array(3 * res * res);
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) T.fill(srgbToLinear(x < res / 2 ? 0.3 : 0.6), 3 * (y * res + x), 3 * (y * res + x) + 3);
    const out = encoded(adjustTarget(T, res, adjust({ unsharp: 0.8 }), colour));
    const s = Float64Array.from(T, linearToSrgb), soft = gaussianBlur(s, res, res, 2, 3);
    out.forEach((v, p) => expect(v).toBeCloseTo(s[3 * p]! + 0.8 * (s[3 * p]! - soft[3 * p]!), 12));
    // the edge gets a dark fringe on its dark side and a light one on its light side; far from it nothing changes
    const row = 40 * res;
    expect(out[row + 39]).toBeCloseTo(0.3 - 0.8 * 0.15 * 0.9, 1);
    expect(out[row + 39]!).toBeLessThan(0.25);
    expect(out[row + 40]!).toBeGreaterThan(0.65);
    expect(out[row + 39]! + out[row + 40]!).toBeCloseTo(0.9, 12);
    expect(out[row + 10]).toBeCloseTo(0.3, 12);
    expect(out[row + 70]).toBeCloseTo(0.6, 12);
    // a flat picture has nothing to sharpen
    expectValues(encoded(adjustTarget(greys(8, [0.4]), 8, adjust({ unsharp: 2 }), colour)), new Array(64).fill(0.4));
    // it comes after the tone steps and before the clamp: inverted, the fringes swap sides
    const inverted = encoded(adjustTarget(T, res, adjust({ unsharp: 0.8, invert: true }), colour));
    inverted.forEach((v, p) => expect(v).toBeCloseTo(1 - out[p]!, 12));
  });

  it("saturation, in colour mode, moves each pixel away from or towards its luminance", () => {
    const T = Float64Array.of(0.5, 0.2, 0.1, 0.3, 0.3, 0.3, 0, 1, 0), y = 0.2126 * 0.5 + 0.7152 * 0.2 + 0.0722 * 0.1;
    const grey = adjustTarget(T, 1, adjust({ saturation: 0 }), colour);
    expect(worst(grey, [y, y, y, 0.3, 0.3, 0.3, 0.7152, 0.7152, 0.7152])).toBeLessThan(1e-15);
    const vivid = adjustTarget(T, 1, adjust({ saturation: 2 }), colour);
    expect(worst(vivid.subarray(0, 3), [y + 2 * (0.5 - y), y + 2 * (0.2 - y), 0])).toBeLessThan(1e-15); // blue would be -0.057
    expect(Array.from(vivid.subarray(3, 6))).toEqual([0.3, 0.3, 0.3]); // a grey has no colour to strengthen
    expect(Array.from(vivid.subarray(6, 9))).toEqual([0, 1, 0]); // clamped
    const half = adjustTarget(T, 1, adjust({ saturation: 0.5 }), colour);
    expect(worst(half.subarray(0, 3), [(0.5 + y) / 2, (0.2 + y) / 2, (0.1 + y) / 2])).toBeLessThan(1e-15);
    // it does not exist in mono mode
    expect(sameBits(adjustTarget(T, 1, adjust({ saturation: 2 }), mono), adjustTarget(T, 1, NEUTRAL_ADJUST, mono))).toBe(true);
  });

  it("mono mode keeps a grey picture as it is for a black thread on a white board", () => {
    const r = mulberry32(32), T = new Float64Array(3 * 30 * 30);
    for (let p = 0; p < 900; p++) T.fill(p < 3 ? [0, 1, 0.5][p]! : r(), 3 * p, 3 * p + 3);
    expect(sameBits(adjustTarget(T, 30, NEUTRAL_ADJUST, mono), T)).toBe(true);
    // white thread on a black board is the same axis
    expect(sameBits(adjustTarget(T, 30, NEUTRAL_ADJUST, { mode: "mono", board: [0, 0, 0], threads: [[1, 1, 1]] }), T)).toBe(true);
    // a colour picture becomes its luminance
    const c = adjustTarget(Float64Array.of(0.5, 0.2, 0.1, 1, 0, 0), 1, NEUTRAL_ADJUST, mono), y = 0.2126 * 0.5 + 0.7152 * 0.2 + 0.0722 * 0.1;
    expect(worst(c, [y, y, y, 0.2126, 0.2126, 0.2126])).toBeLessThan(1e-15);
    // the default thread is not quite black: what is darker than the thread becomes the thread, the rest stays
    const thread = hexToLinear("#111111"), dark = adjustTarget(greys(2, [0.02, 17 / 255, 0.5, 1]), 2, NEUTRAL_ADJUST, { mode: "mono", board: [1, 1, 1], threads: [thread] });
    expect(worst(dark, [thread[0], thread[0], thread[0], thread[0], thread[0], thread[0], srgbToLinear(0.5), srgbToLinear(0.5), srgbToLinear(0.5), 1, 1, 1])).toBeLessThan(1e-15);
    expect(Array.from(dark.subarray(9, 12))).toEqual([1, 1, 1]);
    expect(Array.from(dark.subarray(0, 3))).toEqual(thread);
  });

  it("mono mode lays the picture on the line from the darker to the lighter of board and thread", () => {
    const navy: RGB = [0.02, 0.03, 0.2], gold: RGB = [0.9, 0.6, 0.1], lum = (c: ArrayLike<number>) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    const pair: Palette = { mode: "mono", board: navy, threads: [gold] }, r = mulberry32(33);
    const T = new Float64Array(3 * 400).map(() => r()), out = adjustTarget(T, 20, NEUTRAL_ADJUST, pair);
    let between = 0;
    for (let p = 0; p < 400; p++) {
      const y = lum(T.subarray(3 * p, 3 * p + 3)), px = out.subarray(3 * p, 3 * p + 3), u = Math.min(1, Math.max(0, (y - lum(navy)) / (lum(gold) - lum(navy))));
      // on the segment, at the place that has the pixel's luminance (or at its nearer end)
      for (let c = 0; c < 3; c++) expect(px[c]).toBeCloseTo(navy[c]! + u * (gold[c]! - navy[c]!), 14);
      if (u > 0 && u < 1) { between++; expect(lum(px)).toBeCloseTo(y, 14); }
      else expect(Array.from(px)).toEqual(u === 0 ? navy : gold);
    }
    expect(between).toBeGreaterThan(200);
    // by hand: a mid grey of 0.3 between navy (luminance 0.040148) and gold (0.62768) is 44.2 % of the way
    const u = (0.3 - 0.040148) / (0.62768 - 0.040148), one = adjustTarget(Float64Array.of(0.3, 0.3, 0.3), 1, NEUTRAL_ADJUST, pair);
    expect(one[0]).toBeCloseTo(0.02 + u * 0.88, 6);
    expect(one[1]).toBeCloseTo(0.03 + u * 0.57, 6);
    expect(one[2]).toBeCloseTo(0.2 - u * 0.1, 6);
    // the same whichever of the two is the board, and with more threads the darkest and the lightest count
    expect(sameBits(adjustTarget(T, 20, NEUTRAL_ADJUST, { mode: "mono", board: gold, threads: [navy] }), out)).toBe(true);
    expect(sameBits(adjustTarget(T, 20, NEUTRAL_ADJUST, { mode: "mono", board: [0.3, 0.3, 0.3], threads: [gold, [0.2, 0.2, 0.2], navy] }), out)).toBe(true);
    // board and thread of one lightness leave no axis: everything is the board's colour
    const flat = adjustTarget(T, 20, NEUTRAL_ADJUST, { mode: "mono", board: [0.5, 0.5, 0.5], threads: [[0.5, 0.5, 0.5]] });
    expect(flat.every((v) => v === 0.5)).toBe(true);
  });

  it("range compression pulls the target towards the board: T = board + c (T - board)", () => {
    const T = Float64Array.of(0.2, 0.2, 0.2, 1, 1, 1, 0, 0.5, 1);
    // white board: the darkness 1 - T is multiplied by c
    const white = adjustTarget(T, 1, adjust({ rangeCompression: 0.6 }), colour);
    expect(worst(white, [0.52, 0.52, 0.52, 1, 1, 1, 0.4, 0.7, 1])).toBeLessThan(1e-15);
    expect(Array.from(white.subarray(3, 6))).toEqual([1, 1, 1]); // the board's colour stays exactly
    const tinted = adjustTarget(T, 1, adjust({ rangeCompression: 0.25 }), { mode: "colour", board: [0.8, 0.4, 0], threads: [[0, 0, 0]] });
    expect(worst(tinted, [0.65, 0.35, 0.05, 0.85, 0.55, 0.25, 0.6, 0.425, 0.25])).toBeLessThan(1e-15);
    // it is the last step: after the tone steps and after the mono mapping
    const late = adjustTarget(greys(1, [0.25]), 1, adjust({ invert: true, rangeCompression: 0.5 }), mono);
    expect(late[0]).toBeCloseTo(1 + 0.5 * (srgbToLinear(0.75) - 1), 12);
    const mapped = adjustTarget(Float64Array.of(1, 0, 0), 1, adjust({ rangeCompression: 0.5 }), mono);
    expect(worst(mapped, [0.6063, 0.6063, 0.6063])).toBeLessThan(1e-15); // luminance 0.2126, then half way to white
  });

  it("without a tone step the values never go through the sRGB curve", () => {
    // linearToSrgb then srgbToLinear does not give every number back, so the round trip would show
    const r = mulberry32(34), T = new Float64Array(3 * 100).map(() => r());
    expect(T.some((v) => srgbToLinear(linearToSrgb(v)) !== v)).toBe(true);
    const out = adjustTarget(T, 10, adjust({ rangeCompression: 0.5, saturation: 1 }), colour);
    for (let i = 0; i < T.length; i++) expect(out[i]).toBe(1 + 0.5 * (T[i]! - 1));
    const sat = adjustTarget(T, 10, adjust({ saturation: 0 }), colour);
    for (let p = 0; p < 100; p++) expect(sat[3 * p]).toBe(Math.min(1, Math.max(0, 0.2126 * T[3 * p]! + 0.7152 * T[3 * p + 1]! + 0.0722 * T[3 * p + 2]! + 0 * T[3 * p]!)));
    // a gamma that is not a positive number is ignored rather than turning the picture into NaN
    expect(sameBits(adjustTarget(T, 10, adjust({ gamma: 0 }), colour), T)).toBe(true);
    expect(sameBits(adjustTarget(T, 10, adjust({ gamma: NaN }), colour), T)).toBe(true);
  });
});

describe("importanceWeights", () => {
  it("is the circle mask for no preset and no strokes", () => {
    for (const res of [2, 64, 101, 400]) expect(importanceWeights(res, "none", [], IDENTITY_CROP, 640, 480)).toEqual(circleMask(res));
  });

  it("quiet rim: 0.2 beyond 82 % of the radius, 1 inside, 0 outside the circle", () => {
    const res = 400, c = 199.5, W = importanceWeights(res, "quietRim", [], IDENTITY_CROP, res, res), mask = circleMask(res);
    const counts = new Map<number, number>();
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      const w = W[y * res + x]!, d = Math.hypot(x - c, y - c);
      counts.set(w, (counts.get(w) ?? 0) + 1);
      if (mask[y * res + x] === 0) expect(w).toBe(0);
      else if (Math.abs(d - 0.82 * c) > 1e-9) expect(w).toBe(d > 0.82 * c ? 0.2 : 1);
    }
    expect([...counts.keys()].sort()).toEqual([0, 0.2, 1]);
    // the rim is 1 - 0.82^2 = 32.8 % of the disc: about 40,960 of its 125,040 pixels
    const disc = Math.PI * c * c;
    expect(Math.abs(counts.get(0.2)! / (disc * (1 - 0.82 ** 2)) - 1)).toBeLessThan(0.01);
    expect(Math.abs(counts.get(1)! / (disc * 0.82 ** 2) - 1)).toBeLessThan(0.01);
    expect(counts.get(0)).toBe(res * res - mask.reduce((a, v) => a + v, 0));
    expect(QUIET_RIM).toEqual({ radius: 0.82, weight: 0.2 });
  });

  it("strokes replace what is under them, the preset included, and nothing is painted outside the circle", () => {
    const res = 200, width = 300, height = 200, crop: Crop = { cx: 0.5, cy: 0.5, scale: 1.2, rotateDeg: 25 }, mask = circleMask(res);
    const plain = importanceWeights(res, "quietRim", [], crop, width, height);
    // one disc well inside, one across the rim and the circle's edge, and an eraser over part of the first
    const strokes = [{ w: 3, r: 0.1, pts: [0.5, 0.45] }, { w: 2, r: 0.12, pts: [0.5, 0.92] }, { w: 0, r: 0.03, pts: [0.5, 0.45, 0.56, 0.45] }];
    const W = importanceWeights(res, "quietRim", strokes, crop, width, height);
    const seen = new Set<number>();
    let raisedRim = 0;
    for (let p = 0; p < res * res; p++) {
      seen.add(W[p]!);
      if (mask[p] === 0) expect(W[p]).toBe(0);
      if (W[p] === 2 && plain[p] === 0.2) raisedRim++;
    }
    expect([...seen].sort()).toEqual([0, 0.2, 1, 2, 3]);
    expect(raisedRim).toBeGreaterThan(100);
    // each stroke is where the crop shows its picture point
    const at = (sx: number, sy: number) => { const [x, y] = pictureToGrid(crop, width, height, res, sx, sy); return W[Math.round(y) * res + Math.round(x)]; };
    expect(at(0.5, 0.45)).toBe(0);
    expect(at(0.5, 0.37)).toBe(3);
    expect(at(0.5, 0.86)).toBe(2);
    expect(at(0.4, 0.5)).toBe(1);
    expect(at(0.2, 0.5)).toBe(0); // this part of the picture is outside the pin circle
    // the same strokes without the preset differ only where the rim was lowered
    const none = importanceWeights(res, "none", strokes, crop, width, height);
    for (let p = 0; p < res * res; p++) expect(none[p]).toBe(W[p] === 0.2 ? 1 : W[p]);
  });
});

describe("the picture a piece is compared with, and how much of it is bare board", () => {
  const res = 120, mask = circleMask(res), white: RGB = [1, 1, 1];
  const mono: Palette = { mode: "mono", board: white, threads: [hexToLinear("#111111")] };

  it("the reference is the picture with no adjustment but invert, through the palette", () => {
    const wheel = colourWheel(res), colour: Palette = { mode: "colour", board: white, threads: [hexToLinear("#111111")] };
    expect(referencePicture(wheel, res, false, colour)).toEqual(wheel);
    expect(referencePicture(wheel, res, false, mono)).toEqual(adjustTarget(wheel, res, NEUTRAL_ADJUST, mono));
    expect(referencePicture(wheel, res, true, mono)).toEqual(adjustTarget(wheel, res, { ...NEUTRAL_ADJUST, invert: true }, mono));
    // in mono mode it is grey: the palette cannot show the wheel's colours
    const grey = referencePicture(wheel, res, false, mono);
    for (let q = 0; q < grey.length; q += 3) expect(Math.abs(grey[q]! - grey[q + 2]!)).toBeLessThan(1e-12);
  });

  it("a line drawing is mostly bare board, a picture with tones is not", () => {
    const drawing = blankShare(lineDrawing(res), mask, white);
    expect(drawing).toBeGreaterThan(0.85);
    expect(drawing).toBeLessThan(1);
    expect(drawing).toBeGreaterThan(MOSTLY_BLANK);
    for (const sample of [face, gradient, colourWheel]) expect(blankShare(referencePicture(sample(res), res, false, mono), mask, white)).toBeLessThan(0.4);
    // on a black board the same drawing has no bare board at all, and its negative is mostly bare board
    expect(blankShare(lineDrawing(res), mask, [0, 0, 0])).toBe(0);
    expect(blankShare(lineDrawing(res).map((v) => 1 - v), mask, [0, 0, 0])).toBeGreaterThan(0.85);
  });

  it("counts by the weights, and a pixel is bare when its colour is within BLANK_DELTA of the board's", () => {
    const T = new Float64Array(3 * 4), grey = (L: number) => L ** 3; // OKLab lightness of a grey is the cube root of its luminance
    [1, grey(1 - BLANK_DELTA + 0.01), grey(1 - BLANK_DELTA - 0.01), 0].forEach((v, p) => T.fill(v, 3 * p, 3 * p + 3));
    expect(blankShare(T, [1, 1, 1, 1], white)).toBe(0.5);
    expect(blankShare(T, [1, 0, 1, 1], white)).toBeCloseTo(1 / 3, 12);
    expect(blankShare(T, [3, 1, 1, 1], white)).toBeCloseTo(4 / 6, 12);
    expect(blankShare(T, [0, 0, 0, 0], white)).toBe(0);
    // a tint counts as well as a shade: a clear yellow is not white, however light
    T.set([1, 1, 0.4], 0);
    expect(blankShare(T, [1, 0, 0, 0], white)).toBe(0);
  });
});
