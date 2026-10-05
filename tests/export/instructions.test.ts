// The winding instructions as files (spec §7.3, §7.6): the PDF for 4,000 lines, the CSV and text downloads,
// the lines as SVG, the file names, and the PDF font.
import fontkit from "@pdf-lib/fontkit";
import { describe, expect, it } from "vitest";
import { breakLines, clockHint, sheetTexts } from "../../src/core/instructions.ts";
import { defaultProject, type Project } from "../../src/core/project.ts";
import { buildFile, EXPORT_KINDS, needsFont, needsResult, type ExportKind } from "../../src/export/build.ts";
import { layoutInstructions, sheetPage } from "../../src/export/instructionsPdf.ts";
import { FILE, stemOf } from "../../src/export/names.ts";
import { crc32, encodePng } from "../../src/export/png.ts";
import { pt } from "../../src/export/tiles.ts";
import { templatePins } from "../../src/render/template.ts";
import zh from "../../src/i18n/zh-TW.json";
import en from "../../src/i18n/en.json";
import { colourProject, fillsWith, fontBytes, glyphHex, keep, madeUpProject, pageContents, quads, showsText, textWidth, type GlyphFont } from "../helpers/pdf.ts";

const FONT = fontBytes();
const font = fontkit.create(FONT) as unknown as GlyphFont;
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const build = (project: Project, kind: ExportKind, lang: "zh-TW" | "en" = "en", stem = "test") => buildFile(FONT, { project, lang, stem }, kind);
/** The tick boxes of a page: outlined squares 2.4 mm a side. */
const boxes = (content: string) => quads(content).filter(([x0, y0, x1, y1]) => Math.abs(x1 - x0 - pt(2.4)) < 1e-6 && Math.abs(y1 - y0 - pt(2.4)) < 1e-6);

