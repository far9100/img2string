// "Adjust automatically" (DECISIONS D-55): the sliders that shape the target (spec §6.4) and the automatic
// emphasis (§6.5) are set by trying them. A setting is judged by what it leads to: the piece is generated, drawn
// at true thread width and compared with the picture as it was before any adjustment (similarity.ts). Nothing
// here knows about workers: the search hands out batches of settings and takes their scores back, so the page
// can spread a batch over its workers and the tests can run it in Node.
import { emphasizedWeights } from "./emphasis.ts";
import { GreedyRun, type Extras } from "./greedy.ts";
import { adjustTarget, referencePicture } from "./preprocess.ts";
import type { Adjust, Mode, Project } from "./project.ts";
import { measureSubPixels } from "./realistic.ts";
import { inkOf, similarity } from "./similarity.ts";
import type { Options } from "./stringart.ts";
import { trueWidthComposite } from "./truewidth.ts";

/** The sliders the search sets: the adjustments of §6.4 but invert, and the two automatic emphases. */
export interface Tuning { brightness: number; contrast: number; gamma: number; saturation: number; rangeCompression: number; unsharp: number; edges: number; tone: number }

export const NEUTRAL_TUNING: Readonly<Tuning> = { brightness: 0, contrast: 0, gamma: 1, saturation: 1, rangeCompression: 1, unsharp: 0, edges: 0, tone: 0 };

/** The range and the step of each slider on the page; the search stays inside them, so what it finds can
 * always be shown and changed by hand. */
export const SLIDER: Readonly<Record<keyof Tuning, { min: number; max: number; step: number }>> = {
  brightness: { min: -0.5, max: 0.5, step: 0.01 },
  contrast: { min: -0.5, max: 1, step: 0.01 },
  gamma: { min: 0.4, max: 2.5, step: 0.01 },
  saturation: { min: 0, max: 2, step: 0.01 },
  rangeCompression: { min: 0.3, max: 1, step: 0.01 },
  unsharp: { min: 0, max: 1.5, step: 0.01 },
  edges: { min: 0, max: 2, step: 0.25 },
  tone: { min: 0, max: 1, step: 0.05 },
};

export const tuningOf = (p: Pick<Project, "adjust" | "importance">): Tuning => ({
  brightness: p.adjust.brightness, contrast: p.adjust.contrast, gamma: p.adjust.gamma, saturation: p.adjust.saturation,
  rangeCompression: p.adjust.rangeCompression, unsharp: p.adjust.unsharp, edges: p.importance.edges, tone: p.importance.tone,
});

/** The adjustments of a tuning; invert is the user's own choice and is never searched. */
export const adjustOf = (t: Tuning, invert: boolean): Adjust => ({
  brightness: t.brightness, contrast: t.contrast, gamma: t.gamma, rangeCompression: t.rangeCompression, saturation: t.saturation, unsharp: t.unsharp, invert,
});

/** The project with these sliders; its invert, importance preset and brush strokes stay. */
export function withTuning(p: Project, t: Tuning): Project {
  return { ...p, adjust: adjustOf(t, p.adjust.invert), importance: { ...p.importance, edges: t.edges, tone: t.tone } };
}

export const sameTuning = (a: Tuning, b: Tuning): boolean => (Object.keys(SLIDER) as (keyof Tuning)[]).every((k) => a[k] === b[k]);

// ---------- one setting, scored

export interface TuneInput {
  options: Options;
  mode: Mode;
  /** The picture through the crop, before any adjustment: 3 x res x res linear RGB. */
  picture: Float64Array;
  /** The importance map as painted (the preset and the brush; 0 outside the circle), without automatic emphasis. */
  painted: Float64Array;
  invert: boolean;
  tuning: Tuning;
}

export interface Tuned {
  /** similarity() of the piece at true thread width to the picture, counted by the painted importance. */
  similarity: number;
  lines: number[];
}

/** Generates with one setting and says how close the piece comes to the picture. */
export function evaluateTuning(input: TuneInput, extras?: Extras): Tuned {
  const { options: o, picture, painted, mode, invert, tuning } = input, palette = { mode, board: o.board, threads: o.threads };
  const target = adjustTarget(picture, o.res, adjustOf(tuning, invert), palette);
  const run = new GreedyRun(o, target, emphasizedWeights(painted, target, o.res, tuning.edges, tuning.tone), null, extras);
  while (run.step()) { /* to the end */ }
  const piece = trueWidthComposite(o, run.seq, measureSubPixels(o)), reference = referencePicture(picture, o.res, invert, palette);
  return { similarity: similarity(inkOf(piece, o.res, painted, o.board), inkOf(reference, o.res, painted, o.board)).value, lines: run.seq.map((s) => Math.max(0, s.length - 1)) };
}

