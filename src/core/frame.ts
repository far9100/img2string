// The frame (spec §3): where its pins are, what lies inside it, which two pins a thread may join, and lengths
// on it. A round frame is stringart.ts's own, reached through here, so a round piece is the same to the last
// bit. A rectangular frame has the picture's proportions and its pins along its four sides (DECISIONS D-58).
// Nothing else in the app works out a pin position: tests/core/frame.test.ts scans the sources for it.
//
// A rectangle lies in the square working grid with its longer side across the whole of it (res - 1 pixels,
// frame.diameterMm millimetres), centred, so a pixel is diameterMm / (res - 1) mm for both shapes. Its geometry
// is first worked out without any size, in units of the longer side: how many pins a side gets and where they
// are depend on the proportions alone, and every size (pixels for the generator, millimetres for the template)
// is that geometry scaled.
//
// A piece may also have pins inside the picture (DECISIONS D-60). They come after the frame's pins, so pin
// numbers go on where the frame's end, and they are held the same way: x and y as fractions of the working
// grid's span. Where they stand is worked out from the picture (inside.ts); what this module knows about them
// is which two pins a thread may then join, how a thread gets round the frame from one of its pins to another
// without crossing the picture, and how a sequence says so.
import { circDist, circleMask, pinPositions, threadLengthMm, type Options } from "./stringart.ts";

export const FRAME_SHAPES = ["circle", "rect"] as const;
export type FrameShape = (typeof FRAME_SHAPES)[number];

/** A rectangular frame's width / height stays within these; a picture longer than that is cropped. */
export const ASPECT_LIMITS = [0.25, 4] as const;
export const clampAspect = (a: unknown): number => (typeof a === "number" && Number.isFinite(a) && a > 0 ? Math.min(ASPECT_LIMITS[1], Math.max(ASPECT_LIMITS[0], a)) : 1);

/** A frame without its size. Without a shape it is the circle; `aspect` (width / height) counts for a rectangle only. */
export interface FrameSpec { shape?: FrameShape; aspect?: number }

/** What places the frame's pins. */
export interface Layout extends FrameSpec { pins: number }

/** The frame's pins and, after them, the pins inside the picture: x then y per pin, as fractions of the working
 * grid's span (the frame's longer side), so a pin is that fraction of res - 1 pixels, or of diameterMm
 * millimetres, from the grid's left and top. Without `inside` (or with none in it) there are only the frame's. */
export interface AllPins extends Layout { inside?: ArrayLike<number> }

/** The §12 options with the frame's shape, and for a piece with pins inside the picture where those are and
 * how thick a pin is (it decides how near a thread may pass one): what the generator and the renders are given.
 * `pins` stays the number of pins on the frame. */
export interface FrameOptions extends Options { shape?: FrameShape; aspect?: number; inside?: ArrayLike<number>; pinDiameterMm?: number }

export const isRect = (f: { shape?: FrameShape }): boolean => f.shape === "rect";

/** How many pins stand inside the picture, and how many pins there are in all. */
export const insideCount = (o: { inside?: ArrayLike<number> }): number => (o.inside ? o.inside.length >> 1 : 0);
export const pinCount = (o: AllPins): number => o.pins + insideCount(o);

// ---------- a thread's way from pin to pin

/**
 * A sequence holds the pins a thread goes to, in order. On a piece with pins inside the picture a thread
 * sometimes goes round the outside of the frame from one frame pin to another, without crossing the picture
 * (D-60); the pin it reaches that way is held as -(pin + 1). Whoever reads a sequence reads it through these:
 * a pin taken as it stands would be negative, and no pin is.
 */
export const roundTo = (pin: number): number => -pin - 1;
export const isRound = (entry: number): boolean => entry < 0;
export const pinOf = (entry: number): number => (entry < 0 ? -entry - 1 : entry);

// ---------- a rectangle without a size

/** A rectangle's sides in units of its longer side. */
export function unitSides(aspect: number): { w: number; h: number } {
  const a = clampAspect(aspect);
  return a >= 1 ? { w: 1, h: 1 / a } : { w: a, h: 1 };
}

/** Pins on the top, right, bottom and left side: top and bottom the same, in proportion to their length, the
 * rest shared by right and left (right takes the odd one). */