describe("the instructions PDF (§7.3)", () => {
  it("prints 4,000 lines on a few A4 pages, a box per row of ten, and is byte-for-byte reproducible", async () => {
    const p = madeUpProject([4000]);
    const started = performance.now();
    const file = await build(p, "instructions-pdf");
    const seconds = (performance.now() - started) / 1000;
    keep("instructions-4000-en.pdf", file.bytes);
    expect(file.name).toBe("test-instructions.pdf");
    expect(file.mime).toBe("application/pdf");
    const pages = await pageContents(file.bytes);
    expect(pages.length).toBeGreaterThanOrEqual(3);
    expect(pages.length).toBeLessThanOrEqual(5);
    for (const page of pages) {
      expect(page.width).toBeCloseTo(pt(210), 6);
      expect(page.height).toBeCloseTo(pt(297), 6);
    }
    // 4,001 pins in rows of ten: 401 rows, each with its box
    expect(pages.reduce((n, page) => n + boxes(page.content).length, 0)).toBe(401);
    // the thread: its swatch, its heading, its facts, the first and the last row's step number
    const s = sheetTexts(p, "en");
    expect(fillsWith(pages[0]!.content, "#111111")).toBe(true);
    expect(showsText(pages[0]!.content, font, s.title)).toBe(true);
    expect(showsText(pages[0]!.content, font, "Thread 1 of 1 · black (#111111)")).toBe(true);
    expect(showsText(pages[0]!.content, font, s.sections[0]!.facts)).toBe(true);
    expect(showsText(pages[pages.length - 1]!.content, font, "3991")).toBe(true);
    // later pages say which thread they continue, and every page is numbered
    expect(showsText(pages[1]!.content, font, "Thread 1 of 1 · black (#111111) (continued)")).toBe(true);
    pages.forEach((page, i) => expect(showsText(page.content, font, `Page ${i + 1} of ${pages.length}`)).toBe(true));
    expect(new TextDecoder("latin1").decode(file.bytes)).toMatch(/\/PrintScaling \/None/);
    expect((await build(p, "instructions-pdf")).bytes).toEqual(file.bytes);
    expect(file.bytes.length).toBeLessThan(600_000);
    expect(seconds).toBeLessThan(20);
  });

  it("has a section for every thread, in winding order, in both languages", async () => {
    const p = colourProject();
    for (const lang of ["en", "zh-TW"] as const) {
      const file = await build(p, "instructions-pdf", lang);
      keep(`instructions-colour-${lang}.pdf`, file.bytes);
      const pages = await pageContents(file.bytes);
      expect(pages.length).toBeLessThanOrEqual(7);
      const all = pages.map((page) => page.content).join("\n");
      const s = sheetTexts(p, lang);
      let from = 0;
      for (const section of s.sections) {
        expect(fillsWith(all, section.plan.hex), section.plan.hex).toBe(true);
        // the headings follow one another in winding order
        const at = all.indexOf(`<${glyphHex(font, section.title)}> Tj`, from);
        expect(at, section.title).toBeGreaterThanOrEqual(from);
        from = at + 1;
      }
      // (1500 + 1379 + 536 + 606 lines) + 4 start pins, in rows of ten per thread
      const rows = [1501, 1380, 537, 607].reduce((n, pins) => n + Math.ceil(pins / 10), 0);
      expect(pages.reduce((n, page) => n + boxes(page.content).length, 0)).toBe(rows);
      // the materials table: every thread's lines, and the total
      for (const row of [...s.rows, s.total!]) expect(showsText(pages[0]!.content, font, row.lines), row.lines).toBe(true);
      for (const note of s.notes) expect(showsText(pages[0]!.content, font, note), note).toBe(true);
    }
  });

  it("prints a thread's name only when the font has every character of it, else its colour code", async () => {
    const p = colourProject([30, 30, 30, 30]);
    p.threads[0]!.name = "ja\u00f1e"; // n with tilde: not in the subset
    p.threads[1]!.name = "\u{1f9f5}"; // an emoji
    p.threads[2]!.name = "\u7d05"; // "red" in Chinese: among the thread words the subset keeps
    const pages = await pageContents((await build(p, "instructions-pdf")).bytes);
    const all = pages.map((page) => page.content).join("\n");
    expect(showsText(all, font, "Thread 1 of 4 · #FFE000")).toBe(true);
    expect(showsText(all, font, "Thread 2 of 4 · #00A0E0")).toBe(true);
    expect(showsText(all, font, "Thread 3 of 4 · \u7d05 (#E0007A)")).toBe(true);
    expect(showsText(all, font, "Thread 4 of 4 · black (#111111)")).toBe(true);
    // nothing was printed with the missing-glyph box (glyph 0)
    expect(all).not.toMatch(/<(?:[0-9A-F]{4})*0000(?:[0-9A-F]{4})*> Tj/);
    // the plain-text file has no font to worry about
    expect(text((await build(p, "instructions-txt")).bytes)).toContain("Thread 1 of 4 · ja\u00f1e (#FFE000)");
  });

  it("lays the whole sequence out in reading order, inside the page, without a row cut off", () => {
    const measure = (s: string, size: number) => textWidth(font, s, size);
    const wrapped = (s: string, size: number, width: number) => breakLines(s, (line) => measure(line, size) <= width);
    for (const p of [madeUpProject([4000]), colourProject(), colourProject([9, 0, 10, 11]), madeUpProject([20000], (q) => { q.frame.pins = 512; })]) {
      const s = sheetTexts(p, "en");
      const pages = layoutInstructions(s, p.frame.pins, measure, wrapped);
      // The right-aligned whole numbers in ink at 3 mm are the line counts of the materials table, then the
      // pin numbers: read in the order they were laid down, which is the order they are read on the page.
      const numbers = pages.flat().filter((prim) => prim.t === "text" && prim.size === 3 && prim.align === "right" && prim.color === "#1c1d1f" && /^\d+$/.test(prim.text));
      const printed = numbers.slice(s.rows.length + (s.total ? 1 : 0));
      const expected = p.result!.sequences.filter((seq) => seq.length > 1).flat().map((pin) => String(pin + 1));
      expect(printed.map((prim) => (prim.t === "text" ? prim.text : ""))).toEqual(expected);
      for (const prims of pages) {
        for (const prim of prims) {
          if (prim.t !== "text") continue;
          const left = prim.align === "right" ? prim.at[0] - measure(prim.text, prim.size) : prim.at[0];
          expect(left, prim.text).toBeGreaterThanOrEqual(12 - 1e-6);
          expect(left + measure(prim.text, prim.size), prim.text).toBeLessThanOrEqual(198 + 1e-6);
          expect(prim.at[1]).toBeGreaterThan(13);
          expect(prim.at[1], prim.text).toBeLessThanOrEqual(297 - 15 + 1e-6);
        }
      }
    }
    // 4,000 lines: two columns of rows
    const xs = new Set(layoutInstructions(sheetTexts(madeUpProject([4000]), "en"), 256, measure, wrapped).flat().filter((prim) => prim.t === "poly" && !prim.fill).map((prim) => (prim.t === "poly" ? prim.pts[0]![0] : 0)));
    expect(xs.size).toBe(2);
  });

  it("is a Letter sheet when the paper is Letter, and A4 for A4 and A3", async () => {
    expect([sheetPage("A4"), sheetPage("A3"), sheetPage("Letter")]).toEqual([[210, 297], [210, 297], [215.9, 279.4]]);
    const p = madeUpProject([4000], (q) => { q.paper = "Letter"; });
    const pages = await pageContents((await build(p, "instructions-pdf")).bytes);
    for (const page of pages) {
      expect(page.width).toBeCloseTo(612, 6);
      expect(page.height).toBeCloseTo(792, 6);
    }
    // the shorter page holds fewer rows, so the same 401 rows may take one page more, and nothing is lost
    expect(pages.reduce((n, page) => n + boxes(page.content).length, 0)).toBe(401);
    pages.forEach((page, i) => expect(showsText(page.content, font, `Page ${i + 1} of ${pages.length}`)).toBe(true));
    // everything laid out stays above the footer of the shorter page and inside the wider one
    const measure = (s: string, size: number) => textWidth(font, s, size);
    const wrapped = (s: string, size: number, width: number) => breakLines(s, (line) => measure(line, size) <= width);
    for (const prim of layoutInstructions(sheetTexts(p, "en"), 256, measure, wrapped, sheetPage("Letter")).flat()) {
      if (prim.t !== "text") continue;
      const left = prim.align === "right" ? prim.at[0] - measure(prim.text, prim.size) : prim.at[0];
      expect(left, prim.text).toBeGreaterThanOrEqual(12 - 1e-6);
      expect(left + measure(prim.text, prim.size), prim.text).toBeLessThanOrEqual(215.9 - 12 + 1e-6);
      expect(prim.at[1], prim.text).toBeLessThanOrEqual(279.4 - 15 + 1e-6);
    }
    const a3 = await pageContents((await build(madeUpProject([40], (q) => { q.paper = "A3"; }), "instructions-pdf")).bytes);
    expect([a3[0]!.width, a3[0]!.height].map((v) => Math.round(v * 100) / 100)).toEqual([595.28, 841.89]);
  });
});

