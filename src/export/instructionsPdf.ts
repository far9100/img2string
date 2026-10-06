// The winding instructions as a PDF (spec §7.3), portrait, on A4 or, when the paper chosen is US Letter, on
// Letter (an A4 sheet printed at actual size on Letter loses its last rows): a title and how to read the sheet,
// the materials (§7.5), then one section per thread in winding order with its colour swatch, start and end
// pins, lines and length, and its sequence in rows of ten, each with a box to tick, the number of its first
// step and the clock position of its first pin. The rows run down as many columns as fit the page, column
// after column, so 4,000 lines take a few pages. The text is laid out as primitives first (layoutInstructions,
// no PDF needed), which is also what tells the page count for the footers. The flow is after img2shadow's
// placement sheet.
import { NO_RESULT, ROUND_MARK, sheetTexts, type Row, type SheetTexts } from "../core/instructions.ts";
import type { Paper, Project } from "../core/project.ts";
import { t, type Lang } from "../i18n/translate.ts";
import type { Prim } from "../render/prims.ts";
import { addPage, drawPrims, glyphTest, newDoc, save, textWidthMm, wrap } from "./pdfKit.ts";
import { PAPER_SIZE } from "./tiles.ts";

/** The sheet's page (mm, portrait): US Letter when that is the paper chosen, otherwise A4, also when the
 * template is printed on A3 (a list is not read at A3). */
export const sheetPage = (paper: Paper): readonly [number, number] => (paper === "Letter" ? PAPER_SIZE.Letter : PAPER_SIZE.A4);
/** Side margins, where the text starts, and the room kept at the bottom for the footer (mm). */
const SIDE = 12, TOP = 13, BOTTOM = 15;
const INK = "#1c1d1f", MUTED = "#5e6166", RULE = "#c3c3be";
/** Text sizes (mm): 3 mm is about 8.5 pt. */
const TITLE = 5.6, HEAD = 3.9, BODY = 3, SMALL = 2.5;
/** The sequence grid: size of the pin numbers, row pitch, side of the tick box, the least gap between two
 * columns, and how few rows may be left alone at the foot of a page. */
const PIN = 3, ROW = 4.4, BOX = 2.4, GAP = 7, MIN_ROWS = 4;
/** Gaps inside a row: after the box, between the step number and the pins, between two pins, before the clock. */
const AFTER_BOX = 1.6, AFTER_INDEX = 2.2, BETWEEN_PINS = 1.3, BEFORE_CLOCK = 2.2;
/** Height of a digit in units of its text size: numbers are centred on their row by it. */
const DIGIT_H = 0.733;

export type Measure = (s: string, size: number) => number;

/** A column of text `width` mm wide flowing down pages `height` mm high, in mm with y down; `y` is the top
 * of the next thing to place. */
class Flow {
  readonly pages: Prim[][] = [[]];
  readonly width: number;
  readonly height: number;
  y = TOP;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  get prims(): Prim[] {
    return this.pages[this.pages.length - 1]!;
  }
  /** Height left on this page. */
  get room(): number {
    return this.height - BOTTOM - this.y;
  }
  newPage(): void {
    this.pages.push([]);
    this.y = TOP;
  }
  /** Moves to a new page unless `h` mm still fit on this one. */
  need(h: number): void {
    if (this.room < h - 1e-9) this.newPage();
  }
  /** One line of text; a line takes 1.5 times its text size. */
  line(s: string, size: number, x = SIDE, color = INK): void {
    this.need(1.5 * size);
    this.prims.push({ t: "text", at: [x, this.y + 1.1 * size], text: s, size, color });
    this.y += 1.5 * size;
  }
  rule(color = RULE, width = 0.25): void {
    this.prims.push({ t: "line", a: [SIDE, this.y], b: [SIDE + this.width, this.y], stroke: color, width });
  }
}

const swatch = (x: number, y: number, w: number, h: number, hex: string): Prim =>
  // the outline keeps a white thread visible on white paper
  ({ t: "poly", pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], fill: hex, stroke: MUTED, width: 0.2 });

/** Where the parts of a sequence row sit, measured with the real font. */
interface Grid {
  cols: number;
  /** Distance between the left edges of two columns, and the width one column needs. */
  pitch: number;
  colW: number;
  indexW: number;
  numW: number;
  cellW: number;
}