export function sideCounts(pins: number, aspect: number): [number, number, number, number] {
  const a = clampAspect(aspect);
  const top = Math.max(1, Math.min(Math.floor((pins - 2) / 2), Math.round((pins * a) / (2 * (a + 1))))), rest = pins - 2 * top;
  return [top, Math.ceil(rest / 2), top, Math.floor(rest / 2)];
}

export const SIDES = ["top", "right", "bottom", "left"] as const;
export type Side = (typeof SIDES)[number];

/** Which side every pin is on (0 top, 1 right, 2 bottom, 3 left). */
function sidesOf(pins: number, aspect: number): Uint8Array {
  const counts = sideCounts(pins, aspect), side = new Uint8Array(pins);
  for (let s = 0, i = 0; s < 4; s++) for (let j = 0; j < counts[s]!; j++) side[i++] = s;
  return side;
}

/**
 * Pin centres in a unit square, the rectangle centred in it and its longer side 1: x to the right, y down.
 * Pin 0 is the first pin of the top side, next to the top left corner, and the numbers run clockwise as seen
 * from the front: along the top to the right, down the right side, back along the bottom, up the left side.
 * A side's pins are evenly spaced and stop half a step short of its corners, so no pin stands on a corner.
 */
export function unitPins(pins: number, aspect: number): Float64Array {
  const { w, h } = unitSides(aspect), [top, right, bottom, left] = sideCounts(pins, aspect), x0 = (1 - w) / 2, y0 = (1 - h) / 2;
  const P = new Float64Array(2 * pins);
  let i = 0;
  for (let j = 0; j < top; j++, i++) { P[2 * i] = x0 + ((j + 0.5) / top) * w; P[2 * i + 1] = y0; }
  for (let j = 0; j < right; j++, i++) { P[2 * i] = x0 + w; P[2 * i + 1] = y0 + ((j + 0.5) / right) * h; }
  for (let j = 0; j < bottom; j++, i++) { P[2 * i] = x0 + w - ((j + 0.5) / bottom) * w; P[2 * i + 1] = y0 + h; }
  for (let j = 0; j < left; j++, i++) { P[2 * i] = x0; P[2 * i + 1] = y0 + h - ((j + 0.5) / left) * h; }
  return P;
}

/** Where a pin of a rectangular frame is: its side, and its place along that side counted from 1 the way the
 * pins are numbered (clockwise: from the left on the top, from the top on the right, from the right on the
 * bottom, from the bottom on the left). Null for the circle, which has a clock position instead. */
export interface Place { side: Side; n: number; of: number }
export function pinPlace(layout: Layout, pin0: number): Place | null {
  if (!isRect(layout)) return null;
  const counts = sideCounts(layout.pins, layout.aspect ?? 1);
  let i = ((pin0 % layout.pins) + layout.pins) % layout.pins;
  for (let s = 0; s < 4; s++) {
    if (i < counts[s]!) return { side: SIDES[s]!, n: i + 1, of: counts[s]! };
    i -= counts[s]!;
  }
  return null;
}

// ---------- on the working grid

/** Pin centres on the working grid (pixel centres at whole numbers), x then y per pin: the frame's pins, then
 * those inside the picture when there are any. */
export function framePins(o: AllPins & { res: number }): Float64Array {
  const M = insideCount(o);
  if (M) {
    const F = o.pins, L = o.res - 1, P = new Float64Array(2 * (F + M));
    P.set(framePins({ pins: F, res: o.res, shape: o.shape, aspect: o.aspect }));
    for (let i = 0; i < 2 * M; i++) P[2 * F + i] = o.inside![i]! * L;
    return P;
  }
  if (!isRect(o)) return pinPositions(o.pins, o.res);
  const P = unitPins(o.pins, o.aspect ?? 1), L = o.res - 1;
  for (let i = 0; i < P.length; i++) P[i]! *= L;
  return P;
}

/** Every pin in the unit square of the working grid, x then y: the frame's, then those inside the picture. */
export function unitAll(o: AllPins): Float64Array {
  const F = o.pins, M = insideCount(o), U = new Float64Array(2 * (F + M));
  if (isRect(o)) U.set(unitPins(F, o.aspect ?? 1));
  else {
    for (let i = 0; i < F; i++) {
      const t = -Math.PI / 2 + (2 * Math.PI * i) / F; // pin 0 at the top, clockwise on a page whose y points down
      U[2 * i] = 0.5 + 0.5 * Math.cos(t);
      U[2 * i + 1] = 0.5 + 0.5 * Math.sin(t);
    }
  }
  for (let i = 0; i < 2 * M; i++) U[2 * F + i] = o.inside![i]!;
  return U;
}

