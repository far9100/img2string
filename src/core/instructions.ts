// Winding instructions (spec §7.3) and materials (§7.5): what one thread needs, the pin sequence in rows of
// ten with a clock position to find the row's first pin, and the same content as CSV and plain text.
// Sequences hold 0-based pins (§11); everything a person reads here is 1-based, pin 1 at 12 o'clock and
// numbers growing clockwise as seen from the front (§2). Lengths include the 5 % margin (DECISIONS D-05).
// No DOM: the PDF is laid out from sheetTexts() in the export worker, and the tests run in Node.
import { t, type Lang } from "../i18n/translate.ts";
import { toOptions, type Project } from "./project.ts";
import { threadLengthMm } from "./stringart.ts";

/** Spare thread on top of the computed length (§7.5). */
export const THREAD_MARGIN = 0.05;
/** Board beyond the pin circle on every side (mm): the board is D + 40 (§7.5). */
export const BOARD_MARGIN_MM = 20;
/** Message of the Error thrown by every output that needs a generated result. */
export const NO_RESULT = "no-result";

/** Where to look for a pin: the hour-hand position of that pin, rounded to 5 minutes. Pin 0 is "12:00"; the spec's
 *  example is 1-based pin 137 of 256 -> "6:25" (0-based 136: 136/256*12 h = 6:22.5 -> 6:25). Hours print as 1..12. */
export function clockHint(pin0: number, pins: number): string {
  const pin = ((pin0 % pins) + pins) % pins;
  // Twelve hours are 144 steps of five minutes. Rounded in whole numbers (halves up), so 6:22.5 is 6:25 on
  // every frame, and a pin just before the top wraps to 12:00 instead of printing "11:60".
  const step = Math.floor((288 * pin + pins) / (2 * pins)) % 144;
  const hour = Math.floor(step / 12);
  return `${hour === 0 ? 12 : hour}:${String((step % 12) * 5).padStart(2, "0")}`;
}

export interface ThreadPlan {
  /** 0-based position in the winding order (= index into project.threads). */
  index: number;
  name: string;
  hex: string;
  /** The project's own sequence (0-based pins), not a copy. */
  sequence: number[];
  lines: number;
  /** Chords + half a pin circumference per visit, + 5 %. */
  lengthMm: number;
  /** 0-based; -1 when the thread has no lines. */
  startPin: number;
  endPin: number;
}

/** One plan per thread, in winding order; empty array when the project has no result. */
export function threadPlans(p: Project): ThreadPlan[] {
  const result = p.result;
  if (!result) return [];
  const o = toOptions(p);
  return p.threads.map((thread, index): ThreadPlan => {
    const sequence = result.sequences[index] ?? [];
    const lines = Math.max(0, sequence.length - 1);
    return {
      index, name: thread.name, hex: thread.hex, sequence, lines,
      lengthMm: threadLengthMm(sequence, o, p.frame.pinDiameterMm) * (1 + THREAD_MARGIN),
      startPin: lines ? sequence[0]! : -1,
      endPin: lines ? sequence[sequence.length - 1]! : -1,
    };
  });
}

export interface Materials {
  /** One entry per thread in winding order; empty when the project has no result. */
  threads: { name: string; hex: string; lines: number; lengthM: number }[];
  totalLines: number;
  totalLengthM: number;
  nails: number;
  nailLengthMm: number;
  /** D + 40. */
  boardMm: number;
  /** Total lines x seconds per line. */
  windingSeconds: number;
}

export function materials(p: Project): Materials {
  const threads = threadPlans(p).map((plan) => ({ name: plan.name, hex: plan.hex, lines: plan.lines, lengthM: plan.lengthMm / 1000 }));
  const totalLines = threads.reduce((n, thread) => n + thread.lines, 0);
  return {
    threads,
    totalLines,
    totalLengthM: threads.reduce((m, thread) => m + thread.lengthM, 0),
    nails: p.frame.pins,
    // A simple rule of thumb, not a calculation: thin nails (up to 2 mm) of 25 mm leave room for the thread
    // above about 10 mm in the board; thicker ones need a deeper hold, so 30 mm.
    nailLengthMm: p.frame.pinDiameterMm <= 2 ? 25 : 30,
    boardMm: p.frame.diameterMm + 2 * BOARD_MARGIN_MM,
    windingSeconds: totalLines * p.player.secondsPerLine,
  };
}

export interface Row {
  /** 1-based number of the first step in the row. */
  index: number;
  /** 1-based. */
  pins: number[];
  /** Hint for the row's first pin. */
  clock: string;
}

