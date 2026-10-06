// A rectangular frame (DECISIONS D-58) through everything that is stored or leaves the app: the project file
// and its keys, the winding instructions, the nail template and the three files made of it. What the round
// frame gives is pinned in circleGoldens.test.ts; this is its counterpart.
import { describe, expect, it } from "vitest";
import { allowedPairs, framePins, frameThreadMm, pinPlace, rectPinsMm, sideCounts } from "../../src/core/frame.ts";
import {
  boardSizeMm, instructionsCsv, instructionsTxt, materials, pinCode, pinHint, sheetTexts, templateTitle, THREAD_MARGIN, threadPlans,
} from "../../src/core/instructions.ts";
import { defaultProject, frameSpec, generationKey, maxMinSkip, normalizeProject, serializeProject, targetKey, toOptions, type Frame, type Paper } from "../../src/core/project.ts";
import { hexToLinear } from "../../src/core/stringart.ts";
import { buildFile } from "../../src/export/build.ts";
import { templateDxf } from "../../src/export/dxf.ts";
import { linesSvg, templateSvg } from "../../src/export/svg.ts";
import { bandTexts, OVERLAP, PRINTER_MARGIN, stripMarks, templatePlan, tileOrigin } from "../../src/export/templatePdf.ts";
import { planTiles, PT_PER_MM } from "../../src/export/tiles.ts";
import { primBox, type Prim } from "../../src/render/prims.ts";
import { boardSize, templateDrawing, templateLayers, templatePins } from "../../src/render/template.ts";
import { circles, fontBytes, keep, pageContents, rectProject } from "../helpers/pdf.ts";

const FONT = fontBytes();
const rect = (diameterMm: number, pins: number, aspect: number, pinDiameterMm = 1.5): Frame => ({ shape: "rect", diameterMm, pins, pinDiameterMm, aspect });
/** A portrait frame of 375 x 500 mm with the default pins, a wide one, a square one, and the two longest shapes. */
const FRAMES: Frame[] = [rect(500, 256, 0.75), rect(400, 200, 16 / 9, 2), rect(300, 128, 1), rect(1000, 512, 0.25, 5), rect(200, 64, 4, 0.5), rect(437.5, 97, 0.618, 1.2)];

/** A project file as text would hold it: the default project with another frame and picture. */
const stored = (frame: Record<string, unknown>, image: Record<string, unknown> = {}, generator: Record<string, unknown> = {}): unknown => {
  const base = JSON.parse(serializeProject(defaultProject())) as Record<string, Record<string, unknown>>;
  return {
    ...base,
    frame: { ...base.frame, shape: "rect", ...frame },
    image: { ...base.image, name: "picture.png", sha256: "ab".repeat(32), sample: null, width: 658, height: 873, ...image },
    generator: { ...base.generator, ...generator },
  };
};