/** The frame's bounding box on the working grid: the whole grid for a circle. */
export function frameBounds(o: { res: number; shape?: FrameShape; aspect?: number }): { x0: number; y0: number; x1: number; y1: number } {
  const L = o.res - 1;
  if (!isRect(o)) return { x0: 0, y0: 0, x1: L, y1: L };
  const { w, h } = unitSides(o.aspect ?? 1);
  return { x0: ((1 - w) / 2) * L, y0: ((1 - h) / 2) * L, x1: ((1 + w) / 2) * L, y1: ((1 + h) / 2) * L };
}

/** The pixels a rectangular frame holds, as whole columns and rows: those whose centre is on or inside its outline. */
export function framePixels(o: { res: number; shape?: FrameShape; aspect?: number }): { x0: number; y0: number; x1: number; y1: number } {
  const b = frameBounds(o), EPS = 1e-9;
  return { x0: Math.ceil(b.x0 - EPS), y0: Math.ceil(b.y0 - EPS), x1: Math.floor(b.x1 + EPS), y1: Math.floor(b.y1 + EPS) };
}

/** 1 for a pixel inside the frame, 0 outside: the weight map before any importance is painted on it. */
export function frameMask(o: { res: number; shape?: FrameShape; aspect?: number }): Float64Array {
  if (!isRect(o)) return circleMask(o.res);
  const res = o.res, W = new Float64Array(res * res), b = framePixels(o);
  for (let y = b.y0; y <= b.y1; y++) W.fill(1, y * res + b.x0, y * res + b.x1 + 1);
  return W;
}

/** For a rectangle, the steepest angle the "minimum skip" asks of a line where it leaves a side (see allowedPairs). */
const MAX_LEAVE = Math.PI / 6;

/**
 * Which two pins a thread may join: 1 at [u * pins + v]. On the circle, pins at least minSkip apart round it,
 * exactly as the generator of §5.1 tests it. On a rectangle, pins on two different sides, at least minSkip
 * apart round the frame, whose line leaves both sides at no less than (minSkip - 1) x 180 / pins degrees (30
 * at most). That is the circle's rule on a straight side: on a circle the pin next to an end is the pin
 * spacing x sin((skip - 1) x 180 / pins degrees) from the line, on a straight side spacing x sin(the angle
 * to the side), so with the same minimum the thread passes its neighbours at the same distance (D-58).
 *
 * With pins inside the picture the table is (pins + those) square and joinRule() says what it holds (D-60);
 * it is then the caller's to read, not to change: the last one made is kept and handed out again.
 */
export function allowedPairs(o: Joinable): Uint8Array {
  if (insideCount(o)) return withInside(o);
  const N = o.pins, ok = new Uint8Array(N * N);
  if (!isRect(o)) {
    for (let u = 0; u < N; u++) for (let v = 0; v < N; v++) if (circDist(u, v, N) >= o.minSkip) ok[u * N + v] = 1;
    return ok;
  }
  const P = unitPins(N, o.aspect ?? 1), side = sidesOf(N, o.aspect ?? 1);
  const least = Math.sin(Math.min(MAX_LEAVE, ((o.minSkip - 1) * Math.PI) / N)) - 1e-12;
  for (let u = 0; u < N; u++) for (let v = u + 1; v < N; v++) {
    if (side[u] === side[v] || circDist(u, v, N) < o.minSkip) continue;
    const dx = Math.abs(P[2 * v]! - P[2 * u]!), dy = Math.abs(P[2 * v + 1]! - P[2 * u + 1]!), length = Math.hypot(dx, dy);
    // the sine of the angle to a horizontal side (top, bottom) is dy / length, to a vertical one dx / length
    if ((side[u]! % 2 ? dx : dy) < least * length || (side[v]! % 2 ? dx : dy) < least * length) continue;
    ok[u * N + v] = ok[v * N + u] = 1;
  }
  return ok;
}

// ---------- with pins inside the picture

/** What decides which pins may be joined: the frame and its minimum skip and, with pins inside the picture,
 * where those are and the three lengths the clearance is made of. */
export type Joinable = AllPins & { minSkip: number; diameterMm?: number; threadWidthMm?: number; pinDiameterMm?: number };