/** The sequence in rows of `perRow` pins (default 10). The first pin of a thread is where the thread is tied on. */
export function sequenceRows(sequence: readonly number[], pins: number, perRow = 10): Row[] {
  const per = Math.max(1, Math.floor(perRow));
  const rows: Row[] = [];
  for (let i = 0; i < sequence.length; i += per) {
    rows.push({ index: i + 1, pins: sequence.slice(i, i + per).map((pin) => pin + 1), clock: clockHint(sequence[i]!, pins) });
  }
  return rows;
}

/** What a thread is called in print: its name followed by its colour code, or the code alone when the name is
 * empty, repeats the code, or `printable` rejects it (the PDF font has no glyph for one of its characters). */
export function threadLabel(name: string, hex: string, printable: (s: string) => boolean = () => true): string {
  const clean = name.trim();
  return clean && clean.toUpperCase() !== hex.toUpperCase() && printable(clean) ? `${clean} (${hex})` : hex;
}

/** Thread to buy, in whole metres (rounded up). */
export const metres = (lengthMm: number): number => Math.max(0, Math.ceil(lengthMm / 1000 - 1e-9));

/** Every text of the instruction sheet, in reading order: the PDF and the plain-text file print the same. */
export interface SheetTexts {
  title: string;
  subtitle: string;
  howTitle: string;
  how: string;
  materialsTitle: string;
  /** Heads of the materials table: thread, lines, length. */
  head: [string, string, string];
  rows: { label: string; hex: string; lines: string; length: string }[];
  /** The sum row; null when there is one thread. */
  total: { label: string; lines: string; length: string } | null;
  /** Nails, board, winding time, and the note that lengths include the margin. */
  notes: string[];
  sections: { plan: ThreadPlan; title: string; continued: string; facts: string; rows: Row[] }[];
}

/** Throws Error("no-result") when the project has no result. `printable` decides whether a thread's name can
 * be printed (see threadLabel). */
export function sheetTexts(p: Project, lang: Lang, printable: (s: string) => boolean = () => true): SheetTexts {
  if (!p.result) throw new Error(NO_RESULT);
  const plans = threadPlans(p), m = materials(p), N = p.frame.pins;
  const label = (plan: ThreadPlan) => threadLabel(plan.name, plan.hex, printable);
  const minutes = Math.round(m.windingSeconds / 60), s = p.player.secondsPerLine;
  return {
    title: t("ins.title", {}, undefined, lang),
    subtitle: t("ins.subtitle", { d: p.frame.diameterMm, pins: N, threads: plans.length, lines: m.totalLines }, undefined, lang),
    howTitle: t("ins.howTitle", {}, undefined, lang),
    how: t("ins.how", { pins: N }, undefined, lang),
    materialsTitle: t("mat.title", {}, undefined, lang),
    head: [t("mat.thread", {}, undefined, lang), t("mat.lines", {}, undefined, lang), t("mat.length", {}, undefined, lang)],
    rows: plans.map((plan) => ({ label: label(plan), hex: plan.hex, lines: String(plan.lines), length: `${metres(plan.lengthMm)} m` })),
    // the column adds up: the sum of the rounded rows, not the rounded sum
    total: plans.length > 1 ? { label: t("mat.total", {}, undefined, lang), lines: String(m.totalLines), length: `${plans.reduce((sum, plan) => sum + metres(plan.lengthMm), 0)} m` } : null,
    notes: [
      t("mat.nails", { n: m.nails, dia: p.frame.pinDiameterMm, len: m.nailLengthMm }, undefined, lang),
      t("mat.board", { size: m.boardMm, d: p.frame.diameterMm, margin: BOARD_MARGIN_MM }, undefined, lang),
      minutes < 60 ? t("mat.timeShort", { min: minutes, s }, undefined, lang) : t("mat.time", { h: Math.floor(minutes / 60), min: minutes % 60, s }, undefined, lang),
      t("mat.margin", { percent: Math.round(100 * THREAD_MARGIN) }, undefined, lang),
    ],
    sections: plans.map((plan) => {
      const title = t("ins.thread", { i: plan.index + 1, n: plans.length, name: label(plan) }, undefined, lang);
      return {
        plan,
        title,
        continued: t("ins.continued", { thread: title }, undefined, lang),
        facts: plan.lines
          ? t("ins.facts", { start: plan.startPin + 1, startClock: clockHint(plan.startPin, N), end: plan.endPin + 1, endClock: clockHint(plan.endPin, N), lines: plan.lines, m: metres(plan.lengthMm) }, undefined, lang)
          : t("ins.empty", {}, undefined, lang),
        rows: plan.lines ? sequenceRows(plan.sequence, N) : [],
      };
    }),
  };
}

// ---- text helpers shared with the PDF ----

