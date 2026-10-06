// For the tests of what leaves the app as a file: a made-up project to print, and reading back what the PDF
// writer drew: the inflated content streams, page by page, and the shapes, fills and text in them.
// contentStreams and quads are ported from img2fold; the circles and the text are new.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzlibSync } from "fflate";
import { decodePDFRawStream, PDFArray, PDFDocument, type PDFRawStream } from "pdf-lib";
import { allowedPairs, pictureAspect } from "../../src/core/frame.ts";
import { defaultProject, frameSpec, generationKey, type Project } from "../../src/core/project.ts";
import { mulberry32 } from "./rng.ts";

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
const NUM = "(-?[\\d.]+)";

/** The PDF font as the app ships it. */
export const fontBytes = (): Uint8Array => new Uint8Array(readFileSync(join(__dirname, "../../src/assets/fonts/NotoSansTC-Regular-subset.ttf")));

/**
 * A project with a made-up result: thread k gets `lines[k]` lines (0 leaves it unwound), every step at least
 * minSkip pins from the one before, as the generator would. `edit` changes the default project first (the
 * frame, the threads); the threads must number as many as `lines`.
 */
export function madeUpProject(lines: readonly number[], edit: (p: Project) => void = () => {}, seed = 1): Project {
  const p = defaultProject();
  edit(p);
  if (p.threads.length !== lines.length) throw new Error(`${lines.length} line counts for ${p.threads.length} threads`);
  const random = mulberry32(seed), N = p.frame.pins, skip = p.generator.minSkip;
  const sequences = lines.map((n) => {
    if (n === 0) return [];
    const sequence = [Math.floor(random() * N)];
    for (let i = 0; i < n; i++) sequence.push((sequence[i]! + skip + Math.floor(random() * (N - 2 * skip + 1))) % N);
    return sequence;
  });
  p.result = { key: generationKey(p), sequences, lines: sequences.map((s) => Math.max(0, s.length - 1)), errorReduction: 0.9, meanDeltaEOk: 10, reason: "budget" };
  return p;
}

/** The colour preset of spec §6.3 (CMYK on white), with 200 pins and a minimum skip of 15. */
export function colourProject(lines: readonly number[] = [1500, 1379, 536, 606], seed = 2): Project {
  return madeUpProject(lines, (p) => {
    p.mode = "colour";
    p.frame.pins = 200;
    p.generator = { res: 240, minSkip: 15, allowRepeat: false };
    p.threads = [
      { name: "yellow", hex: "#FFE000", maxLines: 1500 },
      { name: "cyan", hex: "#00A0E0", maxLines: 1500 },
      { name: "magenta", hex: "#E0007A", maxLines: 1500 },
      { name: "black", hex: "#111111", maxLines: 1500 },
    ];
  }, seed);
}

/**
 * A project on a rectangular frame round a `width` x `height` picture (DECISIONS D-58), with a made-up result:
 * every step goes to a pin the frame allows from where the thread is, as the generator would.
 */
export function rectProject(lines: readonly number[], width = 600, height = 800, edit: (p: Project) => void = () => {}, seed = 1): Project {
  const p = defaultProject();
  p.image = { name: "picture.png", sha256: "f".repeat(64), sample: null, width, height, crop: { ...p.image.crop }, embedded: null };
  p.frame = { ...p.frame, shape: "rect", aspect: pictureAspect(width, height) };
  edit(p);
  if (p.threads.length !== lines.length) throw new Error(`${lines.length} line counts for ${p.threads.length} threads`);
  const random = mulberry32(seed), N = p.frame.pins, ok = allowedPairs({ pins: N, minSkip: p.generator.minSkip, ...frameSpec(p.frame) });
  const sequences = lines.map((n) => {
    if (n === 0) return [];
    const sequence = [Math.floor(random() * N)];
    for (let i = 0; i < n; i++) {
      const from = sequence[i]!, partners: number[] = [];
      for (let v = 0; v < N; v++) if (ok[from * N + v]) partners.push(v);
      sequence.push(partners[Math.floor(random() * partners.length)]!);
    }
    return sequence;
  });
  p.result = { key: generationKey(p), sequences, lines: sequences.map((s) => Math.max(0, s.length - 1)), errorReduction: 0.9, meanDeltaEOk: 10, reason: "budget" };
  return p;
}

/** Set IMG2STRING_KEEP to a folder to keep the files the tests build, for a look at the real thing. */
export function keep(name: string, bytes: Uint8Array): void {
  const dir = process.env.IMG2STRING_KEEP;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), bytes);
}

