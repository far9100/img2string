import { describe, expect, it } from "vitest";
import { gamutCheck, paletteCost, summarize } from "../../src/core/gamut.ts";
import {
  accentFor, applyPreset, contrastRatio, defaultOrder, freeCandidates, lightness, paletteWarnings, permutations, pickPalette, placeByLightness, presetById, presetOf, PRESETS, proxyOptions, reorder,
  textOn, toHex,
} from "../../src/core/palette.ts";
import { defaultProject, normalizeProject } from "../../src/core/project.ts";
import { benchmark, benchmarkOptions, CMYK_HEX } from "../../src/core/benchmarks.ts";
import { hexToLinear } from "../../src/core/stringart.ts";

const name = (key: string) => key.replace("thread.", "");

describe("presets (§6.3)", () => {
  it("has the spec's colours", () => {
    expect(presetById("colour-cmyk")!.threads.map((t) => t.hex)).toEqual([...CMYK_HEX]);
    expect(presetById("colour-rgbw")).toMatchObject({ board: "#111111" });
    expect(new Set(presetById("colour-rgbw")!.threads.map((t) => t.hex))).toEqual(new Set(["#D7261E", "#1E9E3E", "#1F4FD1", "#F2F2F2"]));
    expect(presetById("mono-black")).toMatchObject({ board: "#FFFFFF", threads: [{ hex: "#111111" }] });
  });

  it("lists every preset's threads lightest first, except black + white, where white is wound last on purpose", () => {
    for (const p of PRESETS) {
      if (p.id === "mono-black-white") expect(p.threads.map((t) => t.name)).toEqual(["black", "white"]);
      else expect(defaultOrder(p.threads), p.id).toEqual(p.threads);
    }
  });

  it("switching to colour takes §3's colour defaults, and back", () => {
    const mono = defaultProject();
    const colour = normalizeProject(applyPreset(mono, presetById("colour-cmyk")!, name)).project;
    expect(colour.mode).toBe("colour");
    expect(colour.frame.pins).toBe(200);
    expect(colour.generator).toMatchObject({ res: 240, minSkip: 15 });
    expect(colour.threads.map((t) => [t.name, t.maxLines])).toEqual([["yellow", 1500], ["cyan", 1500], ["magenta", 1500], ["black", 1500]]);
    expect(presetOf(colour)).toBe("colour-cmyk");
    const back = normalizeProject(applyPreset(colour, presetById("mono-black")!, name)).project;
    expect(back.frame.pins).toBe(256);
    expect(back.generator).toMatchObject({ res: 400, minSkip: 20 });
    expect(back.threads).toEqual([{ name: "black", hex: "#111111", maxLines: 4000 }]);
  });

  it("within a mode, a preset keeps the frame and the budget the user set", () => {
    const p = defaultProject();
    p.frame.pins = 128;
    p.generator.res = 300;
    p.threads[0]!.maxLines = 2500;
    const next = applyPreset(p, presetById("mono-black-white")!, name);
    expect(next.frame.pins).toBe(128);
    expect(next.generator.res).toBe(300);
    expect(next.threads.map((t) => t.maxLines)).toEqual([2500, 2500]);
    expect(presetOf(next)).toBe("mono-black-white");
    next.threads[1]!.hex = "#EEEEEE";
    expect(presetOf(next)).toBe("custom");
  });
});

describe("palette checks", () => {
  it("warns about a board-coloured thread only at the bottom, and about duplicates (§14, DECISIONS D-17)", () => {
    const p = defaultProject();
    p.threads = [{ name: "a", hex: "#FFFFFF", maxLines: 10 }, { name: "b", hex: "#111111", maxLines: 10 }];
    expect(paletteWarnings(p)).toEqual(["thread-equals-board"]);
    p.threads.reverse();
    expect(paletteWarnings(p)).toEqual([]);
    p.threads.push({ name: "c", hex: "#111111", maxLines: 10 });
    expect(paletteWarnings(p)).toEqual(["duplicate-thread"]);
  });

  it("uses the thread colour as the accent unless it lacks contrast (§9)", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(accentFor("#111111", "#FFFFFF")).toBe("#111111");
    expect(accentFor("#FFE000", "#FFFFFF")).toBeNull(); // yellow on white: the fallback accent is used
    expect(accentFor("#FFE000", "#141414")).toBe("#FFE000");
    expect(textOn("#FFE000")).toBe("#000000");
    expect(textOn("#1F4FD1")).toBe("#FFFFFF");
  });
});