describe("a project with a rectangular frame", () => {
  it("takes the frame's proportions from the picture, whatever the file says", () => {
    const upright = normalizeProject(stored({ aspect: 3 }));
    expect(upright.project.frame).toEqual({ shape: "rect", diameterMm: 500, pins: 256, pinDiameterMm: 1.5, aspect: 658 / 873 });
    expect(upright.issues).toEqual([]);
    // turned a quarter, the frame turns with the picture; turned a little, it does not
    const turned = (rotateDeg: number) => normalizeProject(stored({}, { crop: { cx: 0.5, cy: 0.5, scale: 1, rotateDeg } })).project.frame;
    expect(turned(90)).toMatchObject({ shape: "rect", aspect: 873 / 658 });
    expect(turned(-90)).toMatchObject({ aspect: 873 / 658 });
    expect(turned(10)).toMatchObject({ aspect: 658 / 873 });
    expect(turned(180)).toMatchObject({ aspect: 658 / 873 });
    // a built-in sample is square, a picture as long as a ribbon is cut to 1:4, and only an unknown size leaves the file's value
    expect(normalizeProject(stored({ aspect: 2 }, { sample: "face" })).project.frame).toMatchObject({ shape: "rect", aspect: 1 });
    expect(normalizeProject(stored({}, { width: 100, height: 5000 })).project.frame).toMatchObject({ aspect: 0.25 });
    expect(normalizeProject(stored({ aspect: 2 }, { width: 0, height: 0 })).project.frame).toMatchObject({ aspect: 2 });
    expect(normalizeProject(stored({ aspect: 99 }, { width: 0, height: 0 })).project.frame).toMatchObject({ aspect: 4 });
    expect(normalizeProject(stored({}, { width: 0, height: 0 })).project.frame).toMatchObject({ aspect: 1 });
  });

  it("leaves a round frame as it was, and still reads an unknown shape as a circle, saying so", () => {
    const round = normalizeProject(JSON.parse(serializeProject(defaultProject())));
    expect(round.project.frame).toEqual({ shape: "circle", diameterMm: 500, pins: 256, pinDiameterMm: 1.5 });
    expect("aspect" in round.project.frame).toBe(false);
    const odd = normalizeProject(stored({ shape: "hexagon", aspect: 2 }));
    expect(odd.project.frame).toEqual({ shape: "circle", diameterMm: 500, pins: 256, pinDiameterMm: 1.5 });
    expect(odd.issues).toContain("frame-shape");
  });

  it("is written out with its shape and proportions, and read back to the same project and the same text", () => {
    const p = rectProject([60]), text = serializeProject(p);
    expect(text).toContain('"frame": {\n    "shape": "rect",\n    "diameterMm": 500,\n    "pins": 256,\n    "pinDiameterMm": 1.5,\n    "aspect": 0.75\n  }');
    const back = normalizeProject(JSON.parse(text));
    expect(back.issues).toEqual([]);
    expect(back.project).toEqual(p);
    expect(back.project.result?.key).toBe(generationKey(p));
    expect(serializeProject(back.project)).toBe(text);
    // a picture whose proportions are no round number: six decimals in the file, the exact value once read
    const odd = rectProject([10], 658, 873), again = normalizeProject(JSON.parse(serializeProject(odd)));
    expect(serializeProject(odd)).toContain('"aspect": 0.753723');
    expect(again.project.frame).toEqual(odd.frame);
    expect(again.project.result?.sequences).toEqual(odd.result!.sequences);
  });

  it("has keys and options of its own; those of a round project hold nothing about the frame's shape", () => {
    const p = rectProject([10]), round = { ...p, frame: { shape: "circle" as const, diameterMm: 500, pins: 256, pinDiameterMm: 1.5 } };
    expect(targetKey(p)).not.toBe(targetKey(round));
    expect(generationKey(p)).not.toBe(generationKey(round));
    expect(targetKey(p)).toContain('"frame":{"aspect":0.75,"shape":"rect"}');
    expect(targetKey(round)).not.toContain("frame");
    expect(targetKey({ ...p, frame: { shape: "rect", diameterMm: 500, pins: 256, pinDiameterMm: 1.5, aspect: 0.8 } })).not.toBe(targetKey(p));
    expect(toOptions(p)).toEqual({
      res: 400, pins: 256, diameterMm: 500, threadWidthMm: 0.25, board: [1, 1, 1], threads: [hexToLinear("#111111")], maxLines: [4000], minSkip: 20, allowRepeat: false,
      shape: "rect", aspect: 0.75,
    });
    expect(Object.keys(toOptions(round))).toHaveLength(9);
    expect(frameSpec(round.frame)).toEqual({});
  });

  it("allows a minimum skip of a quarter of the pins at most", () => {
    expect([maxMinSkip(256, "rect"), maxMinSkip(256), maxMinSkip(256, "circle"), maxMinSkip(65, "rect")]).toEqual([64, 127, 127, 16]);
    const high = normalizeProject(stored({}, {}, { minSkip: 100 }));
    expect(high.project.generator.minSkip).toBe(64);
    expect(high.issues).toContain("min-skip");
    expect(normalizeProject(stored({}, {}, { minSkip: 64 })).issues).toEqual([]);
  });

  it("keeps a stored result only if the frame allows every one of its lines", () => {
    const p = rectProject([40]), ok = allowedPairs({ pins: 256, minSkip: 20, ...frameSpec(p.frame) });
    const withSequence = (sequence: number[]) => normalizeProject({ ...JSON.parse(serializeProject(p)), result: { ...p.result!, sequences: [sequence] } });
    // two pins of the top side, 30 apart: far enough round a circle, but one side of a rectangle
    expect(ok[0 * 256 + 30]).toBe(0);
    expect(withSequence([0, 30]).project.result).toBeNull();
    expect(withSequence([0, 30]).issues).toContain("result");
    // from the top left to the bottom right: allowed
    expect(ok[0 * 256 + 130]).toBe(1);
    expect(withSequence([0, 130]).project.result?.sequences).toEqual([[0, 130]]);
    // the same two pins on a round frame of the same project
    const round = normalizeProject({ ...JSON.parse(serializeProject(p)), frame: { shape: "circle", diameterMm: 500, pins: 256, pinDiameterMm: 1.5 }, result: { ...p.result!, sequences: [[0, 30]] } });
    expect(round.project.result?.sequences).toEqual([[0, 30]]);
  });
});

