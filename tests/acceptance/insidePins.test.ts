// A piece with pins inside the picture (DECISIONS D-60, D-61) through everything that is stored or handed out: the
// project file and its keys, the instructions, the player, the nail template and the other files. The piece is
// a real one (tests/helpers/pdf.ts's insideProject), so its sequence has steps round the frame and steps along
// lines drawn before; no reader of it may take a step round the frame for a pin, or a pin inside for one of
// the frame's.
import fontkit from "@pdf-lib/fontkit";
import { describe, expect, it } from "vitest";
import { frameMask, framePins, frameThreadMm, insideMm, isRound, joinRule, pictureAspect, pinCount, pinOf, roundTo } from "../../src/core/frame.ts";
import { replayModel, runGreedy } from "../../src/core/greedy.ts";
import {
  boardSizeMm, instructionsCsv, instructionsTxt, materials, pinCode, pinHint, ROUND_MARK, sheetTexts, templateTitle, THREAD_MARGIN, threadPlans, whereIs,
} from "../../src/core/instructions.ts";
import { applyPreset, presetById } from "../../src/core/palette.ts";
import {
  defaultBudget, defaultProject, generationKey, INSIDE_BUDGET, LIMITS, madeOptions, normalizeProject, placementKey, serializeProject, targetKey, toOptions, withInside, type Project,
} from "../../src/core/project.ts";
import { measureTrueWidth } from "../../src/core/realistic.ts";
import { buildFile, needsPiece, needsResult, type ExportKind } from "../../src/export/build.ts";
import { templateDxf } from "../../src/export/dxf.ts";
import { linesSvg, templateSvg } from "../../src/export/svg.ts";
import { buildPlan, viewAt } from "../../src/player/player.ts";
import type { Prim } from "../../src/render/prims.ts";
import { templateDrawing, templateLayers, templatePins } from "../../src/render/template.ts";
import { fontBytes, insideProject, pageContents, showsText, type GlyphFont } from "../helpers/pdf.ts";
import { lineDrawing } from "../helpers/pictures.ts";

const p = insideProject(40), F = p.frame.pins, inside = p.result!.inside!, M = inside.length / 2, sequence = p.result!.sequences[0]!;
const walks = sequence.filter(isRound).length;
const upright = (q: Project) => {
  q.image.width = 600;
  q.image.height = 800;
  q.frame = { shape: "rect", diameterMm: 300, pins: 96, pinDiameterMm: 1.5, aspect: pictureAspect(600, 800), inside: 40 };
};
const rect = insideProject(40, upright);
const FONT = fontBytes(), text = (b: Uint8Array) => new TextDecoder().decode(b);
const build = (project: Project, kind: ExportKind, lang: "zh-TW" | "en" = "zh-TW") => buildFile(FONT, { project, lang, stem: "test" }, kind);

describe("the piece these tests are about", () => {
  it("has its pins, and a thread that went round the frame and back along its own lines", () => {
    expect([M, rect.result!.inside!.length / 2]).toEqual([40, 40]);
    expect(walks).toBeGreaterThan(0);
    const seen = new Set<string>();
    let again = 0;
    for (let i = 1; i < sequence.length; i++) {
      if (isRound(sequence[i]!)) continue;
      const a = pinOf(sequence[i - 1]!), b = sequence[i]!, key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) again++;
      seen.add(key);
    }
    expect(again).toBeGreaterThan(0);
    expect(sequence.some((entry) => pinOf(entry) >= F)).toBe(true);
  });
});

