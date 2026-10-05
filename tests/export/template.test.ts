// The nail template (spec §7.2): the drawing, the tiled 1:1 PDF, the SVG and the DXF all put every pin where
// the core puts it, and the print can be checked with a ruler (§13.4).
import fontkit from "@pdf-lib/fontkit";
import { describe, expect, it } from "vitest";
import { materials } from "../../src/core/instructions.ts";
import { defaultProject, PAPERS, type Paper, type Project } from "../../src/core/project.ts";
import { pinPositions } from "../../src/core/stringart.ts";
import { buildFile } from "../../src/export/build.ts";
import { BAR_HEIGHT, bandPrims, bandTexts, markPrims, OVERLAP, PRINTER_MARGIN, stripMarks, templatePlan, tileOrigin, type StripMark } from "../../src/export/templatePdf.ts";
import { BAND, PAPER_SIZE, planTiles, pt, PT_PER_MM } from "../../src/export/tiles.ts";
import { primBox, type Prim } from "../../src/render/prims.ts";
import { boardSide, templateDrawing, templateLayers, templatePins } from "../../src/render/template.ts";
import { circles, filledQuads, fontBytes, keep, pageContents, textWidth, type GlyphFont } from "../helpers/pdf.ts";

const FONT = fontBytes();
const text = (b: Uint8Array) => new TextDecoder().decode(b);

function project(diameterMm: number, pins: number, paper: Paper = "A4", pinDiameterMm = 1.5): Project {
  const p = defaultProject();
  p.frame = { shape: "circle", diameterMm, pins, pinDiameterMm };
  p.paper = paper;
  return p;
}
const build = (p: Project, kind: Parameters<typeof buildFile>[2], lang: "zh-TW" | "en" = "zh-TW") => buildFile(FONT, { project: p, lang, stem: "test" }, kind);

/** Pin i by the spec's rule (§2, §3): pin 1 at 12 o'clock, clockwise, on a board with 20 mm around the circle. */
function analytic(frame: Project["frame"]): [number, number][] {
  const c = frame.diameterMm / 2 + 20, r = frame.diameterMm / 2;
  return Array.from({ length: frame.pins }, (_, i): [number, number] => {
    const turn = (2 * Math.PI * i) / frame.pins;
    return [c + r * Math.sin(turn), c - r * Math.cos(turn)]; // y down
  });
}

const FRAMES: Project["frame"][] = [
  { shape: "circle", diameterMm: 500, pins: 256, pinDiameterMm: 1.5 },
  { shape: "circle", diameterMm: 300, pins: 128, pinDiameterMm: 2 },
  { shape: "circle", diameterMm: 200, pins: 64, pinDiameterMm: 0.5 },
  { shape: "circle", diameterMm: 1000, pins: 512, pinDiameterMm: 5 },
  { shape: "circle", diameterMm: 200, pins: 510, pinDiameterMm: 1.5 },
  { shape: "circle", diameterMm: 437.5, pins: 97, pinDiameterMm: 1.2 },
];

