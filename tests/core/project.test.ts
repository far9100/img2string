// The project file (spec §11): anything is read into a valid project, and the same project is always the
// same text.
import { describe, expect, it } from "vitest";
import { defaultProject, generationKey, maxMinSkip, maxResolution, normalizeProject, serializeProject, targetKey, toOptions, type Project } from "../../src/core/project.ts";
import { hexToLinear } from "../../src/core/stringart.ts";

const withResult = (): Project => {
  const p = defaultProject();
  p.frame.pins = 64;
  p.generator.minSkip = 5;
  p.result = { key: "", sequences: [[0, 20, 40, 3, 30]], lines: [4], errorReduction: 0.5, meanDeltaEOk: 12, reason: "converged" };
  p.result.key = generationKey(p);
  return p;
};

describe("normalizeProject", () => {
  it("gives the defaults of §3 for an empty file", () => {
    const { project, issues } = normalizeProject({});
    // everything but the picture: a new page starts with the face sample, an empty file names no picture
    expect({ ...project, image: defaultProject().image }).toEqual(defaultProject());
    expect(project.image).toMatchObject({ name: "", sha256: "", sample: null, embedded: null, crop: { cx: 0.5, cy: 0.5, scale: 1, rotateDeg: 0 } });
    expect(issues).toEqual([]);
    expect(project.frame).toEqual({ shape: "circle", diameterMm: 500, pins: 256, pinDiameterMm: 1.5 });
    expect(project.generator).toEqual({ res: 400, minSkip: 20, allowRepeat: false });
    expect(project.threads).toEqual([{ name: "black", hex: "#111111", maxLines: 4000 }]);
  });

  it("takes the colour defaults when a file has several threads", () => {
    const { project } = normalizeProject({ threads: [{ hex: "#ffe000" }, { hex: "#00a0e0" }] });
    expect(project.mode).toBe("colour");
    expect(project.frame.pins).toBe(200);
    expect(project.generator).toEqual({ res: 240, minSkip: 15, allowRepeat: false });
    expect(project.threads.map((t) => [t.hex, t.maxLines])).toEqual([["#FFE000", 1500], ["#00A0E0", 1500]]);
  });

  it("reads the example of §11 unchanged where it defines values", () => {
    const { project, issues } = normalizeProject({
      version: 1,
      image: { name: "photo.jpg", sha256: "abc", crop: { cx: 0.5, cy: 0.45, scale: 1.2, rotateDeg: 0 } },
      adjust: { brightness: 0, contrast: 0.1, gamma: 1, rangeCompression: 1, saturation: 1, unsharp: 0.3, invert: false },
      importance: { preset: "quietRim", brushPng: null },
      frame: { shape: "circle", diameterMm: 500, pins: 256, pinDiameterMm: 1.5 },
      thread: { widthMm: 0.25 },
      board: "#FFFFFF",
      threads: [{ name: "black", hex: "#111111", maxLines: 4000 }],
      generator: { res: 400, minSkip: 20, allowRepeat: false },
      result: { sequences: [[0, 133, 7]], lines: [2], errorReduction: 0.907, meanDeltaEOk: 9.9 },
    });
    expect(issues).toEqual([]);
    expect(project.image.crop).toEqual({ cx: 0.5, cy: 0.45, scale: 1.2, rotateDeg: 0 });
    expect(project.adjust.contrast).toBe(0.1);
    expect(project.importance).toEqual({ preset: "quietRim", strokes: [], edges: 0, tone: 0 }); // the automatic emphasis is off unless asked for
    expect(project.result).toMatchObject({ sequences: [[0, 133, 7]], lines: [2], errorReduction: 0.907, meanDeltaEOk: 9.9 });
  });

  it("clamps what is out of range and says what it changed", () => {
    const { project, issues } = normalizeProject({
      frame: { diameterMm: 5000, pins: 10.5, shape: "square" }, thread: { widthMm: "thick" }, board: "white",
      threads: [{ hex: "#12345", maxLines: 0 }], generator: { res: 9999, minSkip: 900 }, adjust: { gamma: -3 }, paper: "B5",
    });
    expect(project.frame.diameterMm).toBe(1000);
    expect(project.frame.pins).toBe(64);
    expect(project.thread.widthMm).toBe(0.25);
    expect(project.board).toBe("#FFFFFF");
    expect(project.threads[0]).toMatchObject({ hex: "#111111", maxLines: 1 }); // a budget is never 0 (DECISIONS D-03)
    expect(project.generator.res).toBe(1200);
    expect(project.generator.minSkip).toBe(maxMinSkip(64));
    expect(project.adjust.gamma).toBe(0.2);
    expect(project.paper).toBe("A4");
    expect(issues).toEqual(expect.arrayContaining(["frame", "frame-shape", "thread", "board-colour", "thread-colour", "budget", "generator", "min-skip", "adjust"]));
  });

  it("lowers the resolution when the thread is too thick for it (§14, DECISIONS D-16)", () => {
    const { project, issues } = normalizeProject({ frame: { diameterMm: 200 }, thread: { widthMm: 1 }, generator: { res: 400 } });
    expect(maxResolution(200, 1)).toBe(101);
    expect(project.generator.res).toBe(101);
    expect((project.thread.widthMm * (project.generator.res - 1)) / project.frame.diameterMm).toBeLessThanOrEqual(0.5);
    expect(issues).toContain("alpha");
  });

  it("keeps at most six threads and never fewer than one", () => {
    expect(normalizeProject({ threads: Array.from({ length: 9 }, () => ({ hex: "#101010" })) }).project.threads).toHaveLength(6);
    expect(normalizeProject({ threads: [] }).project.threads).toHaveLength(1);
  });

  it("keeps valid brush strokes and drops broken ones", () => {
    const { project, issues } = normalizeProject({ importance: { strokes: [{ w: 9, r: 0.05, pts: [0.1, 0.2, 0.3, 0.4] }, { w: 1, r: 0.05, pts: [0.1] }, { w: 1, pts: "x" }], brushPng: "data:image/png;base64,AAAA" } });
    expect(project.importance.strokes).toEqual([{ w: 3, r: 0.05, pts: [0.1, 0.2, 0.3, 0.4] }]);
    expect(issues).toEqual(expect.arrayContaining(["importance", "brush-png"]));
  });

  it("reads the automatic emphasis, within its range", () => {
    expect(normalizeProject({ importance: { edges: 1.5, tone: 0.5 } }).project.importance).toMatchObject({ edges: 1.5, tone: 0.5 });
    const { project, issues } = normalizeProject({ importance: { edges: 9, tone: -1 } });
    expect(project.importance).toMatchObject({ edges: 2, tone: 0 });
    expect(issues).toContain("importance");
    expect(normalizeProject({ importance: { edges: "much" } }).project.importance.edges).toBe(0);
  });

  it("drops a result that could not have been generated for the project", () => {
    const good = withResult();
    expect(normalizeProject(good).project.result?.sequences).toEqual([[0, 20, 40, 3, 30]]);
    for (const sequences of [[[0, 2]], [[0, 99]], [[5]], [[0, 20], [0, 20]], "x"]) {
      const { project, issues } = normalizeProject({ ...good, result: { ...good.result, sequences } });
      expect(project.result, JSON.stringify(sequences)).toBeNull();
      expect(issues).toContain("result");
    }
  });
});

