// Where the pins inside the picture stand (DECISIONS D-60). With every pin on the frame, every line crosses the
// whole picture; a pin on one of the picture's strokes lets a short line run along that stroke. The pins are
// put where the picture has ink, closer together where it is darker, by a rule that needs nothing random:
// the same picture, frame and count always give the same pins.
//
// The rule looks at the picture as it is before any adjustment (referencePicture(): what a piece is compared
// with, D-54) and at the importance map as painted, so the adjustment sliders and the automatic adjustment
// never move a pin. It works on a grid of its own, 1.25 mm a pixel, not on the working grid: the working
// resolution is a setting for quality, and changing it must not move pins that may already be in a board.
import { frameBounds, isRect, type FrameSpec } from "./frame.ts";
import { oklab, type RGB } from "./stringart.ts";

/** Most pins a piece may have inside the picture. */
export const INSIDE_MAX = 600;
/** The grid the pins are placed on: this many millimetres a pixel, but never more than PLACE_MAX pixels across. */
export const PLACE_PITCH_MM = 1.25;
export const PLACE_MAX = 401;
/** A pixel is ink when its OKLab colour is at least this far from the board's (preprocess.ts's BLANK_DELTA). */
const INK_DELTA = 0.1;
/** Ink in patches smaller than this (mm2) is left out: a speck is not a stroke. */
const SPECK_MM2 = 12;
/** The pins are numbered in bands this high (mm), top to bottom, and from left to right in a band. */
export const BAND_MM = 25;

/** Pixels across the grid the pins of a frame of this size are placed on. */
export const placeRes = (diameterMm: number): number => Math.max(64, Math.min(PLACE_MAX, Math.round(diameterMm / PLACE_PITCH_MM) + 1));

/** How far apart two pins inside the picture stand at least, and how far inside the frame's outline (mm): room
 * for fingers and for a number beside each pin on the template; four pin diameters when the pins are thick. */
export const insideGapMm = (pinDiameterMm: number): number => Math.max(6, 4 * pinDiameterMm);

export interface PlaceInput extends FrameSpec {
  /** Side of the square grid `reference` and `weight` are on: placeRes(diameterMm). */
  res: number;
  board: Readonly<RGB>;
  diameterMm: number;
  pinDiameterMm: number;
}

/** 8-connected patches of a mask: the size of the patch each set pixel belongs to. */
function patchSizes(mask: Uint8Array, res: number): Int32Array {
  const size = new Int32Array(res * res), label = new Int32Array(res * res), stack: number[] = [];
  let id = 0;
  for (let s = 0; s < res * res; s++) {
    if (!mask[s] || label[s]) continue;
    id++;
    const members: number[] = [];
    label[s] = id;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!, x = p % res, y = (p - x) / res;
      members.push(p);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= res || yy >= res) continue;
        const q = yy * res + xx;
        if (mask[q] && !label[q]) { label[q] = id; stack.push(q); }
      }
    }
    for (const p of members) size[p] = members.length;
  }
  return size;
}

/**
 * Up to `count` pins inside the picture: x, y per pin as fractions of the grid's span (six decimals, so they are
 * the same numbers once written to a file and read back), in the order they are numbered.
 *
 * `reference` is the picture on the palette with no adjustment (3 x res x res linear RGB) and `weight` the
 * importance map as painted (0 outside the frame). Ink is what differs from the board by INK_DELTA or more
 * where the weight is above 0, less its specks. A pin may stand on ink that is at least the gap inside the
 * frame's outline. The first stands on the darkest such pixel; every next one on the pixel for which
 * (distance to the nearest pin placed) x sqrt(darkness x weight) is largest among those at least the gap from
 * every pin placed, until `count` stand or no pixel is left. So pins crowd where the picture is dark and where
 * it was painted important, and none stands where the weight is 0.
 */
export function placeInside(reference: ArrayLike<number>, weight: ArrayLike<number>, o: PlaceInput, count: number): number[] {
  const res = o.res, px = res * res, want = Math.max(0, Math.min(INSIDE_MAX, Math.floor(count)));
  if (!want || res < 2) return [];
  const pixelMm = o.diameterMm / (res - 1), gap = insideGapMm(o.pinDiameterMm) / pixelMm, base = oklab(o.board[0], o.board[1], o.board[2]);
  const dark = new Float64Array(px), ink = new Uint8Array(px);
  for (let p = 0; p < px; p++) {
    if (!(weight[p]! > 0)) continue;
    const c = oklab(reference[3 * p]!, reference[3 * p + 1]!, reference[3 * p + 2]!);
    dark[p] = Math.sqrt((c[0] - base[0]) ** 2 + (c[1] - base[1]) ** 2 + (c[2] - base[2]) ** 2);
    if (dark[p]! >= INK_DELTA) ink[p] = 1;
  }
  const size = patchSizes(ink, res), speck = Math.max(1, Math.round(SPECK_MM2 / (pixelMm * pixelMm)));
  // where a pin may stand: on ink, the gap inside the outline
  const b = frameBounds(o), c = (res - 1) / 2, round = !isRect(o), reach2 = Math.max(0, c - gap) ** 2;
  const xs: number[] = [], ys: number[] = [], value: number[] = [];
  let pick = -1, darkest = 0;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
    const p = y * res + x;
    if (!ink[p] || size[p]! < speck) continue;
    if (round ? !((x - c) ** 2 + (y - c) ** 2 <= reach2 && c >= gap) : Math.min(x - b.x0, b.x1 - x, y - b.y0, b.y1 - y) < gap) continue;
    if (dark[p]! > darkest) { darkest = dark[p]!; pick = xs.length; }
    xs.push(x);
    ys.push(y);
    value.push(Math.sqrt(dark[p]! * weight[p]!));
  }
  const n = xs.length, near = new Float64Array(n).fill(Infinity), placed: [number, number][] = [];
  while (pick >= 0 && placed.length < want) {
    const sx = xs[pick]!, sy = ys[pick]!;
    placed.push([sx, sy]);
    let best = 0;
    pick = -1;
    for (let i = 0; i < n; i++) {
      const dx = xs[i]! - sx, dy = ys[i]! - sy, d = Math.sqrt(dx * dx + dy * dy);
      if (d < near[i]!) near[i] = d;
      if (near[i]! >= gap) { const v = near[i]! * value[i]!; if (v > best) { best = v; pick = i; } }
    }
  }
  // numbered down the page: band by band from the top of the frame, left to right in a band
  const band = BAND_MM / pixelMm, top = round ? 0 : b.y0;
  placed.sort((p, q) => Math.floor((p[1] - top) / band) - Math.floor((q[1] - top) / band) || p[0] - q[0] || p[1] - q[1]);
  const unit = (v: number): number => Number((v / (res - 1)).toFixed(6));
  return placed.flatMap(([x, y]) => [unit(x), unit(y)]);
}
