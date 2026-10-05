// The project model (spec §11): everything a piece is made from and, once generated, its winding sequences.
// A project file is read only through normalizeProject (missing fields take defaults, numbers are clamped,
// unknown fields are dropped) and written only by serializeProject (fixed key order), so the same project is
// always the same text. Pattern after img2shadow's core/params.ts. Extensions to §11 are in DECISIONS D-30.
import { hexToLinear, type Options } from "./stringart.ts";
import { isSampleId, type SampleId } from "./targets.ts";

export type Mode = "mono" | "colour";
export const PAPERS = ["A4", "A3", "Letter"] as const;
export type Paper = (typeof PAPERS)[number];

/** Where the pin circle sits on the picture: cx, cy are fractions of its width and height; at scale 1 the
 * circle's diameter is the picture's short side; rotateDeg turns the picture clockwise on screen. */
export interface Crop { cx: number; cy: number; scale: number; rotateDeg: number }

export interface Adjust { brightness: number; contrast: number; gamma: number; rangeCompression: number; saturation: number; unsharp: number; invert: boolean }

/** One brush stroke of the importance map, in picture coordinates so it follows the picture when the crop
 * changes: weight w (0..3), radius r as a fraction of the picture's short side, points x0, y0, x1, y1, ...
 * as fractions of the picture's width and height. Later strokes paint over earlier ones. */
export interface Stroke { w: number; r: number; pts: number[] }

export const IMPORTANCE_PRESETS = ["none", "quietRim"] as const;
export type ImportancePreset = (typeof IMPORTANCE_PRESETS)[number];

export interface ImageRef {
  name: string;
  /** SHA-256 of the file's bytes, or "sample:<id>" for a built-in sample. */
  sha256: string;
  sample: SampleId | null;
  width: number;
  height: number;
  crop: Crop;
  /** The picture itself as a data: URL, when the user chose to embed it. */
  embedded: string | null;
}

export interface ThreadSpec { name: string; hex: string; maxLines: number }

export const STOP_REASONS = ["converged", "budget", "stopped", "empty"] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export interface Result {
  /** generationKey() of the project this result was made from: a different key means the result is stale. */
  key: string;
  /** One pin sequence per thread, 0-based pins, in winding order. */
  sequences: number[][];
  lines: number[];
  errorReduction: number;
  meanDeltaEOk: number;
  reason: StopReason;
}

export interface Project {
  version: 1;
  mode: Mode;
  image: ImageRef;
  adjust: Adjust;
  importance: { preset: ImportancePreset; strokes: Stroke[] };
  frame: { shape: "circle"; diameterMm: number; pins: number; pinDiameterMm: number };
  thread: { widthMm: number };
  board: string;
  threads: ThreadSpec[];
  generator: { res: number; minSkip: number; allowRepeat: boolean };
  result: Result | null;
  player: { secondsPerLine: number; step: number };
  paper: Paper;
}

export const LIMITS = {
  diameterMm: [200, 1000], pins: [64, 512], pinDiameterMm: [0.5, 5], widthMm: [0.05, 2], res: [64, 1200], maxLines: [1, 20000],
  threads: 6, scale: [0.2, 20], brightness: [-1, 1], contrast: [-1, 1], gamma: [0.2, 5], rangeCompression: [0.1, 1], saturation: [0, 3], unsharp: [0, 2],
  strokeWeight: [0, 3], strokeRadius: [0.002, 0.5], strokes: 4000, strokePoints: 4000, secondsPerLine: [1, 120], nameLength: 40,
} as const;

/** With generator.allowRepeat, how often one thread may use the same pin pair (§3 "Repeats", §13.5). */
export const MAX_REPEAT = 3;

export const NEUTRAL_ADJUST: Adjust ={ brightness: 0, contrast: 0, gamma: 1, rangeCompression: 1, saturation: 1, unsharp: 0, invert: false };
export const IDENTITY_CROP: Crop = { cx: 0.5, cy: 0.5, scale: 1, rotateDeg: 0 };

/** §3's defaults for a mode. */
export function modeDefaults(mode: Mode): { pins: number; res: number; minSkip: number; maxLines: number } {
  return mode === "mono" ? { pins: 256, res: 400, minSkip: 20, maxLines: 4000 } : { pins: 200, res: 240, minSkip: 15, maxLines: 1500 };
}