describe("CSV and text downloads (§7.3)", () => {
  it("are UTF-8 with a byte-order mark, so spreadsheets and old editors read Chinese names", async () => {
    const p = madeUpProject([12]);
    p.threads[0]!.name = "\u9ed1"; // "black"
    const csv = await build(p, "instructions-csv");
    keep("instructions.csv", csv.bytes);
    expect(csv.name).toBe("test-instructions.csv");
    expect(csv.mime).toBe("text/csv;charset=utf-8");
    expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder("utf-8", { ignoreBOM: false }).decode(csv.bytes).trimEnd().split("\r\n");
    expect(lines[0]).toBe("thread,name,hex,step,pin,clock");
    expect(lines).toHaveLength(1 + 13);
    const first = p.result!.sequences[0]![0]!;
    expect(lines[1]).toBe(`1,\u9ed1,#111111,1,${first + 1},${clockHint(first, 256)}`);
    const txt = await build(p, "instructions-txt", "zh-TW");
    keep("instructions-zh-TW.txt", txt.bytes);
    expect(txt.name).toBe("test-instructions.txt");
    expect(txt.mime).toBe("text/plain;charset=utf-8");
    expect([...txt.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text(txt.bytes)).toContain(sheetTexts(p, "zh-TW").sections[0]!.title);
  });
});

describe("the lines as SVG (§7.6)", () => {
  it("has one <g> per thread in winding order and one <line> per step, as wide as the thread, in mm", async () => {
    const p = colourProject([25, 0, 12, 31]);
    p.thread.widthMm = 0.3;
    p.board = "#F4F1EA";
    const file = await build(p, "lines-svg");
    keep("lines.svg", file.bytes);
    expect(file.name).toBe("test-lines.svg");
    expect(file.mime).toBe("image/svg+xml");
    const svg = text(file.bytes);
    expect(svg).toContain(`width="540mm" height="540mm" viewBox="0 0 540 540"`);
    expect(svg).toContain(`<rect width="540" height="540" fill="#F4F1EA"/>`);
    const groups = [...svg.matchAll(/<g id="thread-(\d)" fill="none" stroke="(#[0-9A-F]{6})" stroke-width="0.3" stroke-linecap="butt">\n<title>([^<]*)<\/title>\n([\s\S]*?)<\/g>/g)];
    expect(svg.match(/<g /g)).toHaveLength(4);
    expect(groups.map((m) => [m[1], m[2], m[3]])).toEqual([["1", "#FFE000", "yellow (#FFE000)"], ["2", "#00A0E0", "cyan (#00A0E0)"], ["3", "#E0007A", "magenta (#E0007A)"], ["4", "#111111", "black (#111111)"]]);
    expect(groups.map((m) => (m[4]!.match(/<line /g) ?? []).length)).toEqual([25, 0, 12, 31]);
    expect(svg.match(/<line /g)).toHaveLength(68);
    // every line joins the two pins of its step
    const P = templatePins(p.frame);
    const lines = [...groups[2]![4]!.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"\/>/g)].map((m) => m.slice(1, 5).map(Number));
    const seq = p.result!.sequences[2]!;
    lines.forEach(([x1, y1, x2, y2], i) => {
      const a = P[seq[i]!]!, b = P[seq[i + 1]!]!;
      expect(Math.hypot(x1! - a[0], y1! - a[1])).toBeLessThan(0.001);
      expect(Math.hypot(x2! - b[0], y2! - b[1])).toBeLessThan(0.001);
    });
  });

  it("keeps a name with markup in it as text", async () => {
    const p = madeUpProject([3]);
    p.threads[0]!.name = `<b>"A&B"</b>\u0001`;
    const svg = text((await build(p, "lines-svg")).bytes);
    expect(svg).toContain(`<title>&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt; (#111111)</title>`);
    expect(svg).not.toContain("\u0001");
  });
});

describe("building files (§7.6)", () => {
  it("names every download after the picture", async () => {
    const p = madeUpProject([40]);
    const names: Record<ExportKind, string> = {
      "template-pdf": "sunset-template.pdf", "template-svg": "sunset-template.svg", "template-dxf": "sunset-template.dxf",
      "instructions-pdf": "sunset-instructions.pdf", "instructions-csv": "sunset-instructions.csv", "instructions-txt": "sunset-instructions.txt",
      "lines-svg": "sunset-lines.svg",
    };
    expect(Object.keys(names).sort()).toEqual([...EXPORT_KINDS].sort());
    for (const kind of EXPORT_KINDS) {
      const file = await build(p, kind, "zh-TW", stemOf("sunset.jpg"));
      expect(file.name).toBe(names[kind]);
      expect(file.bytes.length).toBeGreaterThan(100);
      if (kind.endsWith("-pdf")) expect(text(file.bytes.subarray(0, 5))).toBe("%PDF-");
    }
    expect(FILE.project("sunset")).toBe("sunset.img2string.json");
    expect(FILE.preview("sunset")).toBe("sunset-preview.png");
  });

  it("needs the font for the two PDFs only", async () => {
    const p = madeUpProject([40]);
    expect(EXPORT_KINDS.filter(needsFont)).toEqual(["template-pdf", "instructions-pdf"]);
    for (const kind of EXPORT_KINDS) {
      const made = buildFile(null, { project: p, lang: "en", stem: "test" }, kind);
      if (needsFont(kind)) await expect(made).rejects.toThrow(/^no-font$/);
      else expect((await made).bytes.length).toBeGreaterThan(100);
    }
  });

  it("without a result: the template is there, the instructions and the lines throw 'no-result'", async () => {
    const p = defaultProject();
    expect(p.result).toBeNull();
    expect(EXPORT_KINDS.filter(needsResult)).toEqual(["instructions-pdf", "instructions-csv", "instructions-txt", "lines-svg"]);
    for (const kind of EXPORT_KINDS) {
      if (needsResult(kind)) {
        await expect(build(p, kind)).rejects.toThrow(/^no-result$/);
        await expect(buildFile(null, { project: p, lang: "en", stem: "test" }, kind)).rejects.toThrow(/^no-result$/); // said before any font is asked for
      } else expect((await build(p, kind)).name).toMatch(/^test-template\./);
    }
  });

  it("makes a safe file-name stem from the picture's name", () => {
    expect(stemOf("My photo (1).JPG")).toBe("My-photo-1");
    expect(stemOf("caf\u00e9 cr\u00e8me.png")).toBe("cafe-creme");
    expect(stemOf("\u7167\u7247.png")).toBe("img2string"); // nothing ASCII is left of a Chinese name
    expect(stemOf("sample-face")).toBe("sample-face");
    expect(stemOf("a_b-c.tar.gz")).toBe("a_b-c-tar");
    expect(stemOf("../../etc/passwd")).toBe("etc-passwd");
    expect(stemOf("con.png")).toBe("img2string"); // a device name on Windows
    expect(stemOf(null)).toBe("img2string");
    expect(stemOf("")).toBe("img2string");
    const long = stemOf(`${"x".repeat(39)} y z.png`);
    expect(long).toBe("x".repeat(39));
    expect(stemOf("y".repeat(80))).toHaveLength(40);
    for (const name of ["My photo (1).JPG", "\u7167\u7247.png", "a b", "-", "..", "x".repeat(100)]) expect(stemOf(name)).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
  });
});

describe("PNG encoder", () => {
  it("writes a valid PNG with the pixel size, every chunk's CRC right", () => {
    const w = 5, h = 3;
    const png = encodePng(Uint8Array.from({ length: w * h * 3 }, (_, i) => (i * 37) % 256), w, h, 3, { pixelMm: 0.25 });
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20), png[24], png[25]]).toEqual([w, h, 8, 2]);
    const types: string[] = [];
    let at = 8;
    while (at < png.length) {
      const len = view.getUint32(at);
      types.push(String.fromCharCode(...png.subarray(at + 4, at + 8)));
      expect((crc32(png.subarray(at + 4, at + 8 + len)) ^ 0xffffffff) >>> 0).toBe(view.getUint32(at + 8 + len));
      if (types[types.length - 1] === "pHYs") expect([view.getUint32(at + 8), view.getUint32(at + 12), png[at + 16]]).toEqual([4000, 4000, 1]); // 0.25 mm pixels
      at += 12 + len;
    }
    expect(types).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
  });
});