/** Air between a thread and a pin it passes (mm). */
export const CLEARANCE_AIR_MM = 0.5;

/**
 * How near the middle of a thread may pass to a pin it does not go to, pin centre to line: the pin's radius,
 * the thread's, and half a millimetre of air. 1.375 mm at the defaults, which is the round frame's own rule:
 * with 256 pins on 500 mm, a chord 19 pins long passes 1.344 mm from the pin next to its end and one 20 long
 * 1.418 mm, and the minimum skip there is 20.
 */
export const clearanceMm = (o: { threadWidthMm?: number; pinDiameterMm?: number }): number => (o.pinDiameterMm ?? 1.5) / 2 + (o.threadWidthMm ?? 0.25) / 2 + CLEARANCE_AIR_MM;

/**
 * Says which two pins a thread may join on a piece with pins inside the picture (D-60):
 *  - two pins of the frame: what the frame alone allows, unless the line passes a pin inside within the clearance;
 *  - any pair with a pin inside: unless the line passes a third pin, on the frame or inside, within the clearance.
 * `slack` below 1 lets a line pass that much nearer: a stored piece is checked with a little of it, so that a
 * last digit that differs between two browsers cannot turn a piece one of them made into one the other rejects.
 *
 * The test is exact (each pin near the line is tried, found through a grid of buckets) and uses nothing but
 * sums, products, one quotient and a comparison of squares.
 */
export function joinRule(o: Joinable, slack = 1): (u: number, v: number) => boolean {
  const F = o.pins, M = insideCount(o), N = F + M;
  const frame = allowedPairs({ pins: F, minSkip: o.minSkip, shape: o.shape, aspect: o.aspect });
  if (!M) return (u, v) => frame[u * F + v] === 1;
  const U = unitAll(o), clear = (slack * clearanceMm(o)) / (o.diameterMm ?? 500), clear2 = clear * clear;
  // A pin within the clearance of a line is within three quarters of a cell of one of the points the line is
  // walked by (half a cell apart; the clearance is at most half a cell), so it is in that point's bucket or one beside it.
  const cell = Math.max(0.02, 2 * clear), G = Math.ceil(1 / cell) + 3;
  const first = new Int32Array(G * G).fill(-1), next = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const b = (Math.floor(U[2 * i + 1]! / cell) + 1) * G + Math.floor(U[2 * i]! / cell) + 1;
    next[i] = first[b]!;
    first[b] = i;
  }
  /** Whether a pin numbered `from` or higher, other than the line's own two, is within the clearance of the line. */
  const blocked = (u: number, v: number, from: number): boolean => {
    const ax = U[2 * u]!, ay = U[2 * u + 1]!, dx = U[2 * v]! - ax, dy = U[2 * v + 1]! - ay, len2 = dx * dx + dy * dy;
    if (!(len2 > 0)) return true; // two pins on one spot: no line
    const steps = Math.max(1, Math.ceil(Math.sqrt(len2) / (cell / 2)));
    let last = -1;
    for (let s = 0; s <= steps; s++) {
      const cx = Math.floor((ax + (dx * s) / steps) / cell) + 1, cy = Math.floor((ay + (dy * s) / steps) / cell) + 1;
      if (cy * G + cx === last) continue;
      last = cy * G + cx;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        for (let w = first[(cy + j) * G + cx + i]!; w >= 0; w = next[w]!) {
          if (w < from || w === u || w === v) continue;
          const px = U[2 * w]! - ax, py = U[2 * w + 1]! - ay, along = (px * dx + py * dy) / len2, t = along < 0 ? 0 : along > 1 ? 1 : along;
          const ex = px - t * dx, ey = py - t * dy;
          if (ex * ex + ey * ey < clear2) return true;
        }
      }
    }
    return false;
  };
  return (u, v) => u !== v && (u < F && v < F ? frame[u * F + v] === 1 && !blocked(u, v, F) : !blocked(u, v, 0));
}

/** The table of the last piece with pins inside, kept because working it out takes a few tenths of a second
 * and a search runs the same piece many times over (the automatic adjustment: forty times). */
let lastTable: { key: string; inside: Float64Array; table: Uint8Array } | null = null;

