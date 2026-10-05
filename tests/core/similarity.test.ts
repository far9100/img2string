// How close a piece is to the picture (DECISIONS D-54): the properties the automatic adjustment relies on.
import { describe, expect, it } from "vitest";
import { BAND_WEIGHTS, inkOf, SCALE_SIGMAS, similarity } from "../../src/core/similarity.ts";
import { circleMask, type RGB } from "../../src/core/stringart.ts";
import { colourWheel, face } from "../../src/core/targets.ts";
import { lineDrawing } from "../helpers/pictures.ts";

const WHITE: RGB = [1, 1, 1], BLACK: RGB = [0, 0, 0];
const flat = (res: number, colour: RGB) => { const T = new Float64Array(3 * res * res); for (let p = 0; p < res * res; p++) T.set(colour, 3 * p); return T; };
/** The picture with its difference from the board scaled by f (in linear light): fainter below 1. */
const faded = (T: Float64Array, board: RGB, f: number) => T.map((v, i) => board[i % 3]! + f * (v - board[i % 3]!));
/** The picture moved `by` pixels to the right; what comes in from the left is white. */
function shifted(T: Float64Array, res: number, by: number): Float64Array {
  const out = new Float64Array(T.length).fill(1);
  for (let y = 0; y < res; y++) for (let x = by; x < res; x++) for (let k = 0; k < 3; k++) out[3 * (y * res + x) + k] = T[3 * (y * res + x - by) + k]!;
  return out;
}
const compare = (piece: Float64Array, picture: Float64Array, res: number, weight: Float64Array = circleMask(res), board: RGB = WHITE) =>
  similarity(inkOf(piece, res, weight, board), inkOf(picture, res, weight, board));