describe("PDF font", () => {
  it("has a glyph for every character of both languages", () => {
    const chars = new Set<string>();
    for (const table of [zh, en] as Record<string, string | Record<string, string>>[]) {
      for (const v of Object.values(table)) for (const s of typeof v === "string" ? [v] : Object.values(v)) for (const ch of s) chars.add(ch);
    }
    const missing = [...chars].filter((ch) => ch.trim() && !font.hasGlyphForCodePoint(ch.codePointAt(0)!));
    expect(missing).toEqual([]);
  });

  it("has printable ASCII and the common words for thread colours, and no layout tables to trip pdf-lib", () => {
    for (let c = 0x21; c < 0x7f; c++) expect(font.hasGlyphForCodePoint(c), String.fromCharCode(c)).toBe(true);
    // black, white, red, yellow, green, blue, deep, light, thread, colour
    for (const ch of "\u9ed1\u767d\u7d05\u9ec3\u7da0\u85cd\u6df1\u6dfa\u7dda\u8272×·") expect(font.hasGlyphForCodePoint(ch.codePointAt(0)!), ch).toBe(true);
    const tables = Object.keys((font as unknown as { directory: { tables: Record<string, unknown> } }).directory.tables);
    for (const table of ["GSUB", "GPOS", "GDEF"]) expect(tables).not.toContain(table);
    expect(FONT.length).toBeLessThan(400_000);
  });
});
