// The nail template as a PDF at 1:1 (spec §7.2): on one page when the board fits the paper, otherwise tiled
// with 10 mm overlaps. Every page carries, in a strip below the drawing, a 100 mm scale bar, "print at 100 %"
// and its place among the pages; tiled pages also get alignment crosses where pages overlap and a dashed
// line where one of two neighbours is to be trimmed. Only what a page can show is written to it.
import type { Paper, Project } from "../core/project.ts";
import { t, type Lang } from "../i18n/translate.ts";
import { DEFAULT_STROKE, primBox, type Prim } from "../render/prims.ts";
import { templateTitle } from "../core/instructions.ts";
import { boardSize, templateDrawing, TEMPLATE_INK } from "../render/template.ts";
import { addPage, clipRect, drawPrims, newDoc, save, textWidthMm } from "./pdfKit.ts";
import { planTiles, type Tile, type TilePlan } from "./tiles.ts";

/** Margin no printer is asked to print in, and the overlap between neighbouring pages (mm). */
export const PRINTER_MARGIN = 5, OVERLAP = 10;
/** Thickness of the scale bar (mm); its length is exactly 100 mm. */
export const BAR_HEIGHT = 0.6;
/** How far the drawing shows beyond a page's drawing area (mm): the board's outline runs along the area's
 * edge on the outer pages, and half its width would otherwise be cut away. */
const BLEED = 0.25;
const INK = TEMPLATE_INK;
const BAND_TEXT = 2.4;
/** Alignment crosses: text size, half length of an arm, distance from the drawing's edge, the gap kept to
 * whatever else is drawn, how far a cross may move to find a clear place, and the room it needs around its
 * centre inside the part two pages share (all mm). */
const MARK_TEXT = 1.8, MARK_ARM = 2.5, MARK_INSET = 4, MARK_CLEAR = 1, MARK_SEARCH = 60, MARK_ROOM = 5;
/** Where the two text lines beside the scale bar start, from the strip's left end (mm). */
const BAND_SIDE = 118;

/** The pages of the template on the given paper (also what the page count shown beside the download is). */
export function templatePlan(frame: Project["frame"], paper: Paper): TilePlan {
  const { width, height } = boardSize(frame);
  return planTiles(width, height, paper, PRINTER_MARGIN, OVERLAP);
}

/** Where the drawing's origin lands on a tile's page (mm from the page's top-left corner). */
export const tileOrigin = (plan: TilePlan, tile: Tile): [number, number] => [plan.contentX - tile.x, plan.contentY - tile.y];

/** A 100 mm scale bar with 10 mm ticks above it, its top-left corner at (x, y): the print can be checked with
 * a ruler (§13.4). The bar is one filled rectangle. Ported from img2fold. */
export function scaleBarPrims(x: number, y: number, label: string, ink: string, textSize = 2.4): Prim[] {
  const rect = (x0: number, y0: number, w: number, h: number): Prim => ({ t: "poly", pts: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], fill: ink });
  const prims: Prim[] = [rect(x, y, 100, BAR_HEIGHT)];
  for (let k = 0; k <= 10; k++) {
    const h = k % 5 === 0 ? 3 : 1.8;
    prims.push(rect(x + k * 10 - 0.15, y - h, 0.3, h));
  }
  prims.push({ t: "text", at: [x + 102, y + BAR_HEIGHT], text: label, size: textSize, color: ink });
  return prims;
}

export interface StripMark {
  x: number;
  y: number;
  /** Which end of a strip the cross marks: where the strip meets the drawing's top, bottom, left or right
   * edge, or a "corner" where a strip between columns crosses one between rows. */
  at: "top" | "bottom" | "left" | "right" | "corner";
  /** The two columns of pages that meet here ("C1|C2"): on the crosses at the top, the bottom and the corners. */
  cols?: string;
  /** The two rows of pages that meet here ("R1|R2"): on the crosses at the left, the right and the corners. */
  rows?: string;
}