const CJK = "\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef";
const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+\\s*|\\s+`, "g");
/** Closing punctuation (ideographic comma and full stop, full-width , . : ; ? ! ) and closing quotes, %). */
const CLOSING = /^[\u3001\u3002\uff0c\uff0e\uff1a\uff1b\uff1f\uff01\uff09\u300d\u300f\u300b\uff05]/;
/** Opening brackets and quotes (full-width "(" and the three corner quotes). */
const OPENING = /[\uff08\u300c\u300e\u300a]$/;

/** Breaks a paragraph into lines that `fits` accepts: between words in English, between any two characters
 * in Chinese, but never so that a line starts with closing punctuation or ends with an opening bracket.
 * A single word that does not fit gets a line of its own. */
export function breakLines(s: string, fits: (line: string) => boolean): string[] {
  const parts: string[] = [];
  for (const token of s.match(TOKEN) ?? []) {
    const last = parts.length - 1;
    if (last >= 0 && (CLOSING.test(token) || OPENING.test(parts[last]!))) parts[last] += token;
    else parts.push(token);
  }
  const out: string[] = [];
  let line = "";
  for (const part of parts) {
    if (line && !fits((line + part).trimEnd())) {
      out.push(line.trimEnd());
      line = part.trimStart();
    } else line += part;
  }
  if (line.trim()) out.push(line.trimEnd());
  return out;
}

const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;
/** Columns a string takes in a fixed-width font: Chinese characters and full-width punctuation take two. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

// ---- CSV and plain text ----

const CONTROL = /[\u0000-\u001f\u007f]/;
const EOL = "\r\n"; // read by spreadsheets and by Notepad alike

function csvCell(s: string): string {
  // A cell a spreadsheet would run as a formula becomes plain text: names come from project files, which
  // people pass around.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The sequences as a table (RFC 4180): a header, then one line per step with the thread's number (1-based),
 * name and colour, the step (1 = the pin the thread is tied to), the pin (1-based) and its clock hint.
 * Throws Error("no-result") when the project has no result. */
export function instructionsCsv(p: Project): string {
  if (!p.result) throw new Error(NO_RESULT);
  const lines = ["thread,name,hex,step,pin,clock"];
  for (const plan of threadPlans(p)) {
    const head = `${plan.index + 1},${csvCell(plan.name)},${csvCell(plan.hex)},`;
    plan.sequence.forEach((pin, i) => lines.push(`${head}${i + 1},${pin + 1},${clockHint(pin, p.frame.pins)}`));
  }
  return lines.join(EOL) + EOL;
}

const TXT_WIDTH = 78;

/** The instruction sheet as plain text: the PDF's content, for a screen or a plain printer.
 * Throws Error("no-result") when the project has no result. */
export function instructionsTxt(p: Project, lang: Lang): string {
  const s = sheetTexts(p, lang, (name) => !CONTROL.test(name));
  const out: string[] = [];
  const heading = (text: string, rule: string) => out.push(text, rule.repeat(displayWidth(text)));
  const para = (text: string) => out.push(...breakLines(text, (line) => displayWidth(line) <= TXT_WIDTH));
  const left = (text: string, width: number) => text + " ".repeat(Math.max(0, width - displayWidth(text)));
  const right = (text: string, width: number) => " ".repeat(Math.max(0, width - displayWidth(text))) + text;

  heading(s.title, "=");
  out.push(s.subtitle, "");
  heading(s.howTitle, "-");
  para(s.how);
  out.push("");

  heading(s.materialsTitle, "-");
  const table = [{ label: s.head[0], lines: s.head[1], length: s.head[2] }, ...s.rows, ...(s.total ? [s.total] : [])];
  const widths = (["label", "lines", "length"] as const).map((key) => Math.max(...table.map((row) => displayWidth(row[key]))));
  for (const row of table) out.push(`${left(row.label, widths[0]!)}  ${right(row.lines, widths[1]!)}  ${right(row.length, widths[2]!)}`);
  out.push("");
  for (const note of s.notes) para(note);
  out.push("");

  const pinWidth = String(p.frame.pins).length;
  for (const section of s.sections) {
    heading(section.title, "-");
    para(section.facts);
    out.push("");
    const indexWidth = String(section.rows.length ? section.rows[section.rows.length - 1]!.index : 1).length;
    for (const row of section.rows) {
      out.push(`[ ] ${right(String(row.index), indexWidth)}   ${left(row.pins.map((pin) => right(String(pin), pinWidth)).join(" "), 10 * (pinWidth + 1) - 1)}   ${row.clock}`);
    }
    if (section.rows.length) out.push("");
  }
  return out.join(EOL).trimEnd() + EOL;
}