describe("the template drawing (§7.2)", () => {
  it("puts pin 1 at the top and counts clockwise, exactly where the core has its pins", () => {
    for (const frame of FRAMES) {
      const pins = templatePins(frame), want = analytic(frame), S = frame.diameterMm + 40;
      expect(pins).toHaveLength(frame.pins);
      pins.forEach(([x, y], i) => {
        expect(x, `x of pin ${i}`).toBeCloseTo(want[i]![0], 9);
        expect(y, `y of pin ${i}`).toBeCloseTo(want[i]![1], 9);
      });
      expect(pins[0]![0]).toBeCloseTo(S / 2, 9);
      expect(pins[0]![1]).toBeCloseTo(20, 9); // the top of the circle
      expect(pins[1]![0]).toBeGreaterThan(S / 2); // the next pin is to the right: clockwise seen from the front
      // the working grid of the core, scaled to millimetres, is the same circle
      const res = 400, P = pinPositions(frame.pins, res), mm = frame.diameterMm / (res - 1);
      pins.forEach(([x, y], i) => {
        expect(x).toBeCloseTo(20 + P[2 * i]! * mm, 9);
        expect(y).toBeCloseTo(20 + P[2 * i + 1]! * mm, 9);
      });
    }
    const quarter = templatePins(FRAMES[0]!)[64]!;
    expect(quarter[0]).toBeCloseTo(520, 9); // pin N/4 + 1 is at 3 o'clock
    expect(quarter[1]).toBeCloseTo(270, 9);
  });

  it("is the board, D + 40 mm square, as the materials list says", () => {
    for (const frame of FRAMES) {
      const d = templateDrawing(frame), S = frame.diameterMm + 40;
      expect([d.width, d.height]).toEqual([S, S]);
      expect(boardSide(frame)).toBe(S);
      const p = defaultProject();
      p.frame = frame;
      expect(materials(p).boardMm).toBe(S);
      const outline = templateLayers(frame).board;
      expect(outline).toEqual([{ t: "poly", pts: [[0, 0], [S, 0], [S, S], [0, S]], stroke: "#1c1d1f", width: 0.4 }]);
    }
  });

  it("draws the pin circle, a circle of the pin's size on every pin, and a cross at the centre", () => {
    for (const frame of FRAMES) {
      const L = templateLayers(frame), c = frame.diameterMm / 2 + 20;
      expect(L.frame).toEqual([{ t: "circle", c: [c, c], r: frame.diameterMm / 2, stroke: "#1c1d1f", width: 0.15 }]);
      expect(L.pins).toHaveLength(frame.pins);
      const want = templatePins(frame);
      L.pins.forEach((p, i) => expect(p).toEqual({ t: "circle", c: want[i], r: frame.pinDiameterMm / 2, stroke: "#1c1d1f", width: 0.2 }));
      // a hair through every pin's centre, along the radius
      const hairs = L.marks.filter((p) => p.t === "line" && p.width === 0.15);
      expect(hairs).toHaveLength(frame.pins);
      hairs.forEach((p, i) => {
        if (p.t !== "line") throw new Error();
        expect((p.a[0] + p.b[0]) / 2).toBeCloseTo(want[i]![0], 9);
        expect((p.a[1] + p.b[1]) / 2).toBeCloseTo(want[i]![1], 9);
      });
      const centre = L.marks.filter((p) => p.t === "line" && p.width === 0.25 && Math.abs((p.a[0] + p.b[0]) / 2 - c) < 1e-9 && Math.abs((p.a[1] + p.b[1]) / 2 - c) < 1e-9);
      expect(centre).toHaveLength(2);
      // the drawing is the four groups, pins last so they lie on top
      expect(templateDrawing(frame).prims).toEqual([...L.board, ...L.frame, ...L.marks, ...L.pins]);
    }
  });

  it("numbers every 5th pin outside the circle, marks every 10th bolder, and points clockwise from pin 1", () => {
    for (const frame of FRAMES) {
      const L = templateLayers(frame), c = frame.diameterMm / 2 + 20, r = frame.diameterMm / 2, S = frame.diameterMm + 40;
      const numbers = L.marks.filter((p) => p.t === "text");
      const labels = numbers.map((p) => (p.t === "text" ? p.text : ""));
      const fives = Array.from({ length: Math.floor(frame.pins / 5) }, (_, k) => String(5 * (k + 1)));
      // on a crowded frame the very last number makes way for pin 1
      const expected = frame.pins === 510 ? fives.slice(0, -1) : fives;
      expect(labels.slice(0, -1)).toEqual(expected);
      expect(labels[labels.length - 1]).toBe("1");
      const pins = templatePins(frame);
      for (const p of numbers) {
        if (p.t !== "text") throw new Error();
        const [x0, y0, x1, y1] = primBox(p);
        // outside the pin circle (beyond the pins themselves) and on the board
        expect(Math.hypot(p.at[0] - c, p.at[1] - c), p.text).toBeGreaterThan(r + frame.pinDiameterMm / 2 + 4);
        expect(Math.min(x0, y0), p.text).toBeGreaterThan(0);
        expect(Math.max(x1, y1), p.text).toBeLessThan(S);
        // beside its own pin: on the ray from the centre through it
        if (p.text === "1") continue;
        const [px, py] = pins[Number(p.text) - 1]!;
        const along = ((p.at[0] - c) * (px - c) + (p.at[1] - p.size * 0.3665 - c) * (py - c)) / r;
        const across = Math.abs((p.at[0] - c) * (py - c) - (p.at[1] - p.size * 0.3665 - c) * (px - c)) / r;
        expect(along, p.text).toBeGreaterThan(r);
        expect(across, p.text).toBeLessThan(1e-6);
      }
      // ticks: one per number, the tens thicker and longer than the fives
      const ticks = L.marks.filter((p) => p.t === "line" && (p.width === 0.25 || p.width === 0.6) && Math.hypot(p.a[0] - c, p.a[1] - c) > r);
      const tens = ticks.filter((p) => p.t === "line" && p.width === 0.6);
      expect(tens).toHaveLength(Math.floor(frame.pins / 10) + 1); // and the leader of pin 1
      expect(ticks).toHaveLength(Math.floor(frame.pins / 5) + 1);
      // the arrow: its head lies clockwise (to the right, at the top) of where its shaft begins
      const shaft = L.marks.find((p) => p.t === "path"), head = L.marks.find((p) => p.t === "poly");
      if (shaft?.t !== "path" || head?.t !== "poly" || shaft.d[0]!.c !== "M") throw new Error("no arrow");
      expect(shaft.d[0]!.p[0]).toBeGreaterThan(c);
      expect(head.pts[0]![0]).toBeGreaterThan(shaft.d[0]!.p[0] + 10);
      expect(Math.hypot(head.pts[0]![0] - c, head.pts[0]![1] - c)).toBeLessThan(r + 20); // on the board
    }
  });
});