type Box = [number, number, number, number];

/** Whether a primitive comes within `pad` mm of a box. Circles are tested as the rings they are (a box well
 * inside the pin circle touches nothing), outlines edge by edge, everything else by its own box, which is
 * tight enough for the template's short ticks and upright text. */
function near(p: Prim, [x0, y0, x1, y1]: Box, pad: number): boolean {
  const hit = (b: Box) => b[2] + pad >= x0 && b[0] - pad <= x1 && b[3] + pad >= y0 && b[1] - pad <= y1;
  if (p.t === "circle") {
    const half = p.stroke ? (p.width ?? DEFAULT_STROKE) / 2 : 0;
    const closest = Math.hypot(Math.max(x0 - p.c[0], 0, p.c[0] - x1), Math.max(y0 - p.c[1], 0, p.c[1] - y1));
    const farthest = Math.hypot(Math.max(Math.abs(x0 - p.c[0]), Math.abs(x1 - p.c[0])), Math.max(Math.abs(y0 - p.c[1]), Math.abs(y1 - p.c[1])));
    return closest <= p.r + half + pad && (p.fill !== undefined || farthest >= p.r - half - pad);
  }
  if (p.t === "poly" && !p.fill) return p.pts.some((a, i) => hit(primBox({ t: "line", a, b: p.pts[(i + 1) % p.pts.length]!, stroke: INK, width: p.width ?? DEFAULT_STROKE })));
  return hit(primBox(p));
}

/**
 * Alignment crosses in drawing mm (y down). Neighbouring pages print the same strip of the drawing; a cross
 * sits on the strip's centre line at both ends of the stretch every pair of pages shares: where the strip
 * meets the drawing's edge (a little inside it) and where it crosses a strip of the other direction, which
 * all four pages around that corner print. Both pages of a pair therefore carry two crosses to lay on top of
 * each other. After img2shadow's stripMarks, which marks only the ends at the drawing's edge.
 *
 * With `obstacles` (the drawing itself) a cross that would sit on a number, a tick or a pin moves to the
 * nearest clear place that the same pages still print: further in along its strip, or, at a corner, anywhere
 * in the patch the four pages share. With two columns of pages the strip between them runs down the middle of
 * the board, straight through pin 1: without this its cross would cover the "1".
 */
export function stripMarks(plan: TilePlan, W: number, H: number, obstacles: readonly Prim[] = []): StripMark[] {
  const { cols, rows, tiles } = plan;
  const tile = (col: number, row: number): Tile => tiles[row * cols + col]!;
  // what two neighbouring columns (rows) both print: [from, to], and the middle of it
  const xStrips = Array.from({ length: cols - 1 }, (_, c): [number, number] => [tile(c + 1, 0).x, tile(c, 0).x + tile(c, 0).w]);
  const yStrips = Array.from({ length: rows - 1 }, (_, r): [number, number] => [tile(0, r + 1).y, tile(0, r).y + tile(0, r).h]);
  const mid = ([a, b]: [number, number]) => (a + b) / 2;
  const inset = Math.min(MARK_INSET, W / 10, H / 10);
  const colName = (c: number) => `C${c + 1}|C${c + 2}`, rowName = (r: number) => `R${r + 1}|R${r + 2}`;
  const clear = (m: StripMark): boolean => {
    const boxes = markPrims([m]).map(primBox);
    const box: Box = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
    return !obstacles.some((p) => near(p, box, MARK_CLEAR));
  };
  /** The first clear place among the candidates, else the first candidate. */
  const place = (m: StripMark, candidates: [number, number][]): StripMark => {
    if (!obstacles.length) return m;
    for (const [x, y] of candidates) if (clear({ ...m, x, y })) return { ...m, x, y };
    return m;
  };
  const steps = (limit: number) => Array.from({ length: Math.max(1, Math.floor(Math.min(MARK_SEARCH, limit)) + 1) }, (_, k) => k);
  const marks: StripMark[] = [];
  xStrips.forEach((strip, c) => {
    const x = mid(strip), reach = Math.min(H, tile(c, 0).h) / 2 - inset;
    marks.push(place({ x, y: inset, at: "top", cols: colName(c) }, steps(reach).map((k) => [x, inset + k])));
    yStrips.forEach((other, r) => {
      const y = mid(other);
      // the patch all four pages print, less the room a cross and its labels need; nearest places first
      const dxs = steps((strip[1] - strip[0]) / 2 - MARK_ROOM).flatMap((k) => (k ? [k, -k] : [0]));
      const dys = steps((other[1] - other[0]) / 2 - MARK_ROOM).flatMap((k) => (k ? [k, -k] : [0]));
      const spots = dxs.flatMap((dx) => dys.map((dy): [number, number] => [dx, dy])).sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
      marks.push(place({ x, y, at: "corner", cols: colName(c), rows: rowName(r) }, spots.map(([dx, dy]) => [x + dx, y + dy])));
    });
    marks.push(place({ x, y: H - inset, at: "bottom", cols: colName(c) }, steps(reach).map((k) => [x, H - inset - k])));
  });
  yStrips.forEach((strip, r) => {
    const y = mid(strip), reach = Math.min(W, tile(0, r).w) / 2 - inset;
    marks.push(place({ x: inset, y, at: "left", rows: rowName(r) }, steps(reach).map((k) => [inset + k, y])));
    marks.push(place({ x: W - inset, y, at: "right", rows: rowName(r) }, steps(reach).map((k) => [W - inset - k, y])));
  });
  return marks;
}