describe("the budget a thread starts with on a piece with pins inside (D-61)", () => {
  const colours = (q: Project) => applyPreset(q, presetById("colour-cmyk")!, (key) => key);

  it("is the mode's own on a frame alone, and 4000 in either mode with pins inside", () => {
    expect([defaultBudget("mono", false), defaultBudget("colour", false), defaultBudget("mono", true), defaultBudget("colour", true)]).toEqual([4000, 1500, 4000, INSIDE_BUDGET]);
    expect(INSIDE_BUDGET).toBe(4000);
  });

  it("goes with the pins when they are turned on and off, where the user has not set it", () => {
    const colour = colours(defaultProject());
    expect(colour.threads.map((t) => t.maxLines)).toEqual([1500, 1500, 1500, 1500]);
    const pinned = withInside(colour, 300);
    expect(pinned.frame.inside).toBe(300);
    expect(pinned.threads.map((t) => t.maxLines)).toEqual([4000, 4000, 4000, 4000]);
    // another number of pins changes nothing; none at all takes the budgets back
    expect(withInside(pinned, 150).threads).toBe(pinned.threads);
    expect(withInside(pinned, 0).threads.map((t) => t.maxLines)).toEqual([1500, 1500, 1500, 1500]);
    expect(normalizeProject(withInside(pinned, 0)).project.frame).toEqual(colour.frame);
    // a budget that was set by hand stays, both ways
    const own = { ...colour, threads: colour.threads.map((t, i) => (i === 3 ? { ...t, maxLines: 2500 } : t)) };
    expect(withInside(own, 300).threads.map((t) => t.maxLines)).toEqual([4000, 4000, 4000, 2500]);
    expect(withInside({ ...pinned, threads: pinned.threads.map((t, i) => (i === 0 ? { ...t, maxLines: 900 } : t)) }, 0).threads.map((t) => t.maxLines)).toEqual([900, 1500, 1500, 1500]);
    // with one black thread the two are the same number: nothing to change
    const mono = defaultProject();
    expect(withInside(mono, 300).threads).toBe(mono.threads);
  });

  it("is what a project takes when its mode changes while it has pins inside", () => {
    const pinned = withInside(defaultProject(), 300), colour = colours(pinned);
    expect(colour.frame.inside).toBe(300);
    expect(colour.threads.map((t) => t.maxLines)).toEqual([4000, 4000, 4000, 4000]);
    // within a mode a new palette keeps the budget the first thread has
    const other = applyPreset({ ...colour, threads: colour.threads.map((t) => ({ ...t, maxLines: 2200 })) }, presetById("colour-rgbw")!, (key) => key);
    expect(other.threads.map((t) => t.maxLines)).toEqual([2200, 2200, 2200, 2200]);
  });
});