export function defaultProject(): Project {
  const d = modeDefaults("mono");
  return {
    version: 1,
    mode: "mono",
    image: { name: "sample-face", sha256: "sample:face", sample: "face", width: d.res, height: d.res, crop: { ...IDENTITY_CROP }, embedded: null },
    adjust: { ...NEUTRAL_ADJUST },
    importance: { preset: "none", strokes: [] },
    frame: { shape: "circle", diameterMm: 500, pins: d.pins, pinDiameterMm: 1.5 },
    thread: { widthMm: 0.25 },
    board: "#FFFFFF",
    threads: [{ name: "black", hex: "#111111", maxLines: d.maxLines }],
    generator: { res: d.res, minSkip: d.minSkip, allowRepeat: false },
    result: null,
    player: { secondsPerLine: 8, step: 0 },
    paper: "A4",
  };
}

export const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
export const normalHex = (v: string): string => v.toUpperCase();

/** The highest working resolution that keeps alpha = thread width / pixel size at or below 0.5 (§3). §14 says
 * to raise the resolution when alpha is too large, but alpha grows with it (DECISIONS D-16). */
export function maxResolution(diameterMm: number, threadWidthMm: number): number {
  return Math.floor((0.5 * diameterMm) / threadWidthMm) + 1;
}

/** The largest minimum skip a frame allows: §14 needs at least 2 x minSkip + 1 pins. */
export const maxMinSkip = (pins: number): number => Math.floor((pins - 1) / 2);

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});

export interface Normalized {
  project: Project;
  /** Codes of what had to be changed while reading (shown as "issue.<code>"). */
  issues: string[];
}

