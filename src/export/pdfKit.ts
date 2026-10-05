// The only module that talks to pdf-lib (pinned, no longer maintained upstream), so it can be replaced.
// Documents are written without creation dates (same input, same bytes), embed the Noto Sans TC subset whole
// (pdf-lib's own subsetting breaks CJK fonts) and ask viewers to print at 100 %.
// Ported from img2fold (originally img2shadow); drawPrims() draws the shared primitives (render/prims.ts).
import fontkit from "@pdf-lib/fontkit";
import {
  appendBezierCurve,
  beginText,
  clip,
  closePath,
  endPath,
  endText,
  fill,
  fillAndStroke,
  LineJoinStyle,
  lineTo,
  moveText,
  moveTo,
  PDFDocument,
  popGraphicsState,
  PrintScaling,
  pushGraphicsState,
  rectangle,
  setDashPattern,
  setFillingRgbColor,
  setFontAndSize,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  showText,
  stroke,
  type PDFFont,
  type PDFHexString,
  type PDFName,
  type PDFOperator,
  type PDFPage,
} from "pdf-lib";
import { breakLines } from "../core/instructions.ts";
import { DEFAULT_STROKE, rgb01, type Prim, type Vec } from "../render/prims.ts";
import { pt } from "./tiles.ts";

export type { PDFDocument, PDFFont, PDFPage };

export interface Doc {
  doc: PDFDocument;
  font: PDFFont;
}

export async function newDoc(fontBytes: Uint8Array, title: string, lang?: string): Promise<Doc> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: false });
  doc.setTitle(title, { showInWindowTitleBar: true });
  doc.setProducer("img2string");
  if (lang) doc.setLanguage(lang);
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  return { doc, font };
}

export const save = (doc: PDFDocument): Promise<Uint8Array> => doc.save({ useObjectStreams: false });

/** A new page, sized in mm. */
export const addPage = (doc: PDFDocument, widthMm: number, heightMm: number): PDFPage => doc.addPage([pt(widthMm), pt(heightMm)]);

// Laying a string out is the slow part of both measuring and writing it, and a sequence prints the same few
// hundred pin numbers thousands of times: short strings are remembered per font.
const REMEMBER = 12;
const widthCache = new WeakMap<PDFFont, Map<string, number>>();
const hexCache = new WeakMap<PDFFont, Map<string, PDFHexString>>();

function remembered<V>(cache: WeakMap<PDFFont, Map<string, V>>, font: PDFFont, s: string, make: () => V): V {
  if (s.length > REMEMBER) return make();
  let map = cache.get(font);
  if (!map) cache.set(font, (map = new Map()));
  let v = map.get(s);
  if (v === undefined) map.set(s, (v = make()));
  return v;
}

/** Width of `s` in mm at a text size given in mm. */
export function textWidthMm(font: PDFFont, s: string, sizeMm: number): number {
  return remembered(widthCache, font, s, () => font.widthOfTextAtSize(s, 1)) * sizeMm;
}

/** A test for "the font has a glyph for every character of this string": text the user typed (a thread's
 * name) is printed only when it passes, never as empty boxes. */
export function glyphTest(font: PDFFont): (s: string) => boolean {
  const set = new Set(font.getCharacterSet());
  return (s) => {
    for (const ch of s) if (!set.has(ch.codePointAt(0)!)) return false;
    return true;
  };
}

/** Breaks a paragraph to fit `width` mm: between words in English, between any two characters in Chinese. */
export function wrap(font: PDFFont, s: string, sizeMm: number, width: number): string[] {
  return breakLines(s, (line) => textWidthMm(font, line, sizeMm) <= width);
}

// pdf-lib's drawText() adds a font entry to the page's resources on every call that names a font; a sheet of
// 4,000 pin numbers would carry thousands of them. The font is registered once per page here instead, and
// the text operators are written directly.
const fontKeys = new WeakMap<PDFPage, Map<PDFFont, PDFName>>();
function fontKey(page: PDFPage, font: PDFFont): PDFName {
  let keys = fontKeys.get(page);
  if (!keys) fontKeys.set(page, (keys = new Map()));
  let key = keys.get(font);
  if (!key) keys.set(font, (key = page.node.newFontDictionary(font.name, font.ref)));
  return key;
}