/**
 * The crosses as primitives. A label must be readable on every page that prints its cross, so it stays
 * inside the strip, which may be only 10 mm wide: centred below the cross at the top end of a strip and above
 * it at the bottom end, beside the cross (towards the middle) at the left and right ends, and one above and
 * one below where two strips cross.
 */
export function markPrims(marks: readonly StripMark[]): Prim[] {
  const gap = MARK_ARM + 0.5, rise = 0.733 * MARK_TEXT; // the height of a capital letter
  const label = (text: string | undefined, x: number, y: number, align: "left" | "center" | "right"): Prim[] => (text ? [{ t: "text", at: [x, y], text, size: MARK_TEXT, color: INK, align }] : []);
  return marks.flatMap((m): Prim[] => [
    { t: "line", a: [m.x - MARK_ARM, m.y], b: [m.x + MARK_ARM, m.y], stroke: INK, width: 0.15 },
    { t: "line", a: [m.x, m.y - MARK_ARM], b: [m.x, m.y + MARK_ARM], stroke: INK, width: 0.15 },
    ...(m.at === "top" ? label(m.cols, m.x, m.y + gap + rise, "center")
      : m.at === "bottom" ? label(m.cols, m.x, m.y - gap, "center")
      : m.at === "left" ? label(m.rows, m.x + gap, m.y + rise / 2, "left")
      : m.at === "right" ? label(m.rows, m.x - gap, m.y + rise / 2, "right")
      : [...label(m.cols, m.x, m.y - gap, "center"), ...label(m.rows, m.x, m.y + gap + rise, "center")]),
  ]);
}

/** Dashed lines on the edges of the page's drawing area that face another page: one of the two neighbours
 * is cut there, so its white margin does not cover the other. Page mm, y down. */
function trimPrims(plan: TilePlan, tile: Tile): Prim[] {
  const x0 = plan.contentX, y0 = plan.contentY, x1 = x0 + plan.contentW, y1 = y0 + plan.contentH;
  const edge = (a: [number, number], b: [number, number]): Prim => ({ t: "line", a, b, stroke: INK, width: 0.12, dash: [2, 1.5] });
  const out: Prim[] = [];
  if (tile.col > 0) out.push(edge([x0, y0], [x0, y1]));
  if (tile.col < plan.cols - 1) out.push(edge([x1, y0], [x1, y1]));
  if (tile.row > 0) out.push(edge([x0, y0], [x1, y0]));
  if (tile.row < plan.rows - 1) out.push(edge([x0, y1], [x1, y1]));
  return out;
}

