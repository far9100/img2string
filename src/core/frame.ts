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
import { circDist, circleMask, pinPositions, threadLengthMm, type Options } from "./stringart.ts";

export const FRAME_SHAPES = ["circle", "rect"] as const;
export type FrameShape = (typeof FRAME_SHAPES)[number];

/** A rectangular frame's width / height stays within these; a picture longer than that is cropped. */
export const ASPECT_LIMITS = [0.25, 4] as const;
export const clampAspect = (a: unknown): number => (typeof a === "number" && Number.isFinite(a) && a > 0 ? Math.min(ASPECT_LIMITS[1], Math.max(ASPECT_LIMITS[0], a)) : 1);

/** A frame without its size. Without a shape it is the circle; `aspect` (width / height) counts for a rectangle only. */
export interface FrameSpec { shape?: FrameShape; aspect?: number }

/** What places the pins. */
export interface Layout extends FrameSpec { pins: number }

/** The §12 options with the frame's shape: what the generator and the renders are given. */
export interface FrameOptions extends Options { shape?: FrameShape; aspect?: number }

export const isRect = (f: { shape?: FrameShape }): boolean => f.shape === "rect";

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

/** Pin centres on the working grid (pixel centres at whole numbers), x then y per pin. */
export function framePins(o: Layout & { res: number }): Float64Array {
  if (!isRect(o)) return pinPositions(o.pins, o.res);
  const P = unitPins(o.pins, o.aspect ?? 1), L = o.res - 1;
  for (let i = 0; i < P.length; i++) P[i]! *= L;
  return P;
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
 */
export function allowedPairs(o: Layout & { minSkip: number }): Uint8Array {
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

/** Thread needed for one sequence: the lines plus a wrap allowance per pin (half the pin's circumference). */
export function frameThreadMm(o: FrameOptions, seq: readonly number[], pinDiameterMm = 1.5): number {
  if (!isRect(o)) return threadLengthMm(seq as number[], o, pinDiameterMm);
  const P = unitPins(o.pins, o.aspect ?? 1);
  let length = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = seq[i - 1]!, b = seq[i]!;
    length += Math.hypot(P[2 * b]! - P[2 * a]!, P[2 * b + 1]! - P[2 * a + 1]!) * o.diameterMm + (Math.PI * pinDiameterMm) / 2;
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