/**
 * The quick set-up the search ranks settings with: half the working resolution, though not below 160 px;
 * the pins, the budgets and everything else as they are. On five test drawings and the face sample it ranks
 * settings like the real set-up does (Spearman 0.91 to 0.99) in about a quarter of the time, and the real
 * set-up's best was always among its best three; with half the pins as well it was not (D-55).
 */
export function tuningProxy(o: Options): Options {
  const res = Math.min(o.res, Math.max(160, Math.round(o.res / 2)));
  return res === o.res ? o : { ...o, res };
}

// ---------- the search

interface Scan { key: keyof Tuning; grid: readonly number[]; fine: number; ratio?: true; colour?: true }

/** One slider at a time, in this order: first these values across its range, then a finer step either side of
 * the best (a factor for gamma, whose scale is a ratio). Saturation only exists in colour mode. */
const SCANS: readonly Scan[] = [
  { key: "tone", grid: [0, 0.25, 0.5, 0.75, 1], fine: 0.1 },
  { key: "unsharp", grid: [0, 0.5, 1, 1.5], fine: 0.25 },
  { key: "brightness", grid: [-0.3, -0.15, 0, 0.15, 0.3], fine: 0.07 },
  { key: "gamma", grid: [0.5, 0.7, 1, 1.4, 2], fine: 1.19, ratio: true },
  { key: "contrast", grid: [-0.4, -0.2, 0, 0.3, 0.6], fine: 0.1 },
  { key: "saturation", grid: [0.6, 1, 1.4, 1.8], fine: 0.2, colour: true },
  { key: "edges", grid: [0, 1, 2], fine: 0.5 },
  { key: "rangeCompression", grid: [0.6, 0.8, 1], fine: 0.1 },
];
/** Passes over the sliders: the coarse one and the fine one. A third gains under 0.01 (D-55). */
const ROUNDS = 2;
/** A setting replaces the best one only if it is better by this much: the search does not chase noise. */
const GAIN = 5e-4;

const snap = (key: keyof Tuning, v: number): number => {
  const { min, max, step } = SLIDER[key];
  return Number((Math.round(Math.min(max, Math.max(min, v)) / step) * step).toFixed(4));
};
const keyOf = (t: Tuning): string => (Object.keys(SLIDER) as (keyof Tuning)[]).map((k) => t[k]).join(",");

export interface Scored { tuning: Tuning; score: number }

/**
 * A coordinate search with whole batches: next() gives the settings to score together (one slider's values, so
 * a batch fits the page's four workers), report() takes their scores. It starts from the better of the current
 * settings and the neutral ones, and every decision depends on the scores only, never on the order in which the
 * workers finished: the same picture gives the same answer.
 */
export class TuningSearch {
  private readonly scans: readonly Scan[];
  private readonly current: Tuning;
  private readonly neutral: Tuning;
  private readonly seen = new Map<string, number>();
  private readonly tried: Scored[] = [];
  private top: Scored | null = null;
  private pending: Tuning[] | null = null;
  private round = -1;
  private at = 0;

  constructor(mode: Mode, current: Tuning) {
    this.scans = SCANS.filter((s) => !s.colour || mode === "colour");
    this.current = this.snapped(current);
    // a slider that is not searched keeps the user's value
    this.neutral = this.snapped({ ...NEUTRAL_TUNING, ...(mode === "colour" ? {} : { saturation: current.saturation }) });
  }

  private snapped(t: Tuning): Tuning {
    const out = { ...t };
    for (const k of Object.keys(SLIDER) as (keyof Tuning)[]) out[k] = snap(k, t[k]);
    return out;
  }

  private values(scan: Scan): number[] {
    const at = this.top!.tuning[scan.key];
    if (this.round === 0) return [...scan.grid];
    const shrink = 2 ** (this.round - 1);
    return scan.ratio ? [at / scan.fine ** (1 / shrink), at * scan.fine ** (1 / shrink)] : [at - scan.fine / shrink, at + scan.fine / shrink];
  }

  /** The settings to score next, or none when the search is over. The scores of a batch must be reported
   * before the next one is asked for. */
  next(): Tuning[] {
    if (this.pending) throw new Error("the last batch has not been reported");
    let batch: Tuning[] = [];
    if (this.round < 0) batch = sameTuning(this.current, this.neutral) ? [this.current] : [this.current, this.neutral];
    while (!batch.length && this.round < ROUNDS) {
      if (this.at >= this.scans.length) { this.round++; this.at = 0; continue; }
      const scan = this.scans[this.at++]!, base = this.top!.tuning;
      for (const v of this.values(scan)) {
        const t = { ...base, [scan.key]: snap(scan.key, v) };
        if (!this.seen.has(keyOf(t)) && !batch.some((b) => sameTuning(b, t))) batch.push(t);
      }
    }
    this.pending = batch.length ? batch : null;
    return batch.map((t) => ({ ...t }));
  }