function withInside(o: Joinable): Uint8Array {
  const inside = o.inside!, key = [o.pins, o.shape ?? "circle", o.aspect ?? 1, o.minSkip, o.diameterMm ?? 500, o.threadWidthMm ?? 0.25, o.pinDiameterMm ?? 1.5].join("|");
  const kept = lastTable;
  if (kept && kept.key === key && kept.inside.length === inside.length && kept.inside.every((v, i) => v === inside[i])) return kept.table;
  const N = pinCount(o), ok = new Uint8Array(N * N), may = joinRule(o);
  for (let u = 0; u < N; u++) for (let v = u + 1; v < N; v++) if (may(u, v)) ok[u * N + v] = ok[v * N + u] = 1;
  lastTable = { key, inside: Float64Array.from(inside), table: ok };
  return ok;
}

/** Where the frame's pins are along its outline, from pin 0 clockwise, in units of the frame's longer side,
 * and how long the outline is. */
function alongFrame(o: Layout): { at: Float64Array; whole: number } {
  const F = o.pins, at = new Float64Array(F);
  if (!isRect(o)) {
    for (let i = 0; i < F; i++) at[i] = (Math.PI * i) / F;
    return { at, whole: Math.PI };
  }
  const { w, h } = unitSides(o.aspect ?? 1), [top, right, bottom, left] = sideCounts(F, o.aspect ?? 1);
  let i = 0;
  for (let j = 0; j < top; j++) at[i++] = ((j + 0.5) / top) * w;
  for (let j = 0; j < right; j++) at[i++] = w + ((j + 0.5) / right) * h;
  for (let j = 0; j < bottom; j++) at[i++] = w + h + ((j + 0.5) / bottom) * w;
  for (let j = 0; j < left; j++) at[i++] = 2 * w + h + ((j + 0.5) / left) * h;
  return { at, whole: 2 * (w + h) };
}

/** The way round the outside of the frame from one of its pins to another: the shorter one (clockwise when
 * both are as long), its length in units of the frame's longer side. */
export function aroundFrame(o: Layout, a: number, b: number): { length: number; clockwise: boolean } {
  const { at, whole } = alongFrame(o), on = at[b]! - at[a]!, back = at[a]! - at[b]!;
  const clockwise = on < 0 ? on + whole : on, anticlockwise = back < 0 ? back + whole : back;
  return clockwise <= anticlockwise ? { length: clockwise, clockwise: true } : { length: anticlockwise, clockwise: false };
}

/** A pin inside the picture (the j-th of `inside`), in millimetres from the left and from the top of the
 * frame's own box: the square round a circle, the rectangle itself. */
export function insideMm(frame: FrameSpec & { diameterMm: number }, inside: ArrayLike<number>, j: number): { left: number; top: number } {
  const { w, h } = isRect(frame) ? unitSides(frame.aspect ?? 1) : { w: 1, h: 1 };
  return { left: (inside[2 * j]! - (1 - w) / 2) * frame.diameterMm, top: (inside[2 * j + 1]! - (1 - h) / 2) * frame.diameterMm };
}

/** Whether the frame's pins stand so close that hardly a line can leave the frame for a pin inside: a line
 * passes the pin next to its end at the pin spacing x the sine of its angle to the frame, so below twice the
 * clearance only lines steeper than 30 degrees are left, and below the clearance itself none. */
export const tooDenseForInside = (frame: Layout & { diameterMm: number; pinDiameterMm?: number }, threadWidthMm: number): boolean =>
  pinSpacingMm(frame).along < 2 * clearanceMm({ threadWidthMm, pinDiameterMm: frame.pinDiameterMm });

// ---------- in millimetres

/** The frame's width and height: both the diameter for a circle; for a rectangle the longer one is `diameterMm`. */
export function frameSizeMm(frame: { diameterMm: number; shape?: FrameShape; aspect?: number }): { width: number; height: number } {
  if (!isRect(frame)) return { width: frame.diameterMm, height: frame.diameterMm };
  const { w, h } = unitSides(frame.aspect ?? 1);
  return { width: w * frame.diameterMm, height: h * frame.diameterMm };
}

/** A rectangular frame's pin centres in millimetres from its top left corner, x then y per pin, and the side
 * (0 top, 1 right, 2 bottom, 3 left) each pin is on. (The round template keeps its own polar drawing.) */
