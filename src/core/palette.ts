// Palettes (spec §6.3): the presets, the default winding order, the checks of §14 that concern colours, the
// accent colour of §9, the set-up of the winding-order search, and choosing threads for a picture.
import type { FrameOptions } from "./frame.ts";
import { autoPalette, type GamutSummary } from "./gamut.ts";
import { linearToSrgb8 } from "./image.ts";
import { defaultBudget, maxMinSkip, maxResolution, modeDefaults, type Mode, type Project, type ThreadSpec } from "./project.ts";
import { hexToLinear, oklab, type Options, type RGB } from "./stringart.ts";

export interface Preset {
  id: string;
  mode: Mode;
  board: string;
  /** `name` is the last part of an i18n key "thread.<name>". Listed bottom to top (winding order). */
  threads: { name: string; hex: string }[];
}

/** §6.3's presets, plus "black + white": a white thread wound last restores the light areas the black lines
 * crossed (measured: contrast 0.26 -> 0.47 on the mono benchmark, at about three times the lines; D-12). */
export const PRESETS: readonly Preset[] = [
  { id: "mono-black", mode: "mono", board: "#FFFFFF", threads: [{ name: "black", hex: "#111111" }] },
  { id: "mono-white", mode: "mono", board: "#111111", threads: [{ name: "white", hex: "#F2F2F2" }] },
  { id: "mono-black-white", mode: "mono", board: "#FFFFFF", threads: [{ name: "black", hex: "#111111" }, { name: "white", hex: "#F2F2F2" }] },
  { id: "colour-cmyk", mode: "colour", board: "#FFFFFF", threads: [{ name: "yellow", hex: "#FFE000" }, { name: "cyan", hex: "#00A0E0" }, { name: "magenta", hex: "#E0007A" }, { name: "black", hex: "#111111" }] },
  { id: "colour-rgbw", mode: "colour", board: "#111111", threads: [{ name: "white", hex: "#F2F2F2" }, { name: "green", hex: "#1E9E3E" }, { name: "red", hex: "#D7261E" }, { name: "blue", hex: "#1F4FD1" }] },
];

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);

/** The preset a project's colours match (same mode, board and threads in order), or "custom". */
export function presetOf(p: Project): string {
  const match = PRESETS.find((s) => s.mode === p.mode && s.board === p.board && s.threads.length === p.threads.length && s.threads.every((t, i) => t.hex === p.threads[i]!.hex));
  return match ? match.id : "custom";
}

/** A project with the preset's colours. Changing between mono and colour also takes §3's defaults for that
 * mode (pins, resolution, minimum skip, budgets); within a mode the user's frame settings stay. */
export function applyPreset(p: Project, preset: Preset, name: (key: string) => string): Project {
  const d = modeDefaults(preset.mode), switched = preset.mode !== p.mode;
  const budget = switched ? defaultBudget(preset.mode, !!p.frame.inside) : (p.threads[0]?.maxLines ?? d.maxLines);
  const threads: ThreadSpec[] = preset.threads.map((t) => ({ name: name(`thread.${t.name}`), hex: t.hex, maxLines: budget }));
  const frame = switched ? { ...p.frame, pins: d.pins } : p.frame;
  const res = switched ? Math.min(d.res, Math.max(64, maxResolution(frame.diameterMm, p.thread.widthMm))) : p.generator.res;
  const generator = switched ? { ...p.generator, res, minSkip: Math.min(d.minSkip, maxMinSkip(frame.pins, frame.shape)) } : p.generator;
  return { ...p, mode: preset.mode, board: preset.board, threads, frame, generator };
}

/** OKLab lightness of a hex colour, 0..1. */
export const lightness = (hex: string): number => oklab(...hexToLinear(hex))[0];

/** §6.3's default order: lightest first, darkest last (a stable sort, so equal colours keep their order). */
export function defaultOrder<T extends { hex: string }>(threads: readonly T[]): T[] {
  return threads.map((t, i) => ({ t, i, l: lightness(t.hex) })).sort((a, b) => b.l - a.l || a.i - b.i).map((x) => x.t);
}

/** Codes of what §14 warns about in a palette. A thread of the board's colour is useless only at the bottom:
 * wound over other threads it covers them (DECISIONS D-17). */
export function paletteWarnings(p: Project): string[] {
  const out: string[] = [];
  if (p.threads[0]!.hex === p.board) out.push("thread-equals-board");
  if (new Set(p.threads.map((t) => t.hex)).size < p.threads.length) out.push("duplicate-thread");
  return out;
}