describe("the template PDF (§7.2, §13.4)", () => {
  const CASES: [number, Paper, number][] = [[300, "A4", 4], [300, "A3", 2], [500, "A4", 6], [500, "A3", 4]];

  it("has as many pages as the tiling plans, each of the paper's size", async () => {
    for (const [d, paper, pages] of CASES) {
      const p = project(d, 256, paper);
      const plan = planTiles(d + 40, d + 40, paper, PRINTER_MARGIN, OVERLAP);
      expect(templatePlan(p.frame, paper)).toEqual(plan);
      expect(plan.tiles.length, `${d} mm on ${paper}`).toBe(pages);
      const file = await build(p, "template-pdf");
      keep(`template-${d}-${paper}.pdf`, file.bytes);
      expect(file.name).toBe("test-template.pdf");
      expect(file.mime).toBe("application/pdf");
      const got = await pageContents(file.bytes);
      expect(got).toHaveLength(pages);
      const [w, h] = PAPER_SIZE[paper], portrait = plan.orientation === "portrait";
      for (const page of got) {
        expect(page.width).toBeCloseTo(pt(portrait ? w : h), 6);
        expect(page.height).toBeCloseTo(pt(portrait ? h : w), 6);
      }
    }
  });

  it("asks viewers not to scale, and carries one 100 mm bar (283.465 pt) on every page, in the strip below the drawing", async () => {
    for (const [d, paper] of CASES) {
      const p = project(d, 256, paper), plan = templatePlan(p.frame, paper);
      const bytes = (await build(p, "template-pdf")).bytes;
      expect(new TextDecoder("latin1").decode(bytes)).toMatch(/\/PrintScaling \/None/);
      for (const page of await pageContents(bytes)) {
        const bars = filledQuads(page.content).filter(([x0, y0, x1, y1]) => Math.abs(x1 - x0 - 283.465) < 0.01 && Math.abs(y1 - y0 - pt(BAR_HEIGHT)) < 0.01);
        expect(bars).toHaveLength(1);
        const [x0, y0, , y1] = bars[0]!;
        expect(x0).toBeCloseTo(pt(plan.contentX), 6);
        // below the drawing area and above the printer margin
        expect(page.height - y1).toBeGreaterThan(pt(plan.contentY + plan.contentH));
        expect(y0).toBeGreaterThan(pt(PRINTER_MARGIN));
      }
    }
  });

  it("shows every pin on at least one page, where the tile's offset says it is (0.01 mm)", async () => {
    for (const [frame, paper] of [[FRAMES[0]!, "A4"], [FRAMES[0]!, "A3"], [FRAMES[1]!, "A4"], [FRAMES[1]!, "Letter"], [FRAMES[3]!, "A3"], [FRAMES[4]!, "A4"], [FRAMES[5]!, "A4"]] as const) {
      const p = defaultProject();
      p.frame = frame;
      p.paper = paper;
      const plan = templatePlan(frame, paper), want = analytic(frame), pinR = frame.pinDiameterMm / 2;
      const file = await build(p, "template-pdf", "en");
      keep(`template-${frame.diameterMm}-${frame.pins}-${paper}.pdf`, file.bytes);
      const pages = await pageContents(file.bytes);
      const seen = new Set<number>();
      pages.forEach((page, k) => {
        const tile = plan.tiles[k]!, [ox, oy] = tileOrigin(plan, tile);
        for (const circle of circles(page.content)) {
          if (Math.abs(circle.r / PT_PER_MM - pinR) > 1e-6) continue; // the pin circle itself is far larger
          // page points (y up) -> page mm (y down) -> drawing mm
          const px = circle.x / PT_PER_MM, py = (page.height - circle.y) / PT_PER_MM;
          const x = px - ox, y = py - oy;
          // nothing is drawn on a page that it cannot show
          expect(px).toBeGreaterThan(plan.contentX - pinR - 1);
          expect(px).toBeLessThan(plan.contentX + plan.contentW + pinR + 1);
          expect(py).toBeGreaterThan(plan.contentY - pinR - 1);
          expect(py).toBeLessThan(plan.contentY + plan.contentH + pinR + 1);
          const i = want.findIndex(([wx, wy]) => Math.hypot(wx - x, wy - y) < 0.01);
          expect(i, `a pin circle at ${x.toFixed(2)}, ${y.toFixed(2)} on page ${k + 1}`).toBeGreaterThanOrEqual(0);
          // counted only where its centre is inside the page's drawing area: there it is certainly whole enough to nail
          if (px >= plan.contentX && px <= plan.contentX + plan.contentW && py >= plan.contentY && py <= plan.contentY + plan.contentH) seen.add(i);
        }
      });
      expect(seen.size, `${frame.diameterMm} mm, ${frame.pins} pins on ${paper}`).toBe(frame.pins);
    }
  });

  it("is byte-for-byte reproducible", async () => {
    const p = project(500, 256, "A4");
    const a = await build(p, "template-pdf"), b = await build(p, "template-pdf");
    expect(a.bytes).toEqual(b.bytes);
  });

  it("fits a small frame on one A3 page, without marks for joining", async () => {
    const p = project(240, 128, "A3");
    const plan = templatePlan(p.frame, "A3");
    expect(plan.tiles).toHaveLength(1);
    expect(stripMarks(plan, 280, 280, templateDrawing(p.frame).prims)).toEqual([]);
    const file = await build(p, "template-pdf", "en");
    keep("template-240-A3.pdf", file.bytes);
    const pages = await pageContents(file.bytes);
    expect(pages).toHaveLength(1);
    expect(circles(pages[0]!.content).filter((c) => Math.abs(c.r - pt(0.75)) < 1e-6)).toHaveLength(128);
    expect(bandTexts(p.frame, plan, 0, "en")).toEqual({ title: "Nail template · 240 mm · 128 pins", page: "Page 1 of 1", note: "Print at 100 % (actual size): the bar must measure 100 mm." });
  });

  it("works on every paper, with the 5 mm printer margin and the 10 mm overlap", () => {
    expect([PRINTER_MARGIN, OVERLAP]).toEqual([5, 10]);
    for (const paper of PAPERS) {
      for (const frame of FRAMES) {
        const plan = templatePlan(frame, paper), S = frame.diameterMm + 40;
        expect(plan.contentX).toBe(5);
        expect(plan.contentW).toBeCloseTo(plan.pageW - 10, 9);
        expect(plan.contentH).toBeCloseTo(plan.pageH - 10 - BAND, 9);
        // the tiles cover the board, and neighbours share at least the overlap
        for (const tile of plan.tiles) {
          const right = plan.tiles.find((t) => t.row === tile.row && t.col === tile.col + 1);
          const below = plan.tiles.find((t) => t.col === tile.col && t.row === tile.row + 1);
          if (right) expect(tile.x + tile.w - right.x).toBeGreaterThanOrEqual(10 - 1e-9);
          else expect(tile.x + tile.w).toBeGreaterThanOrEqual(S - 1e-9);
          if (below) expect(tile.y + tile.h - below.y).toBeGreaterThanOrEqual(10 - 1e-9);
          else expect(tile.y + tile.h).toBeGreaterThanOrEqual(S - 1e-9);
        }
      }
    }
  });

  /** Every paper with every frame: the page plan, and the crosses by the plain rule and placed around the drawing. */
  const layouts = () =>
    PAPERS.flatMap((paper) =>
      FRAMES.map((frame) => {
        const plan = templatePlan(frame, paper), S = frame.diameterMm + 40, drawing = templateDrawing(frame);
        return { paper, frame, plan, S, drawing, plain: stripMarks(plan, S, S), placed: stripMarks(plan, S, S, drawing.prims) };
      }),
    );
  const glyphs = fontkit.create(FONT) as unknown as GlyphFont;
  /** The box of a primitive, a text by the real width of its glyphs and the height of its capitals. */
  const tight = (p: Prim): [number, number, number, number] => {
    if (p.t !== "text") return primBox(p);
    const w = textWidth(glyphs, p.text, p.size), x = p.at[0] - (p.align === "center" ? w / 2 : p.align === "right" ? w : 0);
    return [x, p.at[1] - 0.75 * p.size, x + w, p.at[1]];
  };

  it("puts a cross at both ends of every strip two pages share", () => {
    for (const { paper, frame, plan, S, plain, placed } of layouts()) {
      expect(placed.map((m) => [m.at, m.cols, m.rows])).toEqual(plain.map((m) => [m.at, m.cols, m.rows]));
      for (const marks of [plain, placed]) {
        const inside = (t: { x: number; y: number; w: number; h: number }, m: { x: number; y: number }) => m.x > t.x + 2.5 && m.x < t.x + t.w - 2.5 && m.y > t.y + 2.5 && m.y < t.y + t.h - 2.5;
        for (const a of plan.tiles) {
          for (const b of plan.tiles) {
            const sideBySide = b.row === a.row && b.col === a.col + 1, stacked = b.col === a.col && b.row === a.row + 1;
            if (!sideBySide && !stacked) continue;
            // the crosses of this pair's strip that both pages print whole
            const shared = marks.filter((m) => inside(a, m) && inside(b, m) && (sideBySide ? m.cols === `C${a.col + 1}|C${b.col + 1}` : m.rows === `R${a.row + 1}|R${b.row + 1}`));
            expect(shared.length, `${paper}, ${frame.diameterMm} mm`).toBeGreaterThanOrEqual(2);
            // one near each end of the stretch they share, well apart
            const along = shared.map((m) => (sideBySide ? m.y : m.x)).sort((u, v) => u - v);
            const from = Math.max(sideBySide ? a.y : a.x, 0), to = Math.min(sideBySide ? a.y + a.h : a.x + a.w, S);
            const reach = (sideBySide ? plan.contentH : plan.contentW) / 2;
            expect(along[0]! - from).toBeLessThan(reach);
            expect(to - along[along.length - 1]!).toBeLessThan(reach);
            expect(along[along.length - 1]! - along[0]!).toBeGreaterThan(50);
          }
        }
        // no two crosses close enough to be confused
        for (const m of marks) for (const o of marks) if (m !== o) expect(Math.hypot(m.x - o.x, m.y - o.y)).toBeGreaterThan(8);
      }
      // by the plain rule a cross is on the centre line of its strip: 4 mm inside the board's edge, or where two strips cross
      for (const m of plain) {
        if (m.at === "top") expect(m.y).toBe(4);
        if (m.at === "bottom") expect(m.y).toBe(S - 4);
        if (m.at === "left") expect(m.x).toBe(4);
        if (m.at === "right") expect(m.x).toBe(S - 4);
      }
    }
  });

  it("labels each cross where every page that prints the cross prints the label whole", () => {
    for (const { paper, plan, S, plain, placed } of layouts()) {
      for (const m of [...plain, ...placed]) {
        const pages = plan.tiles.filter((t) => m.x > t.x && m.x < t.x + t.w && m.y > t.y && m.y < t.y + t.h);
        expect(pages.length).toBeGreaterThanOrEqual(m.at === "corner" ? 4 : 2);
        const prims = markPrims([m]);
        expect(prims.filter((p) => p.t === "text").map((p) => (p.t === "text" ? p.text : ""))).toEqual(m.at === "corner" ? [m.cols, m.rows] : [m.cols ?? m.rows]);
        for (const p of prims) {
          const [x0, y0, x1, y1] = tight(p);
          for (const t of pages) {
            expect(x0, `${m.at} ${m.cols ?? ""} ${m.rows ?? ""} on ${paper}`).toBeGreaterThanOrEqual(Math.max(t.x, 0));
            expect(x1).toBeLessThanOrEqual(Math.min(t.x + t.w, S));
            expect(y0).toBeGreaterThanOrEqual(Math.max(t.y, 0));
            expect(y1).toBeLessThanOrEqual(Math.min(t.y + t.h, S));
          }
        }
      }
    }
  });

  it("moves a cross off the numbers, ticks and pins it would cover", () => {
    /** Whether a box overlaps a primitive of the drawing: a circle as the ring it is, the board by its edge. */
    const covers = (p: Prim, [x0, y0, x1, y1]: [number, number, number, number], S: number): boolean => {
      if (p.t === "circle") {
        const nearest = Math.hypot(Math.max(x0 - p.c[0], 0, p.c[0] - x1), Math.max(y0 - p.c[1], 0, p.c[1] - y1));
        const farthest = Math.hypot(Math.max(Math.abs(x0 - p.c[0]), Math.abs(x1 - p.c[0])), Math.max(Math.abs(y0 - p.c[1]), Math.abs(y1 - p.c[1])));
        return nearest <= p.r + 0.1 && farthest >= p.r - 0.1;
      }
      if (p.t === "poly" && !p.fill) return x0 <= 0.2 || y0 <= 0.2 || x1 >= S - 0.2 || y1 >= S - 0.2;
      const [a0, b0, a1, b1] = tight(p);
      return a1 >= x0 && a0 <= x1 && b1 >= y0 && b0 <= y1;
    };
    const covered = (m: StripMark, drawing: readonly Prim[], S: number) => markPrims([m]).some((part) => drawing.some((p) => covers(p, tight(part), S)));
    let moved = 0, stuck = 0, corners = 0;
    for (const { paper, frame, plan, S, drawing, plain, placed } of layouts()) {
      placed.forEach((m, i) => {
        const was = plain[i]!, where = `${m.at} ${m.cols ?? ""} ${m.rows ?? ""}: ${frame.diameterMm} mm, ${frame.pins} pins on ${paper}`;
        if (m.x !== was.x || m.y !== was.y) moved++;
        if (m.at === "corner") {
          corners++;
          // Anywhere in the patch its four pages share; where the patch is the least overlap, 10 mm square, it
          // has one place only and stays there whatever is under it.
          expect(Math.hypot(m.x - was.x, m.y - was.y), where).toBeLessThanOrEqual(60 * Math.SQRT2);
          const col = Number.parseInt(m.cols!.slice(1), 10) - 1, row = Number.parseInt(m.rows!.slice(1), 10) - 1; // "C1|C2", "R1|R2"
          const left = plan.tiles[row * plan.cols + col]!, right = plan.tiles[row * plan.cols + col + 1]!, below = plan.tiles[(row + 1) * plan.cols + col]!;
          const room = left.x + left.w - right.x > 10 + 1e-6 || left.y + left.h - below.y > 10 + 1e-6;
          if (covered(m, drawing.prims, S)) {
            stuck++;
            expect(room, where).toBe(false);
            expect([m.x, m.y]).toEqual([was.x, was.y]);
          }
        } else {
          // further in along its own strip, never sideways, and clear of everything
          if (m.at === "top" || m.at === "bottom") expect(m.x).toBe(was.x);
          else expect(m.y).toBe(was.y);
          expect(Math.abs(m.x - was.x) + Math.abs(m.y - was.y), where).toBeLessThanOrEqual(60);
          expect(covered(m, drawing.prims, S), where).toBe(false);
        }
      });
    }
    expect(moved).toBeGreaterThan(0);
    expect(stuck).toBeLessThan(corners / 4);

    // Two columns of pages: the strip between them is the board's vertical centre line, through pin 1 and the centre.
    const frame = FRAMES[1]!, plan = templatePlan(frame, "A4"), S = 340, c = S / 2, r = 150;
    expect([plan.cols, plan.rows]).toEqual([2, 2]);
    const plain = stripMarks(plan, S, S), placed = stripMarks(plan, S, S, templateDrawing(frame).prims);
    expect(plain.find((m) => m.at === "top")).toMatchObject({ x: c, y: 4 }); // on the "1"
    expect(plain.find((m) => m.at === "corner")).toMatchObject({ x: c, y: c }); // on the centre mark
    const top = placed.find((m) => m.at === "top")!, corner = placed.find((m) => m.at === "corner")!;
    expect(top.x).toBe(c);
    expect(c - top.y).toBeLessThan(r - 3); // it went down past pin 1, to just inside the circle
    expect(c - top.y).toBeGreaterThan(r - 20);
    expect(Math.hypot(corner.x - c, corner.y - c)).toBeGreaterThan(5);
    expect(Math.hypot(corner.x - c, corner.y - c)).toBeLessThan(20);
  });

  it("keeps the words of the strip on the page in both languages", () => {
    const font = fontkit.create(FONT) as unknown as GlyphFont;
    const measure = (s: string, size: number) => textWidth(font, s, size);
    for (const paper of PAPERS) {
      for (const frame of [FRAMES[0]!, FRAMES[3]!]) {
        const plan = templatePlan(frame, paper), last = plan.tiles.length - 1;
        for (const lang of ["zh-TW", "en"] as const) {
          const texts = bandTexts(frame, plan, last, lang);
          const prims = bandPrims(plan, texts, measure);
          const words = prims.filter((p) => p.t === "text");
          expect(words.map((p) => (p.t === "text" ? p.text : ""))).toEqual(["100 mm", texts.title, texts.page, texts.note]);
          for (const p of words) {
            if (p.t !== "text") throw new Error();
            expect(p.at[0] + measure(p.text, p.size), p.text).toBeLessThanOrEqual(plan.contentX + plan.contentW + 1e-6);
            expect(p.size, p.text).toBeGreaterThan(1.8); // still readable: about 5 pt
            expect(p.at[1]).toBeGreaterThan(plan.contentY + plan.contentH);
            expect(p.at[1]).toBeLessThan(plan.pageH - PRINTER_MARGIN);
          }
        }
      }
    }
    const plan = templatePlan(FRAMES[0]!, "A4");
    expect(bandTexts(FRAMES[0]!, plan, 4, "en").page).toBe("Page 5 of 6 · row 2, column 2");
    expect(bandTexts(FRAMES[0]!, plan, 4, "en").note).toContain("crosses");
  });
});