/** Reads anything into a valid project. */
export function normalizeProject(raw: unknown): Normalized {
  const issues = new Set<string>();
  const src = rec(raw), def = defaultProject();
  const num = (v: unknown, lo: number, hi: number, fallback: number, code: string, integer = false): number => {
    let x = typeof v === "number" && Number.isFinite(v) ? v : fallback;
    if (v !== undefined && x !== v) issues.add(code);
    if (integer && !Number.isInteger(x)) { x = Math.round(x); issues.add(code); }
    if (x < lo || x > hi) { x = Math.min(hi, Math.max(lo, x)); issues.add(code); }
    return x;
  };
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
  const text = (v: unknown, fallback: string, max: number): string => (typeof v === "string" ? v.slice(0, max) : fallback);
  const hex = (v: unknown, fallback: string, code: string): string => {
    if (isHex(v)) return normalHex(v);
    if (v !== undefined) issues.add(code);
    return fallback;
  };

  if (src.version !== undefined && src.version !== 1) issues.add("project-version");

  const threadsRaw = Array.isArray(src.threads) ? src.threads : [];
  const mode: Mode = src.mode === "mono" || src.mode === "colour" ? src.mode : threadsRaw.length > 1 ? "colour" : "mono";
  const md = modeDefaults(mode);

  const fr = rec(src.frame);
  if (fr.shape !== undefined && fr.shape !== "circle") issues.add("frame-shape");
  const frame: Project["frame"] = {
    shape: "circle",
    diameterMm: num(fr.diameterMm, LIMITS.diameterMm[0], LIMITS.diameterMm[1], def.frame.diameterMm, "frame"),
    pins: num(fr.pins, LIMITS.pins[0], LIMITS.pins[1], md.pins, "frame", true),
    pinDiameterMm: num(fr.pinDiameterMm, LIMITS.pinDiameterMm[0], LIMITS.pinDiameterMm[1], def.frame.pinDiameterMm, "frame"),
  };
  const thread = { widthMm: num(rec(src.thread).widthMm, LIMITS.widthMm[0], LIMITS.widthMm[1], def.thread.widthMm, "thread") };

  if (threadsRaw.length > LIMITS.threads) issues.add("threads-count");
  const threads: ThreadSpec[] = threadsRaw.slice(0, LIMITS.threads).map((t, i) => {
    const r = rec(t);
    return {
      name: text(r.name, `thread ${i + 1}`, LIMITS.nameLength),
      hex: hex(r.hex, "#111111", "thread-colour"),
      maxLines: num(r.maxLines, LIMITS.maxLines[0], LIMITS.maxLines[1], md.maxLines, "budget", true),
    };
  });
  if (!threads.length) threads.push({ name: "black", hex: "#111111", maxLines: md.maxLines });

  const gen = rec(src.generator);
  let res = num(gen.res, LIMITS.res[0], LIMITS.res[1], md.res, "generator", true);
  const resCap = maxResolution(frame.diameterMm, thread.widthMm);
  if (res > resCap) { res = Math.max(LIMITS.res[0], resCap); issues.add("alpha"); }
  const generator: Project["generator"] = {
    res,
    minSkip: num(gen.minSkip, 1, maxMinSkip(frame.pins), Math.min(md.minSkip, maxMinSkip(frame.pins)), "min-skip", true),
    allowRepeat: bool(gen.allowRepeat, false),
  };

  const im = rec(src.image), cr = rec(im.crop);
  const sample = isSampleId(im.sample) ? im.sample : null;
  const image: ImageRef = {
    name: text(im.name, sample ? `sample-${sample}` : "", 200),
    sha256: sample ? `sample:${sample}` : text(im.sha256, "", 80),
    sample,
    width: num(im.width, 0, 1e6, 0, "image", true),
    height: num(im.height, 0, 1e6, 0, "image", true),
    crop: {
      cx: num(cr.cx, 0, 1, 0.5, "crop"),
      cy: num(cr.cy, 0, 1, 0.5, "crop"),
      scale: num(cr.scale, LIMITS.scale[0], LIMITS.scale[1], 1, "crop"),
      rotateDeg: num(cr.rotateDeg, -360, 360, 0, "crop"),
    },
    embedded: typeof im.embedded === "string" && im.embedded.startsWith("data:image/") ? im.embedded : null,
  };

  const ad = rec(src.adjust);
  const adjust: Adjust = {
    brightness: num(ad.brightness, LIMITS.brightness[0], LIMITS.brightness[1], 0, "adjust"),
    contrast: num(ad.contrast, LIMITS.contrast[0], LIMITS.contrast[1], 0, "adjust"),
    gamma: num(ad.gamma, LIMITS.gamma[0], LIMITS.gamma[1], 1, "adjust"),
    rangeCompression: num(ad.rangeCompression, LIMITS.rangeCompression[0], LIMITS.rangeCompression[1], 1, "adjust"),
    saturation: num(ad.saturation, LIMITS.saturation[0], LIMITS.saturation[1], 1, "adjust"),
    unsharp: num(ad.unsharp, LIMITS.unsharp[0], LIMITS.unsharp[1], 0, "adjust"),
    invert: bool(ad.invert, false),
  };

  const ip = rec(src.importance);
  if (ip.brushPng !== undefined && ip.brushPng !== null) issues.add("brush-png"); // §11's brushPng is not used (D-28)
  const strokesRaw = Array.isArray(ip.strokes) ? ip.strokes : [];
  if (strokesRaw.length > LIMITS.strokes) issues.add("importance");
  const strokes: Stroke[] = [];
  for (const s of strokesRaw.slice(0, LIMITS.strokes)) {
    const r = rec(s), pts = Array.isArray(r.pts) ? r.pts.filter((v): v is number => typeof v === "number" && Number.isFinite(v)) : [];
    if (pts.length < 2 || pts.length % 2 || pts.length !== (Array.isArray(r.pts) ? r.pts.length : 0)) { issues.add("importance"); continue; }
    strokes.push({
      w: num(r.w, LIMITS.strokeWeight[0], LIMITS.strokeWeight[1], 1, "importance"),
      r: num(r.r, LIMITS.strokeRadius[0], LIMITS.strokeRadius[1], 0.04, "importance"),
      pts: pts.slice(0, 2 * LIMITS.strokePoints),
    });
  }
  const preset: ImportancePreset = (IMPORTANCE_PRESETS as readonly unknown[]).includes(ip.preset) ? (ip.preset as ImportancePreset) : "none";

  const pl = rec(src.player);
  const project: Project = {
    version: 1,
    mode,
    image,
    adjust,
    importance: { preset, strokes },
    frame,
    thread,
    board: hex(src.board, "#FFFFFF", "board-colour"),
    threads,
    generator,
    result: null,
    player: { secondsPerLine: num(pl.secondsPerLine, LIMITS.secondsPerLine[0], LIMITS.secondsPerLine[1], 8, "player"), step: num(pl.step, 0, 1e7, 0, "player", true) },
    paper: (PAPERS as readonly unknown[]).includes(src.paper) ? (src.paper as Paper) : "A4",
  };

  const result = normalizeResult(src.result, project);
  if (src.result !== undefined && src.result !== null && !result) issues.add("result");
  project.result = result;
  const steps = result ? result.lines.reduce((a, b) => a + b, 0) : 0;
  if (project.player.step > steps) project.player.step = steps;
  return { project, issues: [...issues] };
}