function gridOf(s: SheetTexts, pins: number, measure: Measure, WIDTH: number): Grid {
  const digit = (size: number) => Math.max(...[..."0123456789"].map((d) => measure(d, size)));
  const last = Math.max(1, ...s.sections.map((section) => (section.rows.length ? section.rows[section.rows.length - 1]!.index : 1)));
  const indexW = String(last).length * digit(SMALL);
  // room for the largest pin number and, where a step goes round the frame, for the mark before it (D-60)
  const marked = s.sections.some((section) => section.rows.some((row) => row.round));
  const numW = String(pins).length * digit(PIN) + (marked ? measure(ROUND_MARK, PIN) : 0), cellW = numW + BETWEEN_PINS;
  // the hint at the end of a row: a clock time, or on a rectangular frame a side and a number, which may be wider
  const hintW = Math.max(measure("12:55", SMALL), ...s.sections.flatMap((section) => section.rows.map((row) => measure(row.clock, SMALL))));
  const colW = BOX + AFTER_BOX + indexW + AFTER_INDEX + 9 * cellW + numW + BEFORE_CLOCK + hintW;
  const cols = Math.max(1, Math.floor((WIDTH + GAP) / (colW + GAP)));
  return { cols, pitch: (WIDTH + GAP) / cols, colW, indexW, numW, cellW };
}

function rowPrims(row: Row, x: number, y: number, g: Grid, ruled: boolean): Prim[] {
  const mid = y + ROW / 2, top = mid - BOX / 2;
  const indexX = x + BOX + AFTER_BOX + g.indexW, pinX = indexX + AFTER_INDEX;
  const out: Prim[] = [
    { t: "poly", pts: [[x, top], [x + BOX, top], [x + BOX, top + BOX], [x, top + BOX]], stroke: INK, width: 0.2 },
    { t: "text", at: [indexX, mid + (DIGIT_H / 2) * SMALL], text: String(row.index), size: SMALL, color: MUTED, align: "right" },
    { t: "text", at: [pinX + 9 * g.cellW + g.numW + BEFORE_CLOCK, mid + (DIGIT_H / 2) * SMALL], text: row.clock, size: SMALL, color: MUTED },
  ];
  row.pins.forEach((pin, j) => out.push({ t: "text", at: [pinX + j * g.cellW + g.numW, mid + (DIGIT_H / 2) * PIN], text: `${row.round?.includes(j) ? ROUND_MARK : ""}${pin}`, size: PIN, color: INK, align: "right" }));
  // a hairline under every fifth row keeps the eye on its row
  if (ruled) out.push({ t: "line", a: [x, y + ROW], b: [x + g.colW, y + ROW], stroke: RULE, width: 0.12 });
  return out;
}

/** The whole sheet as pages of primitives (portrait, mm, y down; `page` is the paper's width and height),
 * without the footers. */