describe("the winding-order search's set-up", () => {
  it("lists every order", () => {
    expect(permutations(1)).toEqual([[0]]);
    expect(permutations(3)).toHaveLength(6);
    const four = permutations(4);
    expect(four).toHaveLength(24);
    expect(new Set(four.map((p) => p.join(""))).size).toBe(24);
    expect(four[0]).toEqual([0, 1, 2, 3]);
  });

  it("ranks on a small picture with the full line budgets (DECISIONS D-11)", () => {
    const o = benchmarkOptions("colour"), q = proxyOptions(o);
    expect(q).toMatchObject({ res: 96, pins: 96, minSkip: 7, maxLines: o.maxLines, threads: o.threads, diameterMm: 500, threadWidthMm: 0.25 });
    // a small frame with thick thread: the proxy still keeps alpha at or below 0.5 and enough pins for the skip
    const small = proxyOptions({ ...o, diameterMm: 200, threadWidthMm: 1.5, pins: 64, minSkip: 20 });
    expect((small.threadWidthMm * (small.res - 1)) / small.diameterMm).toBeLessThanOrEqual(0.5);
    expect(small.pins).toBeGreaterThanOrEqual(2 * small.minSkip + 1);
  });

  it("reorders threads together with their budgets", () => {
    const o = { ...benchmarkOptions("colour"), maxLines: [1, 2, 3, 4] };
    const r = reorder(o, [3, 0, 2, 1]);
    expect(r.maxLines).toEqual([4, 1, 3, 2]);
    expect(r.threads).toEqual([o.threads[3], o.threads[0], o.threads[2], o.threads[1]]);
  });
});

describe("choosing threads for a picture (§6.3 M2)", () => {
  const { options: o, target, weight } = benchmark("colour");
  const gamut = summarize(gamutCheck(target, weight, o.board, o.threads));

  it("writes a colour as hex, and back", () => {
    for (const hex of ["#000000", "#FFFFFF", "#FFE000", "#00A0E0", "#E0007A", "#111111", "#7A4B2A"]) expect(toHex(hexToLinear(hex))).toBe(hex);
    expect(toHex([2, -1, 0.5])).toBe("#FF00BC"); // out-of-range values are clamped
  });

  it("offers the picture's own colours, a near-black and a near-white as free colours", () => {
    const free = freeCandidates(gamut);
    expect(free).toHaveLength(gamut.clusters.length + 2);
    expect(free.slice(-2).map((s) => s.hex)).toEqual(["#111111", "#F2F2F2"]);
    expect(free[0]!.hex).toBe(toHex(gamut.clusters[0]!.colour)); // the largest group first
    expect(new Set(free.map((s) => s.hex)).size).toBe(free.length);
  });

  it("picks the threads that serve the picture best, lightest first", () => {
    const four = pickPalette(gamut, "#FFFFFF", freeCandidates(gamut), 4);
    expect(four).toHaveLength(4);
    expect(four.map((s) => lightness(s.hex))).toEqual(four.map((s) => lightness(s.hex)).sort((a, b) => b - a));
    // four free colours leave far less of the wheel out of reach than the benchmark's four
    const after = gamutCheck(target, weight, o.board, four.map((s) => hexToLinear(s.hex)));
    expect(after.outShare).toBeLessThan(0.5 * gamut.outShare);
    expect(paletteCost(gamut.clusters, [o.board, ...four.map((s) => hexToLinear(s.hex))])).toBeLessThan(0.3 * paletteCost(gamut.clusters, [o.board, ...o.threads]));
  });

  it("picks from a list by its names, never the board's colour, never the same colour twice, and stops when nothing helps", () => {
    const list = [{ name: "paper", hex: "#FFFFFF" }, { name: "leaf", hex: "#1E9E3E" }, { name: "leaf again", hex: "#1E9E3E" }, { name: "sea", hex: "#1F4FD1" }, { name: "rose", hex: "#D7261E" }];
    const picked = pickPalette(gamut, "#FFFFFF", list, 6);
    expect(picked.map((s) => s.name).sort()).toEqual(["leaf", "rose", "sea"]);
    expect(pickPalette(gamut, "#FFFFFF", list, 1)).toHaveLength(1);
    expect(pickPalette(gamut, "#FFFFFF", [], 4)).toEqual([]);
    expect(pickPalette(gamut, "#FFFFFF", list, 0)).toEqual([]);
    // a grey picture wants one dark thread
    const grey = benchmark("mono"), greys = summarize(gamutCheck(grey.target, grey.weight, grey.options.board, []));
    expect(pickPalette(greys, "#FFFFFF", [...list, { name: "ink", hex: "#111111" }], 4)[0]).toEqual({ name: "ink", hex: "#111111" });
  });

  it("puts a new thread where its lightness belongs in the winding order", () => {
    const cmyk = CMYK_HEX.map((hex) => ({ hex }));
    expect(placeByLightness(cmyk, "#5EFF52")).toBe(1); // a light green: after yellow, before cyan
    expect(placeByLightness(cmyk, "#FFFFFF")).toBe(0);
    expect(placeByLightness(cmyk, "#000000")).toBe(4);
    expect(placeByLightness([], "#808080")).toBe(0);
  });
});