/** Every stream of the file, inflated (not only the pages: fonts too). */
export function contentStreams(bytes: Uint8Array): string[] {
  const s = latin1(bytes);
  const out: string[] = [];
  let i = 0;
  while ((i = s.indexOf("stream", i)) >= 0) {
    if (s.slice(i - 3, i) === "end") { i += 6; continue; }
    let start = i + 6;
    if (s[start] === "\r") start++;
    if (s[start] === "\n") start++;
    const end = s.indexOf("endstream", start);
    const data = bytes.subarray(start, end);
    try {
      out.push(latin1(unzlibSync(data)));
    } catch {
      out.push(latin1(data));
    }
    i = end + 9;
  }
  return out;
}

export interface PageContent {
  /** Page size in points. */
  width: number;
  height: number;
  content: string;
}

/** What each page draws, in page order. */
export async function pageContents(bytes: Uint8Array): Promise<PageContent[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    const content = streams.map((stream) => latin1(decodePDFRawStream(stream as PDFRawStream).decode())).join("\n");
    return { width: page.getWidth(), height: page.getHeight(), content };
  });
}

/** Every "x y m x y l x y l x y l h" quadrilateral in the page content, as [x0, y0, x1, y1] extents (points). */
export function quads(content: string): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const re = /(-?[\d.]+) (-?[\d.]+) m\s+(-?[\d.]+) (-?[\d.]+) l\s+(-?[\d.]+) (-?[\d.]+) l\s+(-?[\d.]+) (-?[\d.]+) l\s+h/g;
  for (const m of content.matchAll(re)) {
    const v = m.slice(1, 9).map(Number);
    const xs = [v[0]!, v[2]!, v[4]!, v[6]!], ys = [v[1]!, v[3]!, v[5]!, v[7]!];
    out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  return out;
}

/** The quadrilaterals that are filled (painted with f or B), not merely outlined. */
export function filledQuads(content: string): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const re = new RegExp(`${NUM} ${NUM} m\\s+${NUM} ${NUM} l\\s+${NUM} ${NUM} l\\s+${NUM} ${NUM} l\\s+h\\s+(f|B)\\b`, "g");
  for (const m of content.matchAll(re)) {
    const v = m.slice(1, 9).map(Number);
    const xs = [v[0]!, v[2]!, v[4]!, v[6]!], ys = [v[1]!, v[3]!, v[5]!, v[7]!];
    out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  return out;
}

export interface Circle {
  /** Centre and radius in points. */
  x: number;
  y: number;
  r: number;
}

/** Every circle as pdfKit draws one: a move to its rightmost point, four Bezier arcs, and a close. The centre
 * is midway between the start and the end of the second arc (the leftmost point). */
export function circles(content: string): Circle[] {
  const arc = `${NUM} ${NUM} ${NUM} ${NUM} ${NUM} ${NUM} c\\s+`;
  const re = new RegExp(`${NUM} ${NUM} m\\s+${arc}${arc}${arc}${arc}h`, "g");
  const out: Circle[] = [];
  for (const m of content.matchAll(re)) {
    const v = m.slice(1).map(Number);
    const x0 = v[0]!, y0 = v[1]!, x1 = v[12]!, y1 = v[13]!; // start; end point of the second arc
    out.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, r: Math.hypot(x1 - x0, y1 - y0) / 2 });
  }
  return out;
}

/** Every fill colour set on the page ("r g b rg"), each component 0..1. */
export function fillColours(content: string): [number, number, number][] {
  return [...content.matchAll(new RegExp(`${NUM} ${NUM} ${NUM} rg\\b`, "g"))].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
}

/** Whether the page fills something with this "#rrggbb" colour. */
export function fillsWith(content: string, hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  const want = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  return fillColours(content).some((c) => c.every((v, i) => Math.abs(v - want[i]!) < 1e-6));
}

/** The part of fontkit's font the tests use. */
export interface GlyphFont {
  glyphForCodePoint(codePoint: number): { id: number; advanceWidth: number };
  hasGlyphForCodePoint(codePoint: number): boolean;
  unitsPerEm: number;
}

/** A string as the writer puts it on a page with the embedded font: the glyph ids, four hex digits each. */
export function glyphHex(font: GlyphFont, text: string): string {
  return [...text].map((ch) => font.glyphForCodePoint(ch.codePointAt(0)!).id.toString(16).toUpperCase().padStart(4, "0")).join("");
}

/** Whether the page shows exactly this string as one piece of text. */
export function showsText(content: string, font: GlyphFont, text: string): boolean {
  return content.includes(`<${glyphHex(font, text)}> Tj`);
}

/** Width of a string in mm at a text size in mm, from the font's own advance widths. */
export function textWidth(font: GlyphFont, text: string, sizeMm: number): number {
  let units = 0;
  for (const ch of text) units += font.glyphForCodePoint(ch.codePointAt(0)!).advanceWidth;
  return (units / font.unitsPerEm) * sizeMm;
}