export interface BandTexts {
  /** What the print is: "Nail template · 500 mm · 256 pins". */
  title: string;
  /** "Page 2 of 6 · row 1, column 2". */
  page: string;
  /** "Print at 100 % ...", and on tiled prints how to join the pages. */
  note: string;
}

/**
 * The strip below the drawing area of a page (page mm, y down): the scale bar on the left, the title and the
 * page's label beside it, and a line of notes across the bottom. A text too long for its room is set smaller,
 * never past the printable area. `measure` gives the width of a string at a text size, both in mm.
 */
export function bandPrims(plan: TilePlan, texts: BandTexts, measure: (s: string, size: number) => number): Prim[] {
  const x0 = plan.contentX, y0 = plan.contentY + plan.contentH, w = plan.contentW;
  const fitted = (s: string, x: number, y: number, room: number): Prim => {
    const need = measure(s, BAND_TEXT);
    return { t: "text", at: [x, y], text: s, size: need > room ? (BAND_TEXT * room) / need : BAND_TEXT, color: INK };
  };
  return [
    ...scaleBarPrims(x0, y0 + 3.6, "100 mm", INK, BAND_TEXT),
    fitted(texts.title, x0 + BAND_SIDE, y0 + 2.2, w - BAND_SIDE),
    fitted(texts.page, x0 + BAND_SIDE, y0 + 4.9, w - BAND_SIDE),
    fitted(texts.note, x0, y0 + 7.5, w),
  ];
}

/** The words on page `index` (0-based) of the template. */
export function bandTexts(frame: Project["frame"], plan: TilePlan, index: number, lang: Lang, inside?: ArrayLike<number>): BandTexts {
  const n = plan.tiles.length, tile = plan.tiles[index]!;
  const print = t("pdf.printActual", {}, undefined, lang);
  return {
    title: templateTitle(frame, lang, inside),
    page: n > 1 ? t("pdf.tile", { p: index + 1, n, row: tile.row + 1, col: tile.col + 1 }, undefined, lang) : t("pdf.page", { p: 1, n: 1 }, undefined, lang),
    note: n > 1 ? `${print} ${t("tpl.join", {}, undefined, lang)}` : print,
  };
}

export async function templatePdf(fontBytes: Uint8Array, project: Project, lang: Lang): Promise<Uint8Array> {
  // a piece with pins inside the picture has them on its template: they are its result's (D-60)
  const frame = project.frame, inside = project.result?.inside;
  const drawing = templateDrawing(frame, inside), plan = templatePlan(frame, project.paper);
  const { doc, font } = await newDoc(fontBytes, templateTitle(frame, lang, inside), lang);
  const prims = [...drawing.prims, ...markPrims(stripMarks(plan, drawing.width, drawing.height, drawing.prims))];
  const boxes = prims.map(primBox);
  plan.tiles.forEach((tile, index) => {
    const page = addPage(doc, plan.pageW, plan.pageH);
    const shown = prims.filter((_, k) => {
      const [bx0, by0, bx1, by1] = boxes[k]!;
      return bx1 >= tile.x - BLEED && bx0 <= tile.x + tile.w + BLEED && by1 >= tile.y - BLEED && by0 <= tile.y + tile.h + BLEED;
    });
    const [ox, oy] = tileOrigin(plan, tile);
    clipRect(page, plan.contentX - BLEED, plan.contentY - BLEED, plan.contentW + 2 * BLEED, plan.contentH + 2 * BLEED, () => drawPrims(page, font, shown, ox, oy));
    drawPrims(page, font, [...trimPrims(plan, tile), ...bandPrims(plan, bandTexts(frame, plan, index, lang, inside), (s, size) => textWidthMm(font, s, size))]);
  });
  return save(doc);
}