/** Circle as four cubic arcs: control points at this fraction of the radius. */
const KAPPA = (4 * (Math.SQRT2 - 1)) / 3;
const CHUNK = 2048;

/**
 * Draws primitives (drawing mm, y down) onto a page: the drawing's origin goes to (ox, oy) mm from the page's
 * top-left corner. Text sizes are in mm like everything else. A circle starts at its rightmost point and is
 * closed after four arcs, so its centre can be read back from the page (the tests do).
 */
export function drawPrims(page: PDFPage, font: PDFFont, prims: readonly Prim[], ox = 0, oy = 0): void {
  const H = page.getHeight();
  const X = (x: number) => pt(ox + x), Y = (y: number) => H - pt(oy + y);
  const at = (p: Vec) => [X(p[0]), Y(p[1])] as const;
  const ops: PDFOperator[] = [];
  for (const p of prims) {
    if (p.t === "text") {
      if (!p.text) continue;
      const w = p.align === "center" || p.align === "right" ? textWidthMm(font, p.text, p.size) : 0;
      const x = p.at[0] - (p.align === "center" ? w / 2 : p.align === "right" ? w : 0);
      const hex = remembered(hexCache, font, p.text, () => font.encodeText(p.text));
      ops.push(pushGraphicsState(), beginText(), setFillingRgbColor(...rgb01(p.color)), setFontAndSize(fontKey(page, font), pt(p.size)), moveText(X(x), Y(p.at[1])), showText(hex), endText(), popGraphicsState());
      continue;
    }
    const fillColor = p.t !== "line" ? p.fill : undefined;
    const strokeColor = p.stroke;
    if (!fillColor && !strokeColor) continue;
    ops.push(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
    if (fillColor) ops.push(setFillingRgbColor(...rgb01(fillColor)));
    if (strokeColor) ops.push(setStrokingRgbColor(...rgb01(strokeColor)), setLineWidth(pt(p.width ?? DEFAULT_STROKE)));
    if ((p.t === "line" || p.t === "path") && p.dash) ops.push(setDashPattern(p.dash.map(pt), 0));
    if (p.t === "poly") {
      p.pts.forEach((q, i) => ops.push(i ? lineTo(...at(q)) : moveTo(...at(q))));
      ops.push(closePath());
    } else if (p.t === "line") {
      ops.push(moveTo(...at(p.a)), lineTo(...at(p.b)));
    } else if (p.t === "circle") {
      const [cx, cy] = at(p.c), r = pt(p.r), k = KAPPA * r;
      ops.push(
        moveTo(cx + r, cy),
        appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
        appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
        appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
        appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
        closePath(),
      );
    } else {
      for (const c of p.d) {
        if (c.c === "M") ops.push(moveTo(...at(c.p)));
        else if (c.c === "L") ops.push(lineTo(...at(c.p)));
        else if (c.c === "C") ops.push(appendBezierCurve(...at(c.p1), ...at(c.p2), ...at(c.p)));
        else ops.push(closePath());
      }
    }
    ops.push(fillColor && strokeColor ? fillAndStroke() : fillColor ? fill() : stroke(), popGraphicsState());
  }
  // in pieces: one call with every operator of a long page as arguments would overflow the stack
  for (let i = 0; i < ops.length; i += CHUNK) page.pushOperators(...ops.slice(i, i + CHUNK));
}

/** Runs `draw` clipped to a rectangle given in mm from the page's top-left corner. */
export function clipRect(page: PDFPage, x: number, y: number, w: number, h: number, draw: () => void): void {
  const H = page.getHeight();
  page.pushOperators(pushGraphicsState(), rectangle(pt(x), H - pt(y + h), pt(w), pt(h)), clip(), endPath());
  draw();
  page.pushOperators(popGraphicsState());
}