describe("the template SVG (§7.2)", () => {
  it("is in millimetres, with one <circle> per pin in a group of its own", async () => {
    for (const frame of [FRAMES[0]!, FRAMES[1]!, FRAMES[5]!]) {
      const p = defaultProject();
      p.frame = frame;
      const file = await buildFile(null, { project: p, lang: "en", stem: "test" }, "template-svg");
      expect(file.name).toBe("test-template.svg");
      expect(file.mime).toBe("image/svg+xml");
      const svg = text(file.bytes), S = frame.diameterMm + 40;
      keep(`template-${frame.diameterMm}.svg`, file.bytes);
      expect(svg).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<svg xmlns="http:\/\/www.w3.org\/2000\/svg" /);
      expect(svg).toContain(`width="${S}mm" height="${S}mm" viewBox="0 0 ${S} ${S}"`);
      expect(svg).toContain(`<title>Nail template · ${frame.diameterMm} mm · ${frame.pins} pins</title>`);
      expect([...svg.matchAll(/<g id="([^"]+)">/g)].map((m) => m[1])).toEqual(["board", "frame", "marks", "pins"]);
      const group = svg.match(/<g id="pins">\n([\s\S]*?)\n<\/g>/)![1]!.split("\n");
      expect(group).toHaveLength(frame.pins);
      const want = analytic(frame);
      group.forEach((line, i) => {
        const m = line.match(/^<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="none" stroke="#1c1d1f" stroke-width="0.2" stroke-linejoin="round"\/>$/);
        expect(m, line).not.toBeNull();
        expect(Math.abs(Number(m![1]) - want[i]![0])).toBeLessThan(0.00051); // written to a micrometre
        expect(Math.abs(Number(m![2]) - want[i]![1])).toBeLessThan(0.00051);
        expect(Number(m![3])).toBe(frame.pinDiameterMm / 2);
      });
      // the only other circle is the pin circle; no page-sized rectangle for a cutter to trip over
      expect(svg.match(/<circle /g)).toHaveLength(frame.pins + 1);
      expect(svg).not.toContain("<rect");
    }
  });
});