export function layoutInstructions(s: SheetTexts, pins: number, measure: Measure, breakText: (text: string, size: number, width: number) => string[], page: readonly [number, number] = PAPER_SIZE.A4): Prim[][] {
  const WIDTH = page[0] - 2 * SIDE, flow = new Flow(WIDTH, page[1]);
  const heading = (text: string) => {
    flow.need(1.5 * HEAD + 3 + 1.5 * BODY); // never alone at the foot of a page
    flow.y += 3;
    flow.line(text, HEAD);
    flow.y += 0.6;
  };
  const para = (text: string, color = INK) => {
    for (const line of breakText(text, BODY, WIDTH)) flow.line(line, BODY, SIDE, color);
  };
  /** A text set smaller when it is wider than its room. */
  const fitted = (text: string, size: number, room: number) => size * Math.min(1, room / Math.max(measure(text, size), 1e-9));

  flow.line(s.title, TITLE);
  flow.line(s.subtitle, BODY, SIDE, MUTED);
  heading(s.howTitle);
  para(s.how);
  if (s.howMore) {
    flow.y += 1.2;
    para(s.howMore);
  }

  // ---- materials (§7.5): a small table, then the notes
  heading(s.materialsTitle);
  const table = [...s.rows, ...(s.total ? [s.total] : [])];
  const linesW = Math.max(measure(s.head[1], SMALL), ...table.map((row) => measure(row.lines, BODY)));
  const lengthW = Math.max(measure(s.head[2], SMALL), ...table.map((row) => measure(row.length, BODY)));
  const labelX = SIDE + 8;
  const labelRoom = WIDTH - 8 - 10 - linesW - 8 - lengthW;
  const labelW = Math.min(labelRoom, Math.max(measure(s.head[0], SMALL), ...table.map((row) => measure(row.label, BODY))));
  const linesX = labelX + labelW + 10 + linesW, lengthX = linesX + 8 + lengthW;
  const tableRow = (label: string, lines: string, length: string, size: number, color: string, hex?: string) => {
    flow.need(5);
    const base = flow.y + 3.6;
    if (hex) flow.prims.push(swatch(SIDE, flow.y + 1, 5.5, 3.2, hex));
    flow.prims.push(
      { t: "text", at: [labelX, base], text: label, size: fitted(label, size, labelRoom), color },
      { t: "text", at: [linesX, base], text: lines, size, color, align: "right" },
      { t: "text", at: [lengthX, base], text: length, size, color, align: "right" },
    );
    flow.y += 5;
  };
  const tableRule = () => flow.prims.push({ t: "line", a: [SIDE, flow.y + 0.4], b: [lengthX, flow.y + 0.4], stroke: RULE, width: 0.25 });
  tableRow(s.head[0], s.head[1], s.head[2], SMALL, MUTED);
  tableRule();
  for (const row of s.rows) tableRow(row.label, row.lines, row.length, BODY, INK, row.hex);
  if (s.total) {
    tableRule();
    tableRow(s.total.label, s.total.lines, s.total.length, BODY, INK);
  }
  flow.y += 1.5;
  for (const note of s.notes) para(note);

  // ---- one section per thread, in winding order
  const g = gridOf(s, pins, measure, WIDTH);
  for (const section of s.sections) {
    const facts = breakText(section.facts, BODY, WIDTH);
    const titleSize = fitted(section.title, HEAD, WIDTH - 11);
    flow.need(4 + 1.5 * HEAD + 1.5 * BODY * facts.length + 1.5 + Math.min(MIN_ROWS, section.rows.length) * ROW);
    flow.y += 4;
    flow.rule(MUTED, 0.3);
    flow.y += 1.6;
    flow.prims.push(swatch(SIDE, flow.y + 0.9, 8, 4.2, section.plan.hex));
    flow.prims.push({ t: "text", at: [SIDE + 11, flow.y + 1.1 * HEAD], text: section.title, size: titleSize, color: INK });
    flow.y += 1.5 * HEAD;
    for (const line of facts) flow.line(line, BODY);
    flow.y += 1.5;

    const continued = () => {
      flow.newPage();
      flow.prims.push(swatch(SIDE, flow.y + 0.6, 5.5, 3.2, section.plan.hex));
      flow.prims.push({ t: "text", at: [SIDE + 8, flow.y + 1.1 * BODY], text: section.continued, size: fitted(section.continued, BODY, WIDTH - 8), color: MUTED });
      flow.y += 1.5 * BODY + 1.5;
    };
    for (let i = 0; i < section.rows.length; ) {
      const left = section.rows.length - i, wanted = Math.ceil(left / g.cols);
      if (Math.floor(flow.room / ROW + 1e-9) < Math.min(MIN_ROWS, wanted)) continued();
      // the rest of the thread in columns of equal height when it fits this page, else the page filled
      const per = Math.min(Math.floor(flow.room / ROW + 1e-9), wanted);
      for (let c = 0; c < g.cols; c++) {
        const x = SIDE + c * g.pitch;
        for (let k = 0; k < per; k++) {
          const row = section.rows[i + c * per + k];
          if (!row) break;
          flow.prims.push(...rowPrims(row, x, flow.y + k * ROW, g, k % 5 === 4 && k < per - 1));
        }
        // a line between two columns: the sequence runs down one column, then down the next
        if (c > 0 && section.rows[i + c * per]) {
          const sx = x - (g.pitch - g.colW) / 2;
          flow.prims.push({ t: "line", a: [sx, flow.y + 0.6], b: [sx, flow.y + per * ROW - 0.6], stroke: RULE, width: 0.25 });
        }
      }
      i += per * g.cols;
      flow.y += per * ROW;
      if (i < section.rows.length) continued();
    }
  }
  return flow.pages;
}

/** Throws Error("no-result") when the project has no result. `stem` (the download's file-name stem) is printed
 * in the footers when the font can print it. */
export async function instructionsPdf(fontBytes: Uint8Array, project: Project, lang: Lang, stem: string): Promise<Uint8Array> {
  if (!project.result) throw new Error(NO_RESULT);
  const title = t("ins.title", {}, undefined, lang);
  const { doc, font } = await newDoc(fontBytes, stem ? `${title} · ${stem}` : title, lang);
  const printable = glyphTest(font);
  const s = sheetTexts(project, lang, printable);
  const [PAGE_W, PAGE_H] = sheetPage(project.paper);
  // the largest pin number printed: the frame's pins and, for a piece that has them, those inside the picture
  const pins = project.frame.pins + (project.result.inside ? project.result.inside.length / 2 : 0);
  const pages = layoutInstructions(s, pins, (text, size) => textWidthMm(font, text, size), (text, size, width) => wrap(font, text, size, width), [PAGE_W, PAGE_H]);
  const footer = stem && printable(stem) ? `${s.title} · ${stem}` : s.title;
  pages.forEach((prims, i) => {
    const page = addPage(doc, PAGE_W, PAGE_H);
    drawPrims(page, font, prims);
    drawPrims(page, font, [
      { t: "text", at: [SIDE, PAGE_H - 8], text: footer, size: SMALL, color: MUTED },
      { t: "text", at: [PAGE_W - SIDE, PAGE_H - 8], text: t("pdf.page", { p: i + 1, n: pages.length }, undefined, lang), size: SMALL, color: MUTED, align: "right" },
    ]);
  });
  return save(doc);
}