/** WCAG relative luminance and contrast ratio of two hex colours. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** §9: the thread colour is the accent, unless it lacks contrast (3:1) with the background; null then means
 * "use the theme's fallback" (#3A5BA0 on the light theme). */
export function accentFor(threadHex: string, backgroundHex: string): string | null {
  return contrastRatio(threadHex, backgroundHex) >= 3 ? threadHex : null;
}

/** Black or white, whichever reads better on the colour. */
export const textOn = (hex: string): string => (contrastRatio(hex, "#000000") >= contrastRatio(hex, "#FFFFFF") ? "#000000" : "#FFFFFF");

/** Every order of n items, as index lists. */
export function permutations(n: number): number[][] {
  if (n <= 1) return [Array.from({ length: n }, (_, i) => i)];
  const out: number[][] = [];
  const walk = (rest: number[], taken: number[]) => {
    if (!rest.length) { out.push(taken); return; }
    rest.forEach((x, i) => walk([...rest.slice(0, i), ...rest.slice(i + 1)], [...taken, x]));
  };
  walk(Array.from({ length: n }, (_, i) => i), []);
  return out;
}

/** The winding-order search is offered up to this many threads (§6.3: at most 24 orders). */
export const ORDER_SEARCH_MAX = 4;
/** How many of the proxy's best orders are run again at the real settings. */
export const ORDER_SEARCH_VERIFY = 3;

/**
 * The quick set-up the winding-order search uses to rank orders: 96 px and at most 96 pins, with the FULL line
 * budgets. On the colour benchmark this ranks the 24 orders like the real settings do (Spearman 0.985 and the
 * same winner); with budgets cut to 300 or 150 lines the ranking is unrelated (-0.15, -0.60), so the budgets
 * are never shortened (DECISIONS D-11).
 */
export function proxyOptions<T extends FrameOptions>(o: T): T {
  const res = Math.max(32, Math.min(96, o.res, maxResolution(o.diameterMm, o.threadWidthMm)));
  const pins = Math.max(Math.min(o.pins, 48), Math.min(o.pins, 96));
  const minSkip = Math.max(2, Math.min(maxMinSkip(pins, o.shape), Math.round((o.minSkip * pins) / o.pins)));
  if (!o.inside) return { ...o, res, pins, minSkip };
  // The quick set-up ranks orders on the frame alone: the pins inside the picture stand 6 mm apart, a pixel
  // here is 5 mm, and the best three orders are run again at the real settings with every pin (D-60).
  const { inside: _pins, pinDiameterMm: _thick, ...frame } = o;
  return { ...frame, res, pins, minSkip } as T;
}

/** `o` with its threads (and their budgets) in the given order. */
export function reorder<T extends Options>(o: T, order: readonly number[]): T {
  return { ...o, threads: order.map((i) => o.threads[i]!), maxLines: order.map((i) => o.maxLines[i]!) };
}

/** A linear-RGB colour as #RRGGBB. */
export const toHex = (c: Readonly<RGB>): string => `#${[c[0], c[1], c[2]].map((v) => linearToSrgb8(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

export interface Swatch { name: string; hex: string }

/** The "free colours" the auto palette may pick from (§6.3): the picture's own colour groups, largest first,
 * and a near-black and a near-white thread, which almost every picture can use. */
export function freeCandidates(gamut: GamutSummary): Swatch[] {
  const out: Swatch[] = [];
  for (const hex of [...gamut.clusters.map((c) => toHex(c.colour)), "#111111", "#F2F2F2"]) if (!out.some((s) => s.hex === hex)) out.push({ name: "", hex });
  return out;
}

/**
 * §6.3 "auto palette": up to `count` of the candidates, greedily those that bring what the board and threads
 * can mix closest to the picture's colour groups; in §6.3's default order, lightest first. A candidate of the
 * board's own colour is never picked (it adds nothing), nor one that no longer helps.
 */
export function pickPalette(gamut: GamutSummary, boardHex: string, candidates: readonly Swatch[], count: number): Swatch[] {
  const usable = candidates.filter((c, i) => c.hex !== boardHex && candidates.findIndex((d) => d.hex === c.hex) === i);
  const picked = autoPalette(gamut.clusters, hexToLinear(boardHex), usable.map((c) => hexToLinear(c.hex)), Math.max(0, Math.round(count)));
  return defaultOrder(picked.map((i) => usable[i]!));
}

/** Where a new thread of this colour goes in the winding order: before the first thread darker than it, which
 * keeps a palette that is in §6.3's default order in that order. */
export function placeByLightness(threads: readonly { hex: string }[], hex: string): number {
  const l = lightness(hex), at = threads.findIndex((t) => lightness(t.hex) < l);
  return at < 0 ? threads.length : at;
}