describe("similarity to the picture", () => {
  const res = 160, drawing = lineDrawing(res), portrait = face(res);

  it("is 1 for the picture itself and 0 for the bare board, in every band", () => {
    for (const T of [drawing, portrait]) {
      const same = compare(T, T, res), bare = compare(flat(res, WHITE), T, res);
      expect(same.value).toBe(1);
      expect(same.bands).toEqual([1, 1, 1, 1, 1, 1]);
      expect(bare.value).toBeGreaterThanOrEqual(0);
      expect(bare.value).toBeLessThan(0.002);
      for (const b of bare.bands) expect(b).toBeLessThan(0.01);
    }
    expect(compare(drawing, drawing, res).bands).toHaveLength(SCALE_SIGMAS.length + 1);
    expect(BAND_WEIGHTS).toHaveLength(SCALE_SIGMAS.length + 1);
  });

  it("falls as the piece gets fainter than the picture, although every outline is in place", () => {
    const at = (f: number) => compare(faded(portrait, WHITE, f), portrait, res).value;
    expect(at(0.75)).toBeLessThan(1);
    expect(at(0.5)).toBeLessThan(at(0.75) - 0.05);
    expect(at(0.25)).toBeLessThan(at(0.5) - 0.1);
    expect(at(0.25)).toBeGreaterThan(0.2); // still clearly the picture, unlike the bare board
  });

  it("falls when the piece is darker all over than the picture", () => {
    // a line drawing behind a grey veil: the outlines match, the overall tone does not
    const veiled = drawing.map((v) => 0.6 * v), s = compare(veiled, drawing, res);
    expect(s.bands[5]!).toBeLessThan(0.5);
    expect(s.bands[1]!).toBeGreaterThan(s.bands[5]!);
    expect(s.value).toBeLessThan(compare(drawing, drawing, res).value - 0.1);
  });

  it("an outline out of place loses the fine bands first", () => {
    const near = compare(shifted(drawing, res, 1), drawing, res), far = compare(shifted(drawing, res, 6), drawing, res);
    // one pixel off: every coarser band agrees better than the one before
    for (let j = 1; j < near.bands.length; j++) expect(near.bands[j]!).toBeGreaterThan(near.bands[j - 1]!);
    expect(near.bands[0]!).toBeLessThan(0.3);
    expect(near.bands[5]!).toBeGreaterThan(0.99);
    // six pixels off: nothing finer than that is left, but the overall tone has not changed
    for (let j = 0; j < 4; j++) expect(Math.abs(far.bands[j]!)).toBeLessThan(0.1);
    expect(far.bands[5]!).toBeGreaterThan(0.9);
    expect(far.value).toBeLessThan(near.value - 0.4);
  });

  it("does not look where the importance map is 0, and looks harder where it is higher", () => {
    const mask = circleMask(res), left = mask.map((w, p) => (p % res < res / 2 ? w : 0));
    // a piece that is right on the left half and empty on the right half
    const half = portrait.slice();
    for (let y = 0; y < res; y++) for (let x = res / 2 + 12; x < res; x++) half.fill(1, 3 * (y * res + x), 3 * (y * res + x) + 3);
    const all = compare(half, portrait, res).value, onlyLeft = compare(half, portrait, res, left).value;
    expect(all).toBeLessThan(0.9);
    expect(onlyLeft).toBeGreaterThan(0.97);
    // weight 3 on the half that is wrong counts it more than weight 1 does
    const heavy = mask.map((w, p) => (p % res < res / 2 ? w : 3 * w));
    expect(compare(half, portrait, res, heavy).value).toBeLessThan(all);
  });

  it("a grey picture is compared by lightness alone, and that changes nothing", () => {
    const piece = faded(shifted(portrait, res, 3), WHITE, 0.7), mask = circleMask(res);
    const grey = inkOf(piece, res, mask, WHITE), picture = inkOf(portrait, res, mask, WHITE);
    expect([grey.channels, picture.channels]).toEqual([1, 1]);
    // one pixel a hair off grey makes the piece a colour picture: three channels against the picture's one
    const tinted = piece.slice(), p = 3 * (80 * res + 80);
    tinted[p] = tinted[p]! + 1e-9;
    const colour = inkOf(tinted, res, mask, WHITE);
    expect(colour.channels).toBe(3);
    expect(similarity(colour, picture).value).toBeCloseTo(similarity(grey, picture).value, 8);
    expect(similarity(picture, colour).value).toBeCloseTo(similarity(grey, picture).value, 8);
  });

  it("colour counts: the same shapes in other hues are not the picture", () => {
    const wheel = colourWheel(res), turned = wheel.slice();
    for (let p = 0; p < res * res; p++) { turned[3 * p] = wheel[3 * p + 1]!; turned[3 * p + 1] = wheel[3 * p + 2]!; turned[3 * p + 2] = wheel[3 * p]!; }
    expect(inkOf(wheel, res, circleMask(res), WHITE).channels).toBe(3);
    expect(compare(wheel, wheel, res).value).toBe(1);
    expect(compare(turned, wheel, res).value).toBeLessThan(0.5);
  });

  it("works from a dark board as from a light one", () => {
    const night = portrait.map((v) => 1 - v), mask = circleMask(res);
    expect(compare(night, night, res, mask, BLACK).value).toBe(1);
    expect(compare(flat(res, BLACK), night, res, mask, BLACK).value).toBeLessThan(0.002);
    expect(compare(faded(night, BLACK, 0.2), night, res, mask, BLACK).value).toBeLessThan(0.95);
  });

  it("measures shares of the frame, so the working resolution hardly matters", () => {
    // the face sample is a function of position: the same picture at every size
    const at = (size: number) => {
      const T = face(size), piece = faded(shifted(T, size, Math.round(size / 80)), WHITE, 0.6);
      return compare(piece, T, size).value;
    };
    expect(Math.abs(at(200) - at(400))).toBeLessThan(0.03);
    expect(Math.abs(at(800) - at(400))).toBeLessThan(0.02);
  });

  it("averages a large picture down by a whole factor first", () => {
    const sizes = [399, 400, 799, 800, 1000, 1200].map((size) => inkOf(new Float64Array(3 * size * size).fill(0.5), size, new Float64Array(size * size).fill(1), WHITE).size);
    expect(sizes).toEqual([399, 400, 799, 400, 500, 400]);
  });

  it("refuses to compare pictures of different sizes", () => {
    expect(() => similarity(inkOf(face(80), 80, circleMask(80), WHITE), inkOf(portrait, res, circleMask(res), WHITE))).toThrow(RangeError);
  });

  it("with nothing to look at, there is nothing to tell apart", () => {
    const none = new Float64Array(res * res);
    expect(compare(drawing, portrait, res, none).value).toBe(1);
  });
});
