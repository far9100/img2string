// The nail template (spec §7.2) at 1:1 in millimetres, y down, as shared primitives: the same drawing is
// tiled into the PDF, written as SVG and shown on screen. The drawing is exactly the board (D + 40 mm, §7.5),
// with the pin circle in its middle. Pin 1 is at the top and the numbers grow clockwise, as seen from the
// front of the finished piece (§2), so the print is laid on the board face up and nailed through.
// The drawing carries no words, only numbers: it is the same in every language. No DOM here.
//
// A rectangular frame (DECISIONS D-58) gets the same things in the same sizes: the board is the frame plus the
// margin all round, the pins stand where frame.ts puts them (pin 1 next to the top left corner, numbers
// growing clockwise), and what the round template draws along the radius is drawn at right angles to the side
// a pin is on, out into the margin.
//
// A piece with pins inside the picture (DECISIONS D-60) has those drawn as well: the same small circle, a
// cross through its centre (the nail goes where its two hairs cross) and, beside it, the pin's number, every
// one of them, since there is no counting along a frame to find a pin inside. The pins stand at least 6 mm
// apart (inside.ts), which is what keeps a number clear of the next pin and of the next number.
import { frameSizeMm, insideMm, pinSpacingMm, rectPinsMm } from "../core/frame.ts";
import { BOARD_MARGIN_MM, boardSizeMm } from "../core/instructions.ts";
import type { Frame } from "../core/project.ts";
import type { Drawing, Prim, Vec } from "./prims.ts";

export const TEMPLATE_INK = "#1c1d1f";

/** Digits of the label font (Noto Sans TC, tabular): advance and height in units of the text size. Only used
 * to keep the numbers clear of the ticks; the back ends measure real text themselves. */
const DIGIT_W = 0.555, DIGIT_H = 0.733;
/** Radial lengths (mm): the gap between a pin and its tick, the ticks at every 5th and 10th pin, the arms of
 * the centre cross and of the cross-hair through every pin, the leader of pin 1 and its clockwise arrow. */
const TICK_GAP = 1.6, TICK_5 = 2.5, TICK_10 = 4, CENTRE_ARM = 6, HAIR = 0.9, LEADER = 7.5, ARROW = 16;
const NUMBER_MAX = 3, NUMBER_MIN = 1.5, ONE_SIZE = 4;
/** For a pin inside the picture (mm): the arms of its cross beyond the pin, the gap between the cross and the
 * number, and the number's size, smaller once it has four digits so that it is no wider. */
const INSIDE_HAIR = 0.6, INSIDE_GAP = 0.4, INSIDE_NUMBER = 1.6, INSIDE_NUMBER_LONG = 1.3;

/** Side of the board (D + 40 mm, §7.5), which is also the side of the drawing: the longer side for a rectangle. */
export const boardSide = (frame: Frame): number => frame.diameterMm + 2 * BOARD_MARGIN_MM;

/** The board, which is also the drawing: the frame and the margin all round. A square of D + 40 mm for a circle. */
export const boardSize = (frame: Frame): { width: number; height: number } => boardSizeMm(frame);

/** Unit vector from the centre to pin i (0-based): pin 0 points up and the angle grows clockwise on a y-down
 * page, exactly as pinPositions() of the core places the pins on the working grid (§3). */
function pinDir(i: number, pins: number): Vec {
  const a = -Math.PI / 2 + (2 * Math.PI * i) / pins;
  return [Math.cos(a), Math.sin(a)];
}

/** Centre of every pin in the drawing's coordinates (mm), for tests, the DXF and the lines: the frame's pins
 * and, with `inside` (a piece's pins inside the picture, as its result holds them), those after them. */
export function templatePins(frame: Frame, inside?: ArrayLike<number>): [number, number][] {
  return inside && inside.length ? [...framePinsMm(frame), ...insidePinsMm(frame, inside)] : framePinsMm(frame);
}