  /** The scores of the batch next() gave, in its order; null for a run that failed. */
  report(scores: readonly (number | null)[]): void {
    const batch = this.pending;
    if (!batch || scores.length !== batch.length) throw new RangeError("one score for each setting of the batch");
    this.pending = null;
    batch.forEach((tuning, i) => {
      const s = scores[i], score = typeof s === "number" && Number.isFinite(s) ? s : -Infinity;
      this.seen.set(keyOf(tuning), score);
      this.tried.push({ tuning, score });
      if (!this.top || score > this.top.score + GAIN) this.top = { tuning, score };
    });
    if (this.round < 0) { this.round = 0; this.at = 0; }
  }

  /** What a setting scored, if it was tried. */
  scoreOf(t: Tuning): number | undefined {
    return this.seen.get(keyOf(this.snapped(t)));
  }

  /** The settings the search started from, on the sliders' steps. */
  start(): Tuning {
    return { ...this.current };
  }

  /** The best `n` settings tried, best first; of equal ones the earlier. The search's own best leads. */
  best(n: number): Scored[] {
    const ranked = this.tried.map((s, i) => ({ s, i })).sort((a, b) => b.s.score - a.s.score || a.i - b.i).map((x) => x.s);
    const out = this.top ? [this.top, ...ranked.filter((s) => !sameTuning(s.tuning, this.top!.tuning))] : ranked;
    return out.slice(0, n).map((s) => ({ tuning: { ...s.tuning }, score: s.score }));
  }

  /** Settings scored so far, and about how many there will be in all: the values the remaining scans may
   * try. The count never runs ahead of the total, and they meet at the end. */
  progress(): { done: number; total: number } {
    let left = this.pending?.length ?? 0;
    if (this.round < 0 && !this.pending) left += 2;
    for (let round = Math.max(0, this.round), at = this.round < 0 ? 0 : this.at; round < ROUNDS; round++, at = 0) {
      for (let i = at; i < this.scans.length; i++) left += round === 0 ? this.scans[i]!.grid.length - 1 : 2;
    }
    return { done: this.tried.length, total: this.tried.length + left };
  }
}

// ---------- the whole of it

export interface TuneJob {
  tuning: Tuning;
  /** At the project's own settings rather than the quick ones. */
  real: boolean;
}

/** Scores a batch: the similarity of each setting (null where its run failed), or null when the search was stopped. */
export type TuneRunner = (jobs: readonly TuneJob[]) => Promise<(number | null)[] | null>;

/** How many of the quick search's best settings are run again at the real settings (as the winding-order search does). */
export const TUNE_VERIFY = 3;
/** New settings are taken only if they are better than the current ones by this much at the real settings. */
export const TUNE_MARGIN = 0.001;

export interface AutoAdjusted {
  /** The settings to use: the current ones when nothing tried was better. */
  tuning: Tuning;
  changed: boolean;
  /** Similarity at the real settings: of the current settings, and of `tuning`. */
  before: number;
  after: number;
  /** How many settings were generated. */
  tried: number;
}

/**
 * Searches the sliders with `run`. With `quick`, the search itself runs on the quick set-up (TuneJob.real is
 * false) and its best few are then scored at the real settings together with the current ones; otherwise
 * everything runs at the real settings. Resolves to null when `run` says the search was stopped.
 */
export async function autoAdjust(mode: Mode, current: Tuning, quick: boolean, run: TuneRunner, onProgress?: (done: number, total: number) => void): Promise<AutoAdjusted | null> {
  const search = new TuningSearch(mode, current), start = search.start(), extra = quick ? TUNE_VERIFY + 1 : 0;
  const tell = () => { const p = search.progress(); onProgress?.(p.done, p.total + extra); };
  tell();
  for (let batch = search.next(); batch.length; batch = search.next()) {
    const scores = await run(batch.map((tuning) => ({ tuning, real: !quick })));
    if (!scores) return null;
    search.report(scores);
    tell();
  }
  let candidates = search.best(TUNE_VERIFY).filter((s) => !sameTuning(s.tuning, start)), before = search.scoreOf(start) ?? -Infinity, tried = search.progress().done;
  if (quick) {
    const real = await run([start, ...candidates.map((s) => s.tuning)].map((tuning) => ({ tuning, real: true })));
    if (!real) return null;
    const value = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : -Infinity);
    before = value(real[0]);
    candidates = candidates.map((s, i) => ({ tuning: s.tuning, score: value(real[i + 1]) }));
    tried += real.length;
  }
  onProgress?.(tried, tried);
  let pick: Scored = { tuning: start, score: before };
  for (const c of candidates) if (c.score > pick.score + (pick.tuning === start ? TUNE_MARGIN : 0)) pick = c;
  if (pick.score === -Infinity) throw new Error("no setting could be generated");
  return { tuning: pick.tuning, changed: pick.tuning !== start, before, after: pick.score, tried };
}