export function rectPinsMm(frame: Layout & { diameterMm: number }): { at: Float64Array; side: Uint8Array } {
  const aspect = frame.aspect ?? 1, P = unitPins(frame.pins, aspect), { w, h } = unitSides(aspect), x0 = (1 - w) / 2, y0 = (1 - h) / 2;
  for (let i = 0; i < frame.pins; i++) { P[2 * i] = (P[2 * i]! - x0) * frame.diameterMm; P[2 * i + 1] = (P[2 * i + 1]! - y0) * frame.diameterMm; }
  return { at: P, side: sidesOf(frame.pins, aspect) };
}

/** Thread needed for one sequence: the lines plus a wrap allowance per pin (half the pin's circumference). On a
 * piece with pins inside the picture a step round the frame takes the shorter way along its outline. */
export function frameThreadMm(o: FrameOptions, seq: readonly number[], pinDiameterMm = 1.5): number {
  const pinned = insideCount(o) > 0;
  if (!isRect(o) && !pinned) return threadLengthMm(seq as number[], o, pinDiameterMm);
  const P = pinned ? unitAll(o) : unitPins(o.pins, o.aspect ?? 1);
  let length = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = pinOf(seq[i - 1]!), b = pinOf(seq[i]!);
    const run = isRound(seq[i]!) ? aroundFrame(o, a, b).length : Math.hypot(P[2 * b]! - P[2 * a]!, P[2 * b + 1]! - P[2 * a + 1]!);
    length += run * o.diameterMm + (Math.PI * pinDiameterMm) / 2;
  }
  return length;
}

/** How far apart the pins are: along the frame, and the two that are nearest each other (on a rectangle the
 * pair either side of a corner, 0.71 of the spacing apart). */
export function pinSpacingMm(frame: Layout & { diameterMm: number }): { along: number; nearest: number } {
  if (!isRect(frame)) { const along = (Math.PI * frame.diameterMm) / frame.pins; return { along, nearest: along }; }
  const { width, height } = frameSizeMm(frame), [top, right, , left] = sideCounts(frame.pins, frame.aspect ?? 1);
  const across = width / top, down = Math.min(height / right, height / Math.max(1, left));
  return { along: (2 * (width + height)) / frame.pins, nearest: Math.min(across, down, Math.hypot(across / 2, down / 2)) };
}

// ---------- the picture in the frame

/** The proportions a rectangular frame takes from a picture: its width / height, or the other way round when
 * the picture is turned nearer to a quarter turn than to upright. */
export function pictureAspect(width: number, height: number, rotateDeg = 0): number {
  if (!(width > 0 && height > 0)) return 1;
  const t = (rotateDeg * Math.PI) / 180, turned = Math.abs(Math.sin(t)) > Math.abs(Math.cos(t)) + 1e-12;
  return clampAspect(turned ? height / width : width / height);
}

/** Working pixels of picture a rectangular frame keeps beyond its outline, all round (see cropSpan). */
export const FRAME_SPARE = 2;

/**
 * Picture pixels across the working grid at scale 1 (the `span` of cropTransform). For the circle it is the
 * picture's short side: the pin circle then lies on it, and stays inside the picture however it is turned.
 * For a rectangle it is what makes the picture just cover the frame, as turned, with FRAME_SPARE working
 * pixels to spare all round: a pixel on the frame's outline must not be part board, or the frame's own edge
 * would be sharpened and emphasised as if it were in the picture (D-58). Two pixels, because the cropper lets
 * the board show through the picture's last pixel and three quarters: it reads a quarter pixel either side of
 * a pixel's centre, between the centres of a picture it has first shrunk by whole blocks, the last of which
 * may be part empty. With the picture's own proportions and no turn, the frame then shows the whole picture
 * but those two pixels.
 */
export function cropSpan(frame: { shape?: FrameShape; aspect?: number }, rotateDeg: number, width: number, height: number, res: number): number {
  if (!isRect(frame)) return Math.min(width, height);
  const L = res - 1, { w, h } = unitSides(frame.aspect ?? 1), W = w * L + 2 * FRAME_SPARE, H = h * L + 2 * FRAME_SPARE;
  const quarter = (((rotateDeg % 360) + 360) % 360) / 90, exact = Number.isInteger(quarter), t = (rotateDeg * Math.PI) / 180;
  const cos = Math.abs(exact ? [1, 0, -1, 0][quarter]! : Math.cos(t)), sin = Math.abs(exact ? [0, 1, 0, -1][quarter]! : Math.sin(t));
  return L * Math.min(width / (W * cos + H * sin), height / (H * cos + W * sin));
}