function framePinsMm(frame: Frame): [number, number][] {
  if (frame.shape === "rect") {
    const { at } = rectPinsMm(frame);
    return Array.from({ length: frame.pins }, (_, i): [number, number] => [BOARD_MARGIN_MM + at[2 * i]!, BOARD_MARGIN_MM + at[2 * i + 1]!]);
  }
  const c = boardSide(frame) / 2, r = frame.diameterMm / 2;
  return Array.from({ length: frame.pins }, (_, i): [number, number] => {
    const [ux, uy] = pinDir(i, frame.pins);
    return [c + r * ux, c + r * uy];
  });
}

/** The pins inside the picture: the frame's own box begins the margin in from the board's left and top. */
function insidePinsMm(frame: Frame, inside: ArrayLike<number>): [number, number][] {
  const box = frame.shape === "rect" ? { diameterMm: frame.diameterMm, shape: "rect" as const, aspect: frame.aspect } : { diameterMm: frame.diameterMm };
  return Array.from({ length: inside.length >> 1 }, (_, j): [number, number] => {
    const { left, top } = insideMm(box, inside, j);
    return [BOARD_MARGIN_MM + left, BOARD_MARGIN_MM + top];
  });
}

/** The drawing in the four groups the SVG keeps apart (and the DXF calls BOARD, FRAME, MARKS and PINS), so a
 * drilling program can pick the pins alone. */
export interface TemplateLayers {
  /** The board's outline: a square of D + 40 mm, which is also the drawing's edge. */
  board: Prim[];
  /** The pin circle, or the rectangle the pins stand on. */
  frame: Prim[];
  /** Everything that is only read: ticks, numbers, the arrow at pin 1, the centre cross, a cross-hair per pin. */
  marks: Prim[];
  /** One circle of the pin's diameter per pin, in pin order, and nothing else. */
  pins: Prim[];
}