describe("serializeProject", () => {
  it("round-trips, with number lists on one line and a final newline", () => {
    const p = withResult();
    p.importance.strokes = [{ w: 2, r: 0.04, pts: [0.25, 0.5, 0.26, 0.51] }];
    p.importance.edges = 1.25;
    p.importance.tone = 0.5;
    p.generator.allowRepeat = true;
    const text = serializeProject(p);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('"sequences": [\n      [0, 20, 40, 3, 30]\n    ]');
    expect(text).toContain('"pts": [0.25, 0.5, 0.26, 0.51]');
    const back = normalizeProject(JSON.parse(text));
    expect(back.issues).toEqual([]);
    expect(back.project).toEqual(p);
    expect(serializeProject(back.project)).toBe(text);
  });

  it("is the same text whatever order the fields arrived in", () => {
    const p = withResult(), shuffled = Object.fromEntries(Object.entries(p).reverse());
    expect(serializeProject(normalizeProject(shuffled).project)).toBe(serializeProject(p));
  });
});

describe("keys", () => {
  it("a result goes out of date with what it depends on, and with nothing else", () => {
    const p = withResult(), key = generationKey(p);
    const change = (f: (q: Project) => void) => { const q = structuredClone(p); f(q); return generationKey(q); };
    expect(change((q) => { q.threads[0]!.name = "ink"; })).toBe(key);
    expect(change((q) => { q.player.step = 3; q.paper = "A3"; q.frame.pinDiameterMm = 2; })).toBe(key);
    expect(change((q) => { q.threads[0]!.maxLines = 3000; })).not.toBe(key);
    expect(change((q) => { q.frame.pins = 128; })).not.toBe(key);
    expect(change((q) => { q.adjust.contrast = 0.2; })).not.toBe(key);
    expect(change((q) => { q.image.crop.scale = 1.5; })).not.toBe(key);
    expect(change((q) => { q.importance.preset = "quietRim"; })).not.toBe(key);
    expect(change((q) => { q.importance.edges = 1; })).not.toBe(key);
    expect(change((q) => { q.importance.tone = 0.5; })).not.toBe(key);
    expect(change((q) => { q.generator.allowRepeat = true; })).not.toBe(key);
    // the picture itself does not depend on the frame's size or the budgets
    const q = structuredClone(p);
    q.frame.diameterMm = 300;
    q.threads[0]!.maxLines = 10;
    expect(targetKey(q)).toBe(targetKey(p));
  });

  it("toOptions is what §12 takes", () => {
    const p = defaultProject();
    expect(toOptions(p)).toEqual({
      res: 400, pins: 256, diameterMm: 500, threadWidthMm: 0.25, board: [1, 1, 1], threads: [hexToLinear("#111111")], maxLines: [4000], minSkip: 20, allowRepeat: false,
    });
  });
});