describe("the winding instructions for a rectangular frame", () => {
  const p = rectProject([300], 600, 800, undefined, 4), frame = p.frame; // 375 x 500 mm: 55, 73, 55 and 73 pins

  it("say where a pin is by its side and its number along it", () => {
    expect(sideCounts(256, 0.75)).toEqual([55, 73, 55, 73]);
    expect([0, 54, 55, 128, 183, 255].map((pin) => pinHint(frame, pin, "en"))).toEqual(["top 1", "top 55", "right 1", "bottom 1", "left 1", "left 73"]);
    expect([0, 55, 128, 183].map((pin) => pinHint(frame, pin, "zh-TW"))).toEqual(["上1", "右1", "下1", "左1"]);
    expect([0, 54, 55, 128, 183, 255].map((pin) => pinCode(frame, pin))).toEqual(["T1", "T55", "R1", "B1", "L1", "L73"]);
    // a round frame still goes by the clock
    const round = defaultProject().frame;
    expect([pinHint(round, 136, "en"), pinHint(round, 136, "zh-TW"), pinCode(round, 136)]).toEqual(["6:25", "6:25", "6:25"]);
  });

  it("print the frame's two sides, the board, and how the pins are numbered", () => {
    const s = sheetTexts(p, "en"), first = p.result!.sequences[0]![0]!, last = p.result!.sequences[0]!.at(-1)!;
    expect(s.subtitle).toBe("Frame 375 × 500 mm · 256 pins · threads: 1 · lines: 300");
    expect(s.how).toContain("pin 1 next to the top left corner");
    expect(s.how).not.toContain("o'clock");
    expect(s.notes[1]).toBe("Board: at least 415 × 540 mm, which is the 375 × 500 mm frame plus 20 mm all round.");
    expect(s.sections[0]!.facts).toContain(`Start: pin ${first + 1} (${pinHint(frame, first, "en")}) · End: pin ${last + 1} (${pinHint(frame, last, "en")})`);
    expect(s.sections[0]!.rows).toHaveLength(31);
    s.sections[0]!.rows.forEach((row, i) => expect(row.clock).toBe(pinHint(frame, p.result!.sequences[0]![10 * i]!, "en")));
    const zh = sheetTexts(p, "zh-TW");
    expect(zh.subtitle).toBe("長方框 375 × 500 mm · 256 釘 · 線：1 種 · 線數：300 條");
    expect(zh.notes[1]).toBe("板子：至少 415 × 540 mm，也就是 375 × 500 mm 的框加上四周各 20 mm。");
    expect([boardSizeMm(frame), materials(p).boardMm]).toEqual([{ width: 415, height: 540 }, 540]);
    expect([templateTitle(frame, "en"), templateTitle(frame, "zh-TW")]).toEqual(["Nail template · 375 × 500 mm · 256 pins", "釘位模板 · 375 × 500 mm · 256 釘"]);
    expect(templateTitle(defaultProject().frame, "en")).toBe("Nail template · 500 mm · 256 pins");
  });

  it("write the side into the CSV and at the end of every row of the text", () => {
    const csv = instructionsCsv(p).split("\r\n"), sequence = p.result!.sequences[0]!;
    expect(csv[0]).toBe("thread,name,hex,step,pin,side");
    expect(csv).toHaveLength(303); // the header, 301 pins, and the empty piece after the last line end
    sequence.forEach((pin, i) => expect(csv[i + 1]).toBe(`1,black,#111111,${i + 1},${pin + 1},${pinCode(frame, pin)}`));
    expect(csv[1]).toMatch(/^1,black,#111111,1,\d+,[TRBL]\d+$/);
    const rows = instructionsTxt(p, "zh-TW").split("\r\n").filter((line) => line.startsWith("[ ]"));
    expect(rows).toHaveLength(31);
    for (const row of rows) expect(row).toMatch(/ {3}[上右下左]\d+$/);
    for (const row of instructionsTxt(p, "en").split("\r\n").filter((line) => line.startsWith("[ ]"))) expect(row).toMatch(/ {3}(top|right|bottom|left) \d+$/);
  });

  it("measure the thread along straight lines between the pins, with the margin on top", () => {
    const short = rectProject([1], 600, 800, undefined, 9), [a, b] = short.result!.sequences[0]! as [number, number], mm = rectPinsMm(short.frame).at;
    const line = Math.hypot(mm[2 * b]! - mm[2 * a]!, mm[2 * b + 1]! - mm[2 * a + 1]!);
    expect(threadPlans(short)[0]!.lengthMm).toBeCloseTo((line + (Math.PI * 1.5) / 2) * (1 + THREAD_MARGIN), 9);
    expect(threadPlans(p)[0]!.lengthMm).toBe(frameThreadMm(toOptions(p), p.result!.sequences[0]!, 1.5) * (1 + THREAD_MARGIN));
    // a line of a 375 x 500 mm frame is never longer than its diagonal
    expect(threadPlans(p)[0]!.lengthMm / 300).toBeLessThan(625 * 1.05 + 3);
  });
});

describe("the nail template of a rectangular frame", () => {
  it("has its pins where the generator has them, pin 1 next to the top left corner, clockwise", () => {
    for (const frame of FRAMES) {
      const pins = templatePins(frame), { at, side } = rectPinsMm(frame), { width, height } = boardSize(frame);
      expect(pins).toHaveLength(frame.pins);
      pins.forEach(([x, y], i) => { expect(x).toBe(20 + at[2 * i]!); expect(y).toBe(20 + at[2 * i + 1]!); });
      // the working grid of the generator, scaled to millimetres, is the same rectangle
      const res = 400, P = framePins({ pins: frame.pins, res, ...frameSpec(frame) }), mm = frame.diameterMm / (res - 1), off = { x: (frame.diameterMm - (width - 40)) / 2, y: (frame.diameterMm - (height - 40)) / 2 };
      pins.forEach(([x, y], i) => {
        expect(x).toBeCloseTo(20 + P[2 * i]! * mm - off.x, 9);
        expect(y).toBeCloseTo(20 + P[2 * i + 1]! * mm - off.y, 9);
      });
      // pin 1 is on the top side, nearer the left corner than any other; pin 2 is to its right
      expect(side[0]).toBe(0);
      expect(pins[0]![1]).toBe(20);
      expect(pins[1]![0]).toBeGreaterThan(pins[0]![0]);
      expect(pins[0]![0] - 20).toBeCloseTo((width - 40) / sideCounts(frame.pins, frameSpec(frame).aspect!)[0] / 2, 9);
      // the last pin is on the left side, next to the same corner
      expect(pinPlace(frame, frame.pins - 1)).toMatchObject({ side: "left" });
      expect(pins[frame.pins - 1]![0]).toBe(20);
    }
  });

  it("is the board: the frame and 20 mm all round", () => {
    for (const frame of FRAMES) {
      const d = templateDrawing(frame), L = templateLayers(frame), { width, height } = boardSizeMm(frame);
      expect([d.width, d.height]).toEqual([width, height]);
      expect(Math.max(width, height)).toBe(frame.diameterMm + 40);
      expect(L.board).toEqual([{ t: "poly", pts: [[0, 0], [width, 0], [width, height], [0, height]], stroke: "#1c1d1f", width: 0.4 }]);
      expect(L.frame).toEqual([{ t: "poly", pts: [[20, 20], [width - 20, 20], [width - 20, height - 20], [20, height - 20]], stroke: "#1c1d1f", width: 0.15 }]);
      expect(d.prims).toEqual([...L.board, ...L.frame, ...L.marks, ...L.pins]);
    }
  });

  it("draws a circle per pin with a hair across the frame's line, a tick and a number every 5 pins, and the centre", () => {
    for (const frame of FRAMES) {
      const L = templateLayers(frame), pins = templatePins(frame), { side } = rectPinsMm(frame), { width, height } = boardSizeMm(frame), pr = frame.pinDiameterMm / 2;
      expect(L.pins).toEqual(pins.map((c) => ({ t: "circle", c, r: pr, stroke: "#1c1d1f", width: 0.2 })));
      const lines = L.marks.filter((m): m is Extract<Prim, { t: "line" }> => m.t === "line");
      const hairs = lines.filter((m) => m.width === 0.15);
      expect(hairs).toHaveLength(frame.pins);
      hairs.forEach((hair, i) => {
        // through the pin, at right angles to its side
        expect((hair.a[0] + hair.b[0]) / 2).toBeCloseTo(pins[i]![0], 9);
        expect((hair.a[1] + hair.b[1]) / 2).toBeCloseTo(pins[i]![1], 9);
        const upright = side[i]! % 2 === 0;
        expect(Math.abs(hair.b[0] - hair.a[0])).toBeCloseTo(upright ? 0 : 2 * (pr + 0.9), 9);
        expect(Math.abs(hair.b[1] - hair.a[1])).toBeCloseTo(upright ? 2 * (pr + 0.9) : 0, 9);
      });
      const cross = lines.filter((m) => m.width === 0.25 && Math.abs((m.a[0] + m.b[0]) / 2 - width / 2) < 1e-9 && Math.abs((m.a[1] + m.b[1]) / 2 - height / 2) < 1e-9);
      expect(cross).toHaveLength(2);
      // the numbers: every multiple of 5, then the large 1
      const texts = L.marks.filter((m): m is Extract<Prim, { t: "text" }> => m.t === "text");
      expect(texts.map((m) => m.text)).toEqual([...Array.from({ length: Math.floor(frame.pins / 5) }, (_, k) => String(5 * (k + 1))), "1"]);
      expect(texts.at(-1)).toMatchObject({ size: 4, bold: true });
      for (const m of texts.slice(0, -1)) expect(m.bold).toBe(Number(m.text) % 10 === 0);
    }
  });

  it("keeps everything on the board, and every number and tick in the margin outside the frame", () => {
    for (const frame of FRAMES) {
      const L = templateLayers(frame), { width, height } = boardSizeMm(frame), pins = templatePins(frame), pr = frame.pinDiameterMm / 2;
      const inFrame = (x: number, y: number) => x > 20 && x < width - 20 && y > 20 && y < height - 20;
      for (const m of [...L.marks, ...L.pins]) {
        const [x0, y0, x1, y1] = primBox(m);
        expect(x0, `${frame.pins} pins: ${JSON.stringify(m).slice(0, 80)}`).toBeGreaterThanOrEqual(0);
        expect(y0).toBeGreaterThanOrEqual(0);
        expect(x1).toBeLessThanOrEqual(width);
        expect(y1).toBeLessThanOrEqual(height);
      }
      const numbers = L.marks.filter((m): m is Extract<Prim, { t: "text" }> => m.t === "text");
      for (const m of numbers) {
        // the number as it is printed: its width by the digits, its height above the base line
        const w = m.text.length * 0.555 * m.size, h = 0.733 * m.size, box = [m.at[0] - w / 2, m.at[1] - h, m.at[0] + w / 2, m.at[1]] as const;
        for (const [x, y] of [[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]] as const) expect(inFrame(x, y), `number ${m.text}`).toBe(false);
        // and clear of every pin
        for (const [px, py] of pins) {
          const dx = Math.max(box[0] - px, 0, px - box[2]), dy = Math.max(box[1] - py, 0, py - box[3]);
          expect(Math.hypot(dx, dy)).toBeGreaterThan(pr);
        }
      }
      const ticks = L.marks.filter((m): m is Extract<Prim, { t: "line" }> => m.t === "line" && (m.width === 0.6 || (m.width === 0.25 && !(Math.abs((m.a[0] + m.b[0]) / 2 - width / 2) < 1e-9))));
      expect(ticks).toHaveLength(Math.floor(frame.pins / 5) + 1); // and the leader of pin 1
      for (const tick of ticks) for (const [x, y] of [tick.a, tick.b]) expect(inFrame(x, y)).toBe(false);
      // pin 1's arrow runs to the right, along the top side: clockwise as seen from the front
      const shaft = L.marks.find((m): m is Extract<Prim, { t: "path" }> => m.t === "path")!, head = L.marks.find((m): m is Extract<Prim, { t: "poly" }> => m.t === "poly")!;
      const from = shaft.d[0] as { p: [number, number] }, to = shaft.d[1] as { p: [number, number] };
      expect(to.p[0] - from.p[0]).toBeCloseTo(16, 9);
      expect(to.p[1]).toBe(from.p[1]);
      expect(from.p[0]).toBeGreaterThan(pins[0]![0]);
      expect(Math.max(...head.pts.map((q) => q[0]))).toBeGreaterThan(to.p[0]);
      expect(from.p[1]).toBeLessThan(20);
    }
  });
});

describe("the files of a rectangular frame", () => {
  const build = (frame: Frame, paper: Paper, kind: Parameters<typeof buildFile>[2], lang: "zh-TW" | "en" = "en") => {
    const p = defaultProject();
    p.frame = frame;
    p.paper = paper;
    return buildFile(FONT, { project: p, lang, stem: "test" }, kind);
  };

  it("tile the board, which is not square, and show every pin on a page (0.01 mm)", async () => {
    // the 375 x 500 mm frame's board, 415 x 540 mm, takes 6 sheets of A4 or 4 of A3; the 200 x 50 mm frame's fits one A4 lying down
    for (const [frame, paper, pages] of [[FRAMES[0]!, "A4", 6], [FRAMES[0]!, "A3", 4], [FRAMES[1]!, "A4", -1], [FRAMES[2]!, "Letter", -1], [FRAMES[4]!, "A4", 1], [FRAMES[5]!, "A4", -1]] as const) {
      const { width, height } = boardSizeMm(frame), plan = templatePlan(frame, paper), want = templatePins(frame), pinR = frame.pinDiameterMm / 2;
      expect(plan).toEqual(planTiles(width, height, paper, PRINTER_MARGIN, OVERLAP));
      if (pages > 0) expect(plan.tiles.length, `${width} x ${height} mm on ${paper}`).toBe(pages);
      // the tiles cover the board both ways
      expect(Math.max(...plan.tiles.map((tile) => tile.x + tile.w))).toBeGreaterThanOrEqual(width - 1e-9);
      expect(Math.max(...plan.tiles.map((tile) => tile.y + tile.h))).toBeGreaterThanOrEqual(height - 1e-9);
      const file = await build(frame, paper, "template-pdf");
      keep(`template-rect-${Math.round(width)}x${Math.round(height)}-${paper}.pdf`, file.bytes);
      const got = await pageContents(file.bytes), seen = new Set<number>();
      expect(got).toHaveLength(plan.tiles.length);
      got.forEach((page, k) => {
        const tile = plan.tiles[k]!, [ox, oy] = tileOrigin(plan, tile);
        for (const circle of circles(page.content)) {
          if (Math.abs(circle.r / PT_PER_MM - pinR) > 1e-6) continue;
          const px = circle.x / PT_PER_MM, py = (page.height - circle.y) / PT_PER_MM, x = px - ox, y = py - oy;
          const i = want.findIndex(([wx, wy]) => Math.hypot(wx - x, wy - y) < 0.01);
          expect(i, `a pin circle at ${x.toFixed(2)}, ${y.toFixed(2)} on page ${k + 1}`).toBeGreaterThanOrEqual(0);
          if (px >= plan.contentX && px <= plan.contentX + plan.contentW && py >= plan.contentY && py <= plan.contentY + plan.contentH) seen.add(i);
        }
      });
      expect(seen.size, `${frame.pins} pins on ${paper}`).toBe(frame.pins);
      // where pages meet there are crosses to join them by, clear of the drawing
      if (plan.tiles.length > 1) expect(stripMarks(plan, width, height, templateDrawing(frame).prims).length).toBeGreaterThan(0);
    }
  });

  it("name the frame's two sides in the strip of every page, and are the same bytes every time", async () => {
    const frame = FRAMES[0]!, plan = templatePlan(frame, "A3");
    expect(bandTexts(frame, plan, 0, "en").title).toBe("Nail template · 375 × 500 mm · 256 pins");
    expect(bandTexts(frame, plan, 1, "zh-TW").title).toBe("釘位模板 · 375 × 500 mm · 256 釘");
    const a = await build(frame, "A3", "template-pdf", "zh-TW"), b = await build(frame, "A3", "template-pdf", "zh-TW");
    expect(a.bytes).toEqual(b.bytes);
  });

  it("the SVG is the board in millimetres, with the frame as a polygon and a circle per pin", () => {
    for (const frame of FRAMES) {
      const svg = templateSvg(frame, "a title"), { width, height } = boardSizeMm(frame), n = (v: number) => String(Number(v.toFixed(4)));
      expect(svg).toContain(`width="${n(width)}mm" height="${n(height)}mm" viewBox="0 0 ${n(width)} ${n(height)}"`);
      expect(svg.match(/<circle /g)).toHaveLength(frame.pins); // no pin circle round them
      expect(svg).toMatch(/<g id="frame">\n<polygon /);
      expect(svg).not.toContain("<rect");
      expect(svg.indexOf('id="board"')).toBeLessThan(svg.indexOf('id="frame"'));
      expect(svg.indexOf('id="marks"')).toBeLessThan(svg.indexOf('id="pins"'));
    }
  });

  it("the lines SVG has the board's size and runs every line between two of the template's pins", () => {
    const p = rectProject([80], 600, 800, undefined, 6), svg = linesSvg(p, "lines"), pins = templatePins(p.frame), sequence = p.result!.sequences[0]!;
    expect(svg).toContain('width="415mm" height="540mm" viewBox="0 0 415 540"');
    expect(svg).toContain('<rect width="415" height="540" fill="#FFFFFF"/>');
    const lines = [...svg.matchAll(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"\/>/g)].map((m) => m.slice(1).map(Number));
    expect(lines).toHaveLength(80);
    lines.forEach(([x1, y1, x2, y2], i) => {
      const a = pins[sequence[i]!]!, b = pins[sequence[i + 1]!]!;
      // the file gives three decimals of a millimetre
      expect(Math.abs(x1! - a[0]) + Math.abs(y1! - a[1]) + Math.abs(x2! - b[0]) + Math.abs(y2! - b[1])).toBeLessThan(2.1e-3);
    });
  });

  it("the DXF has the board and the frame as closed outlines, y up, and a circle per pin", () => {
    for (const frame of FRAMES) {
      const dxf = templateDxf(frame), { width, height } = boardSizeMm(frame), f = (v: number) => (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4);
      expect(dxf).toContain(`9\r\n$EXTMAX\r\n10\r\n${f(width)}\r\n20\r\n${f(height)}\r\n`);
      const outline = (layer: string, corners: [number, number][]) =>
        `0\r\nPOLYLINE\r\n8\r\n${layer}\r\n66\r\n1\r\n70\r\n1\r\n${corners.map(([x, y]) => `0\r\nVERTEX\r\n8\r\n${layer}\r\n10\r\n${f(x)}\r\n20\r\n${f(y)}\r\n`).join("")}0\r\nSEQEND\r\n8\r\n${layer}\r\n`;
      expect(dxf).toContain(outline("BOARD", [[0, 0], [width, 0], [width, height], [0, height]]));
      expect(dxf).toContain(outline("FRAME", [[20, 20], [width - 20, 20], [width - 20, height - 20], [20, height - 20]]));
      expect(dxf).not.toContain("CIRCLE\r\n8\r\nFRAME");
      expect(dxf.match(/0\r\nCIRCLE\r\n8\r\nPINS\r\n/g)).toHaveLength(frame.pins);
      // pin 1 is at the top: its y, measured up from the board's lower edge, is the board's height less the margin
      const [x, y] = templatePins(frame)[0]!;
      expect(dxf).toContain(`0\r\nCIRCLE\r\n8\r\nPINS\r\n10\r\n${f(x)}\r\n20\r\n${f(height - y)}\r\n40\r\n${f(frame.pinDiameterMm / 2)}\r\n`);
      expect(f(height - y)).toBe(f(height - 20));
    }
  });

  it("the instructions PDF, the CSV and the text are built for it as for a round frame", async () => {
    const p = rectProject([450], 600, 800, undefined, 2);
    for (const kind of ["instructions-pdf", "instructions-csv", "instructions-txt", "lines-svg", "template-pdf", "template-svg", "template-dxf"] as const) {
      for (const lang of ["en", "zh-TW"] as const) {
        const file = await buildFile(FONT, { project: p, lang, stem: "picture" }, kind);
        expect(file.bytes.length, `${kind} in ${lang}`).toBeGreaterThan(500);
        if (kind === "instructions-pdf") {
          keep(`instructions-rect-${lang}.pdf`, file.bytes);
          expect((await pageContents(file.bytes)).length).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});