/** A stored result is kept only if every sequence could have been generated for this project. */
function normalizeResult(raw: unknown, p: Project): Result | null {
  const r = rec(raw);
  if (!Array.isArray(r.sequences) || r.sequences.length !== p.threads.length) return null;
  const N = p.frame.pins, sequences: number[][] = [];
  for (const s of r.sequences) {
    if (!Array.isArray(s) || s.length === 1) return null;
    for (let i = 0; i < s.length; i++) {
      const v: unknown = s[i];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= N) return null;
      if (i > 0) {
        const d = Math.abs(v - (s[i - 1] as number)) % N;
        if (Math.min(d, N - d) < p.generator.minSkip) return null;
      }
    }
    sequences.push(s.slice() as number[]);
  }
  const reason = (STOP_REASONS as readonly unknown[]).includes(r.reason) ? (r.reason as StopReason) : "stopped";
  const finite = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    key: typeof r.key === "string" ? r.key : "",
    sequences,
    lines: sequences.map((s) => Math.max(0, s.length - 1)),
    errorReduction: finite(r.errorReduction),
    meanDeltaEOk: finite(r.meanDeltaEOk),
    reason,
  };
}

const round = (v: number, digits: number): number => Number(v.toFixed(digits));

/** The project as text: fixed key order, two-space indent, number lists on one line, a final newline. */
export function serializeProject(p: Project): string {
  const out = {
    version: 1,
    mode: p.mode,
    image: {
      name: p.image.name, sha256: p.image.sha256, sample: p.image.sample, width: p.image.width, height: p.image.height,
      crop: { cx: round(p.image.crop.cx, 6), cy: round(p.image.crop.cy, 6), scale: round(p.image.crop.scale, 6), rotateDeg: round(p.image.crop.rotateDeg, 4) },
      embedded: p.image.embedded,
    },
    adjust: {
      brightness: p.adjust.brightness, contrast: p.adjust.contrast, gamma: p.adjust.gamma, rangeCompression: p.adjust.rangeCompression,
      saturation: p.adjust.saturation, unsharp: p.adjust.unsharp, invert: p.adjust.invert,
    },
    importance: { preset: p.importance.preset, strokes: p.importance.strokes.map((s) => ({ w: s.w, r: round(s.r, 5), pts: s.pts.map((v) => round(v, 5)) })) },
    frame: { shape: "circle", diameterMm: p.frame.diameterMm, pins: p.frame.pins, pinDiameterMm: p.frame.pinDiameterMm },
    thread: { widthMm: p.thread.widthMm },
    board: p.board,
    threads: p.threads.map((t) => ({ name: t.name, hex: t.hex, maxLines: t.maxLines })),
    generator: { res: p.generator.res, minSkip: p.generator.minSkip, allowRepeat: p.generator.allowRepeat },
    result: p.result && {
      key: p.result.key, sequences: p.result.sequences, lines: p.result.lines,
      errorReduction: round(p.result.errorReduction, 6), meanDeltaEOk: round(p.result.meanDeltaEOk, 4), reason: p.result.reason,
    },
    player: { secondsPerLine: p.player.secondsPerLine, step: p.player.step },
    paper: p.paper,
  };
  const text = JSON.stringify(out, null, 2);
  // lists of numbers on one line: sequences and stroke points would otherwise take a line per number
  return text.replace(/\[\s*(-?\d[\d.eE+-]*(?:,\s*-?\d[\d.eE+-]*)*)\s*\]/g, (_m, body: string) => `[${body.replace(/\s+/g, " ")}]`) + "\n";
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Rec;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

/** Everything the target picture and the importance map depend on. */
export function targetKey(p: Project): string {
  return stableStringify({
    mode: p.mode, sha: p.image.sha256, crop: p.image.crop, adjust: p.adjust, importance: p.importance, res: p.generator.res,
    board: p.board, threads: p.threads.map((t) => t.hex),
  });
}

/** Everything a generated result depends on: a result whose key differs from this is stale (it is kept, never
 * replaced silently: someone may be hours into winding it). Names, the player and the paper do not count. */
export function generationKey(p: Project): string {
  return stableStringify({
    target: targetKey(p), diameterMm: p.frame.diameterMm, pins: p.frame.pins, widthMm: p.thread.widthMm,
    budgets: p.threads.map((t) => t.maxLines), generator: p.generator,
  });
}

/** The §12 options of a project. */
export function toOptions(p: Project): Options {
  return {
    res: p.generator.res, pins: p.frame.pins, diameterMm: p.frame.diameterMm, threadWidthMm: p.thread.widthMm,
    board: hexToLinear(p.board), threads: p.threads.map((t) => hexToLinear(t.hex)), maxLines: p.threads.map((t) => t.maxLines),
    minSkip: p.generator.minSkip, allowRepeat: p.generator.allowRepeat,
  };
}