/** Unit vectors out of a rectangular frame at its top, right, bottom and left side (y points down). */
const OUTWARD: readonly Vec[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function rectLayers(frame: Frame): TemplateLayers {
  const { width: w, height: h } = frameSizeMm(frame), M = BOARD_MARGIN_MM, W = w + 2 * M, H = h + 2 * M, N = frame.pins, pr = frame.pinDiameterMm / 2;
  const ink = TEMPLATE_INK, { at, side } = rectPinsMm(frame);
  const board: Prim[] = [{ t: "poly", pts: [[0, 0], [W, 0], [W, H], [0, H]], stroke: ink, width: 0.4 }];
  const outline: Prim[] = [{ t: "poly", pts: [[M, M], [M + w, M], [M + w, M + h], [M, M + h]], stroke: ink, width: 0.15 }];
  const marks: Prim[] = [
    { t: "line", a: [W / 2 - CENTRE_ARM, H / 2], b: [W / 2 + CENTRE_ARM, H / 2], stroke: ink, width: 0.25 },
    { t: "line", a: [W / 2, H / 2 - CENTRE_ARM], b: [W / 2, H / 2 + CENTRE_ARM], stroke: ink, width: 0.25 },
  ];
  const pins: Prim[] = [];

  // Numbers shrink on crowded frames so that neighbours, five pins apart, never touch.
  const size = Math.min(NUMBER_MAX, Math.max(NUMBER_MIN, 0.45 * 5 * pinSpacingMm(frame).along));
  const base = pr + TICK_GAP, numbers = base + TICK_10 + 0.8;
  for (let i = 0; i < N; i++) {
    const x = M + at[2 * i]!, y = M + at[2 * i + 1]!, [ox, oy] = OUTWARD[side[i]!]!;
    const out = (d: number): Vec => [x + d * ox, y + d * oy];
    pins.push({ t: "circle", c: [x, y], r: pr, stroke: ink, width: 0.2 });
    // the nail goes where this hair crosses the frame's line
    marks.push({ t: "line", a: out(-pr - HAIR), b: out(pr + HAIR), stroke: ink, width: 0.15 });
    const n = i + 1; // the number people see (§2)
    if (n % 5) continue;
    const ten = n % 10 === 0;
    marks.push({ t: "line", a: out(base), b: out(base + (ten ? TICK_10 : TICK_5)), stroke: ink, width: ten ? 0.6 : 0.25 });
    // upright text, pushed out by its own half-extent: half its height above and below, half its width beside
    const label = String(n), tw = label.length * DIGIT_W * size, th = DIGIT_H * size;
    const [lx, ly] = out(numbers + (Math.abs(ox) * tw + Math.abs(oy) * th) / 2);
    marks.push({ t: "text", at: [lx, ly + th / 2], text: label, size, color: ink, align: "center", bold: ten });
  }

  // Pin 1, next to the top left corner: a long leader, a large "1" above it, and an arrow along the top side to
  // the right, which is clockwise. The arrow runs at the number's mid height, above the small numbers.
  const x1 = M + at[0]!, y1 = M + at[1]!, top = base + LEADER, h1 = DIGIT_H * ONE_SIZE, w1 = DIGIT_W * ONE_SIZE;
  marks.push({ t: "line", a: [x1, y1 - base], b: [x1, y1 - top], stroke: ink, width: 0.6 });
  marks.push({ t: "text", at: [x1, y1 - top - 0.9], text: "1", size: ONE_SIZE, color: ink, align: "center", bold: true });
  const ya = y1 - top - 0.9 - h1 / 2, xa = x1 + w1 / 2 + 1.8, xb = xa + ARROW;
  marks.push({ t: "path", d: [{ c: "M", p: [xa, ya] }, { c: "L", p: [xb, ya] }], stroke: ink, width: 0.4 });
  marks.push({ t: "poly", pts: [[xb + 2.8, ya], [xb, ya + 1.1], [xb, ya - 1.1]], fill: ink });

  return { board, frame: outline, marks, pins };
}

export function templateLayers(frame: Frame, inside?: ArrayLike<number>): TemplateLayers {
  const L = frame.shape === "rect" ? rectLayers(frame) : roundLayers(frame);
  if (!inside || !inside.length) return L;
  // every pin inside the picture: its circle, a cross through it, and its number to the right of it
  const ink = TEMPLATE_INK, pr = frame.pinDiameterMm / 2, arm = pr + INSIDE_HAIR;
  insidePinsMm(frame, inside).forEach(([x, y], j) => {
    const label = String(frame.pins + j + 1), size = label.length > 3 ? INSIDE_NUMBER_LONG : INSIDE_NUMBER;
    L.pins.push({ t: "circle", c: [x, y], r: pr, stroke: ink, width: 0.2 });
    L.marks.push(
      { t: "line", a: [x - arm, y], b: [x + arm, y], stroke: ink, width: 0.15 },
      { t: "line", a: [x, y - arm], b: [x, y + arm], stroke: ink, width: 0.15 },
      { t: "text", at: [x + arm + INSIDE_GAP, y + (DIGIT_H * size) / 2], text: label, size, color: ink },
    );
  });
  return L;
}

function roundLayers(frame: Frame): TemplateLayers {
  const N = frame.pins, S = boardSide(frame), c = S / 2, r = frame.diameterMm / 2, pr = frame.pinDiameterMm / 2;
  const ink = TEMPLATE_INK;
  const at = (i: number, radius: number): Vec => {
    const [ux, uy] = pinDir(i, N);
    return [c + radius * ux, c + radius * uy];
  };
  const board: Prim[] = [{ t: "poly", pts: [[0, 0], [S, 0], [S, S], [0, S]], stroke: ink, width: 0.4 }];
  const ring: Prim[] = [{ t: "circle", c: [c, c], r, stroke: ink, width: 0.15 }];
  const marks: Prim[] = [
    { t: "line", a: [c - CENTRE_ARM, c], b: [c + CENTRE_ARM, c], stroke: ink, width: 0.25 },
    { t: "line", a: [c, c - CENTRE_ARM], b: [c, c + CENTRE_ARM], stroke: ink, width: 0.25 },
  ];
  const pins: Prim[] = [];

  // Numbers shrink on crowded frames so that neighbours, five pins apart, never touch.
  const spacing = (Math.PI * frame.diameterMm) / N;
  const size = Math.min(NUMBER_MAX, Math.max(NUMBER_MIN, 0.45 * 5 * spacing));
  const base = r + pr + TICK_GAP;
  const numbers = base + TICK_10 + 0.8;
  for (let i = 0; i < N; i++) {
    pins.push({ t: "circle", c: at(i, r), r: pr, stroke: ink, width: 0.2 });
    // the nail goes where this hair crosses the pin circle
    marks.push({ t: "line", a: at(i, r - pr - HAIR), b: at(i, r + pr + HAIR), stroke: ink, width: 0.15 });
    const n = i + 1; // the number people see (§2)
    if (n % 5) continue;
    const ten = n % 10 === 0;
    marks.push({ t: "line", a: at(i, base), b: at(i, base + (ten ? TICK_10 : TICK_5)), stroke: ink, width: ten ? 0.6 : 0.25 });
    const label = String(n), w = label.length * DIGIT_W * size, h = DIGIT_H * size;
    if (n === N && spacing - w / 2 < 0.9) continue; // the last pin's number would sit on the leader of pin 1
    // upright text, pushed out by its own half-extent along the radius: it clears the tick at every angle
    const [ux, uy] = pinDir(i, N);
    const [x, y] = at(i, numbers + (Math.abs(ux) * w + Math.abs(uy) * h) / 2);
    marks.push({ t: "text", at: [x, y + h / 2], text: label, size, color: ink, align: "center", bold: ten });
  }

  // Pin 1: a long leader, a large "1" above it, and an arrow that leaves it clockwise.
  const top = base + LEADER, h1 = DIGIT_H * ONE_SIZE, w1 = DIGIT_W * ONE_SIZE;
  marks.push({ t: "line", a: at(0, base), b: at(0, top), stroke: ink, width: 0.6 });
  marks.push({ t: "text", at: [c, c - top - 0.9], text: "1", size: ONE_SIZE, color: ink, align: "center", bold: true });
  const ra = top + 0.9 + h1 / 2; // the arc runs at the number's mid height
  const a0 = -Math.PI / 2 + (w1 / 2 + 1.8) / ra, a1 = a0 + ARROW / ra;
  const point = (a: number): Vec => [c + ra * Math.cos(a), c + ra * Math.sin(a)];
  const along = (a: number): Vec => [-Math.sin(a), Math.cos(a)]; // direction of growing angle = clockwise on the page
  const k = (4 / 3) * Math.tan((a1 - a0) / 4) * ra; // one cubic is exact enough for an arc this short
  const p0 = point(a0), p3 = point(a1), t0 = along(a0), t3 = along(a1), out: Vec = [Math.cos(a1), Math.sin(a1)];
  marks.push({ t: "path", d: [{ c: "M", p: p0 }, { c: "C", p1: [p0[0] + k * t0[0], p0[1] + k * t0[1]], p2: [p3[0] - k * t3[0], p3[1] - k * t3[1]], p: p3 }], stroke: ink, width: 0.4 });
  marks.push({ t: "poly", pts: [[p3[0] + 2.8 * t3[0], p3[1] + 2.8 * t3[1]], [p3[0] + 1.1 * out[0], p3[1] + 1.1 * out[1]], [p3[0] - 1.1 * out[0], p3[1] - 1.1 * out[1]]], fill: ink });

  return { board, frame: ring, marks, pins };
}

/** The nail template at 1:1 in mm, y down: the pin circle, every pin (a small circle of the pin's diameter
 * with a cross-hair through its centre), a tick and number every 5 pins and a bolder mark every 10, pin 1 at
 * the top with a clockwise arrow, a centre mark, and the board outline (a square of D + 40 mm). Numbers sit
 * outside the circle. With `inside`, a piece's pins inside the picture too, each with its number. */
export function templateDrawing(frame: Frame, inside?: ArrayLike<number>): Drawing {
  const L = templateLayers(frame, inside), { width, height } = boardSize(frame);
  return { width, height, prims: [...L.board, ...L.frame, ...L.marks, ...L.pins] };
}