/** A tiny DXF reader: the group-code/value pairs of the ENTITIES section, as one record per entity. */
function dxfEntities(dxf: string): { type: string; layer: string; codes: Map<number, number[]> }[] {
  const lines = dxf.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i]!.trim()), lines[i + 1]!.trim()]);
  const start = pairs.findIndex(([code, value], i) => code === 2 && value === "ENTITIES" && pairs[i - 1]?.[1] === "SECTION");
  const out: { type: string; layer: string; codes: Map<number, number[]> }[] = [];
  for (let i = start + 1; i < pairs.length; i++) {
    const [code, value] = pairs[i]!;
    if (code === 0) {
      if (value === "ENDSEC") break;
      out.push({ type: value, layer: "", codes: new Map() });
    } else if (code === 8) out[out.length - 1]!.layer = value;
    else {
      const codes = out[out.length - 1]!.codes;
      codes.set(code, [...(codes.get(code) ?? []), Number(value)]);
    }
  }
  return out;
}

describe("the template DXF (§7.2)", () => {
  it("has one CIRCLE per pin on layer PINS, in millimetres with y up", async () => {
    for (const frame of FRAMES) {
      const p = defaultProject();
      p.frame = frame;
      const file = await buildFile(null, { project: p, lang: "en", stem: "test" }, "template-dxf");
      expect(file.name).toBe("test-template.dxf");
      const dxf = text(file.bytes), S = frame.diameterMm + 40, c = S / 2, r = frame.diameterMm / 2;
      keep(`template-${frame.diameterMm}.dxf`, file.bytes);
      expect(dxf).toMatch(/^0\r\nSECTION\r\n2\r\nHEADER\r\n9\r\n\$ACADVER\r\n1\r\nAC1009\r\n9\r\n\$INSUNITS\r\n70\r\n4\r\n/);
      expect(dxf.endsWith("0\r\nENDSEC\r\n0\r\nEOF\r\n")).toBe(true);
      expect(dxf.split("\r\n").length % 2).toBe(1); // pairs of lines, and the final line break
      const entities = dxfEntities(dxf);
      const pins = entities.filter((e) => e.type === "CIRCLE" && e.layer === "PINS");
      expect(pins).toHaveLength(frame.pins);
      pins.forEach((e, i) => {
        const turn = (2 * Math.PI * i) / frame.pins;
        expect(e.codes.get(10)![0]).toBeCloseTo(c + r * Math.sin(turn), 4);
        expect(e.codes.get(20)![0]).toBeCloseTo(c + r * Math.cos(turn), 4); // y up: pin 1 has the largest y
        expect(e.codes.get(40)![0]).toBeCloseTo(frame.pinDiameterMm / 2, 4);
      });
      expect(pins[0]!.codes.get(20)![0]).toBeCloseTo(S - 20, 4);
      expect(pins[1]!.codes.get(10)![0]).toBeGreaterThan(c); // clockwise, seen from the front
      // the pin circle, the centre cross and the board
      const ring = entities.filter((e) => e.layer === "FRAME");
      expect(ring).toHaveLength(1);
      expect([ring[0]!.type, ring[0]!.codes.get(10)![0], ring[0]!.codes.get(20)![0], ring[0]!.codes.get(40)![0]]).toEqual(["CIRCLE", c, c, r]);
      const cross = entities.filter((e) => e.layer === "MARKS");
      expect(cross.map((e) => e.type)).toEqual(["LINE", "LINE"]);
      for (const e of cross) {
        expect((e.codes.get(10)![0]! + e.codes.get(11)![0]!) / 2).toBeCloseTo(c, 4);
        expect((e.codes.get(20)![0]! + e.codes.get(21)![0]!) / 2).toBeCloseTo(c, 4);
      }
      const board = entities.filter((e) => e.layer === "BOARD");
      expect(board.map((e) => e.type)).toEqual(["POLYLINE", "VERTEX", "VERTEX", "VERTEX", "VERTEX", "SEQEND"]);
      expect(board[0]!.codes.get(70)).toEqual([1]); // closed
      expect(board.slice(1, 5).map((e) => [e.codes.get(10)![0], e.codes.get(20)![0]])).toEqual([[0, 0], [S, 0], [S, S], [0, S]]);
      expect(entities.every((e) => e.layer in { BOARD: 1, FRAME: 1, MARKS: 1, PINS: 1 })).toBe(true);
      // every layer the entities use is declared
      for (const layer of ["BOARD", "FRAME", "MARKS", "PINS"]) expect(dxf).toContain(`0\r\nLAYER\r\n2\r\n${layer}\r\n70\r\n0\r\n62\r\n`);
    }
  });
});