describe("a project with pins inside the picture", () => {
  it("holds how many in its frame, within the limits, and nothing at all when there are to be none", () => {
    const frame = (count: unknown) => normalizeProject({ frame: { shape: "circle", diameterMm: 500, pins: 256, pinDiameterMm: 1.5, inside: count } });
    expect(frame(300).project.frame).toEqual({ shape: "circle", diameterMm: 500, pins: 256, pinDiameterMm: 1.5, inside: 300 });
    expect(frame(300).issues).toEqual([]);
    expect(frame(0).project.frame).toEqual({ shape: "circle", diameterMm: 500, pins: 256, pinDiameterMm: 1.5 });
    expect("inside" in frame(0).project.frame).toBe(false);
    expect("inside" in normalizeProject({}).project.frame).toBe(false);
    expect(frame(5000).project.frame.inside).toBe(LIMITS.inside[1]);
    expect(frame(5000).issues).toContain("frame");
    expect(frame(12.4).project.frame.inside).toBe(12);
    expect([frame(-3).project.frame.inside, frame("many").project.frame.inside]).toEqual([undefined, undefined]);
    // a rectangular frame has them as well
    expect(normalizeProject({ image: { width: 600, height: 800 }, frame: { shape: "rect", inside: 50 } }).project.frame).toMatchObject({ shape: "rect", inside: 50, aspect: 0.75 });
  });

  it("is written with the pins of its piece, and read back to the same project and the same text", () => {
    const written = serializeProject(p);
    expect(written).toContain('"pinDiameterMm": 1.5,\n    "inside": 40\n  }');
    expect(written).toMatch(/"reason": "converged",\n {4}"inside": \[0\.\d+, 0\.\d+, [^\n]*\]\n {2}\}/);
    // a step round the frame is in the file as it is in memory: a pin below zero
    expect(written).toMatch(/"sequences": \[\n {6}\[\d+, [^\n]*, -\d+[^\n]*\]\n/);
    const back = normalizeProject(JSON.parse(written));
    expect(back.issues).toEqual([]);
    expect(back.project).toEqual(p);
    expect(serializeProject(back.project)).toBe(written);
    // a result with no pins inside (the picture had no room for one) is written without the list
    expect(serializeProject({ ...p, result: { ...p.result!, inside: [] } })).not.toMatch(/"inside": \[/);
  });

  it("has keys that say so, while a project without says nothing of it", () => {
    const { inside: _count, ...alone } = p.frame, without: Project = { ...p, frame: alone as Project["frame"], result: null };
    expect(targetKey(p)).toContain('"inside":{"diameterMm":300,"n":40,"pinDiameterMm":1.5}');
    expect(targetKey(without)).not.toContain("inside");
    expect(generationKey(p)).not.toBe(generationKey(without));
    const moves = (edit: (q: Project) => void, key: (q: Project) => string): boolean => { const q = structuredClone(p); edit(q); return key(q) !== key(p); };
    // the pins come with the target: what they are placed by asks for a new one, and the frame's own pins do not
    expect([moves((q) => { q.frame.inside = 60; }, targetKey), moves((q) => { q.frame.diameterMm = 400; }, targetKey), moves((q) => { q.frame.pinDiameterMm = 2; }, targetKey)]).toEqual([true, true, true]);
    expect(moves((q) => { q.frame.pins = 128; }, targetKey)).toBe(false);
    // a pin's thickness now counts for the piece (it sets how near a line may pass one), which it does not without pins inside
    expect(moves((q) => { q.frame.pinDiameterMm = 2; }, generationKey)).toBe(true);
    // where the pins stand: by the picture, the frame, the palette and the importance as painted ...
    const placed: ((q: Project) => void)[] = [
      (q) => { q.image.crop.cx = 0.4; }, (q) => { q.image.crop.rotateDeg = 10; }, (q) => { q.image.sha256 = "d".repeat(64); }, (q) => { q.adjust.invert = true; },
      (q) => { q.importance.preset = "centreOnly"; }, (q) => { q.importance.strokes = [{ w: 2, r: 0.05, pts: [0.5, 0.5, 0.6, 0.6] }]; },
      (q) => { q.frame.inside = 41; }, (q) => { q.frame.diameterMm = 310; }, (q) => { q.frame.pinDiameterMm = 2; }, (q) => { q.board = "#000000"; }, (q) => { q.threads[0]!.hex = "#333333"; },
      upright,
    ];
    placed.forEach((edit, i) => expect(moves(edit, placementKey), `what places the pins, ${i}`).toBe(true));
    // ... and not by the sliders, the automatic emphasis, the working resolution or anything else of the generator
    const kept: ((q: Project) => void)[] = [
      (q) => { q.adjust.contrast = 0.3; }, (q) => { q.adjust.unsharp = 1; }, (q) => { q.adjust.gamma = 1.4; }, (q) => { q.importance.edges = 1; }, (q) => { q.importance.tone = 0.5; },
      (q) => { q.generator.res = 200; }, (q) => { q.generator.minSkip = 5; }, (q) => { q.threads[0]!.maxLines = 99; }, (q) => { q.frame.pins = 128; }, (q) => { q.thread.widthMm = 0.3; },
      (q) => { q.threads[0]!.name = "ink"; }, (q) => { q.paper = "A3"; },
    ];
    kept.forEach((edit, i) => expect(moves(edit, placementKey), `what leaves the pins, ${i}`).toBe(false));
  });

  it("gives its options only when told the pins: those of the target, or the piece's own", () => {
    expect(() => toOptions(p)).toThrow();
    const o = toOptions(p, inside);
    expect(o).toEqual({
      res: 120, pins: 96, diameterMm: 300, threadWidthMm: 0.5, board: [1, 1, 1], threads: [o.threads[0]], maxLines: [1500], minSkip: 8, allowRepeat: false,
      inside, pinDiameterMm: 1.5,
    });
    expect(madeOptions(p)).toEqual(o);
    // no pin could be placed: the frame's own options, and still no repeats (the setting does not count on such a frame)
    const repeating: Project = { ...p, generator: { ...p.generator, allowRepeat: true } };
    expect(Object.keys(toOptions(repeating, []))).toHaveLength(9);
    expect([toOptions(repeating, []).allowRepeat, toOptions(repeating, inside).allowRepeat]).toEqual([false, false]);
    // a frame that asks for none takes none
    const d = defaultProject();
    expect(toOptions(d, [0.5, 0.5])).toEqual(toOptions(d));
    expect(madeOptions(d)).toEqual(toOptions(d));
  });

  it("keeps a stored piece only if it could have been made on these pins", () => {
    const stored = JSON.parse(serializeProject(p)) as { frame: object; result: object };
    const read = (result: object, frame: object = {}) => normalizeProject({ ...stored, frame: { ...stored.frame, ...frame }, result: { ...stored.result, ...result } });
    expect(read({}).project.result?.sequences).toEqual(p.result!.sequences);
    const bad = (why: string, result: object, frame?: object) => {
      const r = read(result, frame);
      expect(r.project.result, why).toBeNull();
      expect(r.issues, why).toContain("result");
    };
    bad("pins inside on a frame that asks for none", {}, { inside: 0 });
    bad("an odd number of coordinates", { inside: inside.slice(1) });
    bad("a pin off the frame's square", { inside: [1.2, 0.5, ...inside.slice(2)] });
    bad("coordinates that are not numbers", { inside: inside.map(String) });
    bad("a thread that begins round the frame", { sequences: [[roundTo(3), 40]] });
    bad("round the frame to a pin inside", { sequences: [[3, roundTo(F)]] });
    bad("round the frame from a pin inside", { sequences: [[F, roundTo(3)]] });
    bad("round the frame to where it is", { sequences: [[3, roundTo(3)]] });
    bad("a pin the piece has not", { sequences: [[3, F + M]] });
    bad("half a pin", { sequences: [[3, 40.5]] });
    // Two pins of the frame only as the frame alone would join them; any pin with a pin inside, whatever
    // stands between them (D-61: a thread lies against a nail in its way and goes on).
    const may = joinRule({ pins: F, minSkip: p.generator.minSkip, inside });
    expect([may(0, 3), may(0, 30), may(0, F), may(F, F + M - 1), may(F, F)]).toEqual([false, true, true, true, false]);
    bad("two pins of the frame nearer than its minimum skip", { sequences: [[0, 3]] });
    bad("a pin joined to itself", { sequences: [[F, F]] });
    for (const line of [[0, F], [F, F + M - 1], [F + 1, 40]]) expect(read({ sequences: [line] }).project.result?.sequences, line.join("-")).toEqual([line]);
    // round the frame between any two of its pins, however near, is fine: nothing crosses the picture
    expect(read({ sequences: [[3, roundTo(4)]] }).project.result?.sequences).toEqual([[3, roundTo(4)]]);
    // a piece of such a frame that got no pin is a piece of the frame alone: its lines by the minimum skip, and no walks
    const none = read({ inside: undefined, sequences: [[0, 30, 60]] });
    expect(none.project.result?.sequences).toEqual([[0, 30, 60]]);
    expect("inside" in none.project.result!).toBe(false);
    bad("pins too near round the frame", { inside: undefined, sequences: [[0, 3]] });
    bad("a walk without pins inside", { inside: undefined, sequences: [[0, roundTo(40)]] });
    const round = normalizeProject({ ...JSON.parse(serializeProject(defaultProject())), result: { key: "", sequences: [[0, roundTo(40)]], lines: [1], errorReduction: 0, meanDeltaEOk: 0, reason: "stopped" } });
    expect(round.project.result).toBeNull();
  });

  it("is the same picture wound again from the file as it was when it was made", () => {
    const o = madeOptions(p), T = lineDrawing(o.res, 1.5), W = frameMask(o), run = runGreedy(o, T, W);
    expect(run.seq).toEqual(p.result!.sequences);
    expect(replayModel(o, T, W, p.result!.sequences).error()).toBe(run.error());
    const shown = measureTrueWidth(o, p.result!.sequences, T, W, { reference: T, painted: W });
    expect(shown.similarity).toBeGreaterThan(0.2);
    expect(shown.similarity).toBeLessThan(1);
  });
});

describe("the winding instructions of a piece with pins inside", () => {
  it("say where a pin inside is by its millimetres from the frame's left and top, never by another pin's hint", () => {
    for (let j = 0; j < M; j++) {
      const mm = insideMm({ diameterMm: 300 }, inside, j), left = Math.round(mm.left), top = Math.round(mm.top);
      expect(whereIs(p.frame, F + j, inside)).toEqual({ at: "inside", left, top });
      expect([pinHint(p.frame, F + j, "zh-TW", inside), pinHint(p.frame, F + j, "en", inside), pinCode(p.frame, F + j, inside)]).toEqual([`左${left} 上${top}`, `${left} right, ${top} down`, `x${left}y${top}`]);
      // the clock would give pin F + j the place of pin j
      expect(pinHint(p.frame, F + j, "en", inside)).not.toBe(pinHint(p.frame, j, "en", inside));
      expect(left).toBeGreaterThan(5);
      expect(left).toBeLessThan(295);
    }
    // the frame's own pins as ever, on both shapes
    expect(whereIs(p.frame, 24, inside)).toEqual({ at: "clock", clock: "3:00" });
    expect(whereIs(rect.frame, 0, rect.result!.inside)).toMatchObject({ at: "side", side: "top", n: 1 });
    expect(whereIs(rect.frame, rect.frame.pins + 3, rect.result!.inside).at).toBe("inside");
    // a rectangle's pins inside are measured from its own left side, not from the square it lies in
    const r = rect.result!.inside!, first = whereIs(rect.frame, rect.frame.pins, r);
    expect(first).toMatchObject({ left: Math.round((r[0]! - 0.125) * 300), top: Math.round(r[1]! * 300) });
    // asked without the pins there is no place to give, and none is made up
    expect(pinCode(p.frame, F + 2)).toBe("xNaNyNaN");
  });

  it("print both counts, a paragraph about the pins inside, and every step round the frame marked", () => {
    const zh = sheetTexts(p, "zh-TW"), en = sheetTexts(p, "en");
    expect(zh.subtitle).toBe(`圓框 300 mm · 96 釘 · 線：1 種 · 線數：${sequence.length - 1} 條 · 畫面內 ${M} 釘`);
    expect(en.subtitle.endsWith(` · ${M} pins inside the picture`)).toBe(true);
    expect(zh.howMore).toContain(`從 ${F + 1} 到 ${F + M}`);
    expect(zh.howMore).toContain(`「${ROUND_MARK}」`);
    expect(en.howMore).toContain(`“${ROUND_MARK}”`);
    expect(en.howMore).toContain(`${F + 1} to ${F + M}`);
    expect(zh.notes[0]).toBe(`釘子：${F + M} 根，直徑 1.5 mm，長度約 25 mm。其中 ${F} 根在框上，${M} 根在畫面裡。`);
    expect(en.notes[0]).toContain(`Nails: ${F + M},`);
    expect(en.notes[0]).toContain(`Of these, ${F} stand on the frame and ${M} inside the picture.`);
    expect(materials(p).nails).toBe(F + M);
    const rows = zh.sections[0]!.rows;
    expect(rows.flatMap((row) => row.pins)).toEqual(sequence.map((entry) => pinOf(entry) + 1));
    expect(rows.flatMap((row) => (row.round ?? []).map((j) => row.index - 1 + j))).toEqual(sequence.flatMap((entry, i) => (isRound(entry) ? [i] : [])));
    rows.forEach((row) => expect(row.clock).toBe(pinHint(p.frame, pinOf(sequence[row.index - 1]!), "zh-TW", inside)));
    expect(zh.sections[0]!.facts).toContain(`終點：${pinOf(sequence.at(-1)!) + 1} 號釘`);
    expect(JSON.stringify([zh.sections[0]!.rows, zh.sections[0]!.facts, en.sections[0]!.facts])).not.toMatch(/NaN|undefined|-\d/);
    // a piece of the frame alone has none of this
    const plain = sheetTexts(insideProject(0), "en");
    expect(plain.howMore).toBeUndefined();
    expect(plain.subtitle).not.toContain("inside");
    expect(plain.sections[0]!.rows.every((row) => row.round === undefined)).toBe(true);
  });

  it("write how the thread gets to each pin into the CSV, and the mark into the text", () => {
    const csv = instructionsCsv(p).split("\r\n");
    expect(csv[0]).toBe("thread,name,hex,step,pin,clock,move");
    expect(csv).toHaveLength(sequence.length + 2);
    sequence.forEach((entry, i) => expect(csv[i + 1]).toBe(`1,black,#111111,${i + 1},${pinOf(entry) + 1},${pinCode(p.frame, pinOf(entry), inside)},${i === 0 ? "" : isRound(entry) ? "round" : "line"}`));
    expect(csv.filter((line) => line.endsWith(",round"))).toHaveLength(walks);
    expect(csv.some((line) => /,x\d+y\d+,line$/.test(line))).toBe(true);
    expect(instructionsCsv(rect).split("\r\n")[0]).toBe("thread,name,hex,step,pin,side,move");
    expect(instructionsCsv(insideProject(0)).split("\r\n")[0]).toBe("thread,name,hex,step,pin,clock");
    for (const lang of ["zh-TW", "en"] as const) {
      const txt = instructionsTxt(p, lang), rows = txt.split("\r\n").filter((line) => line.startsWith("[ ]"));
      expect(rows).toHaveLength(Math.ceil(sequence.length / 10));
      expect(rows.join("\n").split(ROUND_MARK).length - 1).toBe(walks);
      expect(txt).toContain(sheetTexts(p, lang).howMore!.slice(0, 18));
      expect(txt).not.toMatch(/NaN|undefined/);
      // the largest pin number has three digits and the mark one more place: the hints of full rows line up
      expect(new Set(rows.slice(0, -1).map((row) => row.lastIndexOf("   "))).size).toBe(1);
    }
    expect(instructionsTxt(insideProject(0), "en")).not.toContain(ROUND_MARK);
  });

  it("measure the thread with its ways round the frame, by the frame's outline", () => {
    const plan = threadPlans(p)[0]!, o = madeOptions(p);
    expect(plan.lengthMm).toBe(frameThreadMm(o, sequence, 1.5) * (1 + THREAD_MARGIN));
    expect([plan.startPin, plan.endPin, plan.lines]).toEqual([sequence[0], pinOf(sequence.at(-1)!), sequence.length - 1]);
    // every step taken for a straight line would be another length
    expect(frameThreadMm(o, sequence.map(pinOf), 1.5)).not.toBe(frameThreadMm(o, sequence, 1.5));
  });

  it("go into the PDF with the mark before the pin", async () => {
    const font = fontkit.create(FONT) as unknown as GlyphFont, pages = await pageContents((await build(p, "instructions-pdf")).bytes);
    const first = sequence.find(isRound)!;
    expect(pages.some((page) => showsText(page.content, font, `${ROUND_MARK}${pinOf(first) + 1}`))).toBe(true);
    expect(pages.some((page) => showsText(page.content, font, pinHint(p.frame, pinOf(sequence[0]!), "zh-TW", inside)))).toBe(true);
  });
});

describe("the player on a piece with pins inside", () => {
  it("has a step for every pin of the sequence, the ways round the frame marked as such", () => {
    const plan = buildPlan(p.result!.sequences, F);
    expect(plan.steps).toHaveLength(sequence.length - 1);
    expect(plan.steps.map((s) => [s.from, s.to])).toEqual(sequence.slice(1).map((entry, i) => [pinOf(sequence[i]!), pinOf(entry)]));
    expect(plan.steps.filter((s) => s.round)).toHaveLength(walks);
    const at = plan.steps.findIndex((s) => s.round);
    expect(viewAt(plan, at)).toMatchObject({ round: true, nextPin: plan.steps[at]!.to + 1, fromPin: plan.steps[at]!.from + 1 });
    // a pin inside has no clock position, and is not given the frame pin's
    expect(viewAt(plan, plan.steps.findIndex((s) => s.to >= F))).toMatchObject({ round: false, nextClock: "" });
    expect(viewAt(plan, plan.steps.findIndex((s) => s.to < F && !s.round)).nextClock).toMatch(/^\d+:\d\d$/);
    // the steps of a piece of the frame alone are what they were, with nothing added
    expect(buildPlan([[0, 136, 7]], 256).steps).toEqual([{ thread: 0, line: 1, from: 0, to: 136 }, { thread: 0, line: 2, from: 136, to: 7 }]);
  });
});

describe("the nail template of a piece with pins inside", () => {
  it("has every pin where the generator has it, the frame's first", () => {
    for (const q of [p, rect]) {
      const own = q.result!.inside!, pins = templatePins(q.frame, own), o = madeOptions(q), P = framePins(o), mm = q.frame.diameterMm / (o.res - 1), board = boardSizeMm(q.frame);
      expect(pins).toHaveLength(pinCount(o));
      expect(pins.slice(0, q.frame.pins)).toEqual(templatePins(q.frame));
      // the frame's own box lies this far inside the square of the working grid
      const offX = (q.frame.diameterMm - (board.width - 40)) / 2, offY = (q.frame.diameterMm - (board.height - 40)) / 2;
      pins.forEach(([x, y], i) => {
        expect(x, `pin ${i}`).toBeCloseTo(20 + P[2 * i]! * mm - offX, 6);
        expect(y, `pin ${i}`).toBeCloseTo(20 + P[2 * i + 1]! * mm - offY, 6);
      });
    }
  });

  it("draws each pin inside with a circle, a cross and its number, every number clear of every pin and of every other number", { timeout: 120_000 }, () => {
    const thick = insideProject(60, (q) => { q.frame.pinDiameterMm = 3; });
    for (const q of [p, rect, insideProject(200), thick]) {
      const own = q.result!.inside!, count = own.length / 2, N = q.frame.pins, L = templateLayers(q.frame, own), plain = templateLayers(q.frame), pins = templatePins(q.frame, own), pr = q.frame.pinDiameterMm / 2;
      expect(count).toBeGreaterThan(20);
      expect(L.pins).toHaveLength(N + count);
      expect(L.pins.slice(0, N)).toEqual(plain.pins);
      expect(L.marks.slice(0, plain.marks.length)).toEqual(plain.marks);
      const added = L.marks.slice(plain.marks.length), labels: [number, number, number, number][] = [];
      expect(added).toHaveLength(3 * count);
      for (let j = 0; j < count; j++) {
        const [across, down, number] = added.slice(3 * j, 3 * j + 3) as [Prim, Prim, Prim], [x, y] = pins[N + j]!;
        expect(L.pins[N + j]).toEqual({ t: "circle", c: [x, y], r: pr, stroke: "#1c1d1f", width: 0.2 });
        if (across.t !== "line" || down.t !== "line" || number.t !== "text") throw new Error("not a cross and a number");
        // the two hairs cross on the pin's centre
        expect([across.a[1], across.b[1], down.a[0], down.b[0]]).toEqual([y, y, x, x]);
        expect((across.a[0] + across.b[0]) / 2).toBeCloseTo(x, 9);
        expect((down.a[1] + down.b[1]) / 2).toBeCloseTo(y, 9);
        expect(across.b[0] - across.a[0]).toBeCloseTo(2 * (pr + 0.6), 9);
        expect(number.text).toBe(String(N + j + 1));
        const w = number.text.length * 0.555 * number.size, h = 0.733 * number.size;
        labels.push([number.at[0], number.at[1] - h, number.at[0] + w, number.at[1]]);
      }
      labels.forEach((box, j) => {
        pins.forEach(([px, py], i) => {
          const dx = Math.max(box[0] - px, 0, px - box[2]), dy = Math.max(box[1] - py, 0, py - box[3]);
          expect(Math.hypot(dx, dy), `number ${N + j + 1} and pin ${i + 1}`).toBeGreaterThan(pr);
        });
        for (let k = j + 1; k < labels.length; k++) {
          const other = labels[k]!;
          expect(box[2] <= other[0] || other[2] <= box[0] || box[3] <= other[1] || other[3] <= box[1], `numbers ${N + j + 1} and ${N + k + 1}`).toBe(true);
        }
      });
      expect(templateDrawing(q.frame, own).prims).toEqual([...L.board, ...L.frame, ...L.marks, ...L.pins]);
    }
    // without the pins it is the frame's template, to the last primitive
    expect(templateDrawing(p.frame)).toEqual(templateDrawing({ shape: "circle", diameterMm: 300, pins: 96, pinDiameterMm: 1.5 }));
  });

  it("goes into the SVG, the DXF and the lines with every pin, and none of them takes a step round the frame for a line", () => {
    const pinsGroup = /<g id="pins">([\s\S]*?)<\/g>/.exec(templateSvg(p.frame, "t", inside))![1]!;
    expect(pinsGroup.match(/<circle/g)).toHaveLength(F + M);
    expect(templateSvg(p.frame, "t", inside)).toContain(`>${F + M}</text>`);
    expect(templateDxf(p.frame, inside).split("CIRCLE\r\n8\r\nPINS")).toHaveLength(F + M + 1);
    expect(templateSvg(p.frame, "t")).toBe(templateSvg({ shape: "circle", diameterMm: 300, pins: 96, pinDiameterMm: 1.5 }, "t"));
    const lines = linesSvg(p);
    expect(lines.match(/<line /g)).toHaveLength(sequence.length - 1 - walks);
    expect(lines).not.toMatch(/NaN|undefined/);
    expect([templateTitle(p.frame, "zh-TW", inside), templateTitle(p.frame, "zh-TW"), templateTitle(rect.frame, "en", rect.result!.inside)])
      .toEqual([`釘位模板 · 300 mm · 96 釘 · 畫面內 ${M} 釘`, "釘位模板 · 300 mm · 96 釘", "Nail template · 225 × 300 mm · 96 pins · 40 pins inside the picture"]);
  });

  it("is built from the made piece, and cannot be built before there is one", async () => {
    expect(text((await build(p, "template-svg")).bytes)).toContain(`>${F + M}</text>`);
    expect(text((await build(p, "template-dxf")).bytes).split("CIRCLE\r\n8\r\nPINS")).toHaveLength(F + M + 1);
    const pdf = (await build(p, "template-pdf")).bytes, pages = await pageContents(pdf), font = fontkit.create(FONT) as unknown as GlyphFont;
    expect(text(pdf.subarray(0, 5))).toBe("%PDF-");
    expect(pages.some((page) => showsText(page.content, font, String(F + M)))).toBe(true);
    expect(pages.some((page) => showsText(page.content, font, templateTitle(p.frame, "zh-TW", inside)))).toBe(true);
    // a template of the frame alone would look right and leave the pins out: there is none
    const unmade: Project = { ...p, result: null };
    for (const kind of ["template-pdf", "template-svg", "template-dxf"] as const) {
      expect([needsResult(kind), needsPiece(kind, unmade), needsPiece(kind, defaultProject()), needsPiece(kind, p)]).toEqual([false, true, false, true]);
      await expect(build(unmade, kind)).rejects.toThrow("no-result");
    }
    expect(needsPiece("instructions-csv", defaultProject())).toBe(true);
  });
});
