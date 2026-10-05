// The automatic adjustment (DECISIONS D-55): the search over the sliders, what one setting is scored by, and
// the whole of it on a line drawing, the kind of picture it was made for.
import { describe, expect, it } from "vitest";
import {
  adjustOf, autoAdjust, evaluateTuning, NEUTRAL_TUNING, sameTuning, SLIDER, TUNE_VERIFY, TuningSearch, tuningOf, tuningProxy, withTuning,
  type TuneInput, type TuneJob, type Tuning,
} from "../../src/core/autoAdjust.ts";
import { emphasizedWeights } from "../../src/core/emphasis.ts";
import { runGreedy } from "../../src/core/greedy.ts";
import { adjustTarget, referencePicture } from "../../src/core/preprocess.ts";
import { defaultProject, LIMITS, NEUTRAL_ADJUST } from "../../src/core/project.ts";
import { measureTrueWidth } from "../../src/core/realistic.ts";
import { circleMask, type Options } from "../../src/core/stringart.ts";
import { lineDrawing } from "../helpers/pictures.ts";

const KEYS = Object.keys(SLIDER) as (keyof Tuning)[];
const neutral = (): Tuning => ({ ...NEUTRAL_TUNING });

/** A made-up landscape with one peak, so the search can be followed without generating anything. */
const PEAK: Tuning = { brightness: -0.1, contrast: 0.2, gamma: 1.4, saturation: 1.4, rangeCompression: 0.9, unsharp: 1, edges: 0.5, tone: 0.75 };
const hill = (t: Tuning): number =>
  1 - 2 * (t.brightness - PEAK.brightness) ** 2 - 0.5 * (t.contrast - PEAK.contrast) ** 2 - 0.3 * Math.log(t.gamma / PEAK.gamma) ** 2 - 0.2 * (t.saturation - PEAK.saturation) ** 2
  - (t.rangeCompression - PEAK.rangeCompression) ** 2 - 0.1 * (t.unsharp - PEAK.unsharp) ** 2 - 0.05 * (t.edges - PEAK.edges) ** 2 - 0.3 * (t.tone - PEAK.tone) ** 2;

/** Runs a search to its end with `score`, and returns every batch it asked for. */
function drive(search: TuningSearch, score: (t: Tuning) => number | null): Tuning[][] {
  const batches: Tuning[][] = [];
  for (let batch = search.next(); batch.length; batch = search.next()) {
    batches.push(batch);
    search.report(batch.map(score));
  }
  return batches;
}

describe("the sliders the search may set", () => {
  it("lie inside what a project file accepts, so a found setting is never clamped", () => {
    const limit: Record<keyof Tuning, readonly [number, number]> = {
      brightness: LIMITS.brightness, contrast: LIMITS.contrast, gamma: LIMITS.gamma, saturation: LIMITS.saturation, rangeCompression: LIMITS.rangeCompression,
      unsharp: LIMITS.unsharp, edges: LIMITS.edges, tone: LIMITS.tone,
    };
    for (const k of KEYS) {
      expect(SLIDER[k].min, k).toBeGreaterThanOrEqual(limit[k][0]);
      expect(SLIDER[k].max, k).toBeLessThanOrEqual(limit[k][1]);
      expect(NEUTRAL_TUNING[k], k).toBeGreaterThanOrEqual(SLIDER[k].min);
      expect(NEUTRAL_TUNING[k], k).toBeLessThanOrEqual(SLIDER[k].max);
    }
  });

  it("are read from a project and written back without touching anything else", () => {
    const p = defaultProject();
    p.adjust = { ...p.adjust, invert: true, gamma: 1.3 };
    p.importance = { preset: "quietRim", strokes: [{ w: 2, r: 0.05, pts: [0.5, 0.5] }], edges: 0.5, tone: 0.2 };
    expect(tuningOf(p)).toEqual({ ...NEUTRAL_TUNING, gamma: 1.3, edges: 0.5, tone: 0.2 });
    const q = withTuning(p, PEAK);
    expect(tuningOf(q)).toEqual(PEAK);
    expect(q.adjust.invert).toBe(true);
    expect([q.importance.preset, q.importance.strokes]).toEqual(["quietRim", p.importance.strokes]);
    expect({ ...q, adjust: p.adjust, importance: p.importance }).toEqual(p);
    // the neutral tuning is the neutral adjustment
    expect(adjustOf(NEUTRAL_TUNING, false)).toEqual(NEUTRAL_ADJUST);
  });
});

describe("the search", () => {
  it("climbs to the peak one slider at a time, within a fine step of it", () => {
    const search = new TuningSearch("colour", neutral());
    drive(search, hill);
    const best = search.best(1)[0]!;
    expect(Math.abs(best.tuning.brightness - PEAK.brightness)).toBeLessThanOrEqual(0.07);
    expect(Math.abs(best.tuning.contrast - PEAK.contrast)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(Math.log(best.tuning.gamma / PEAK.gamma))).toBeLessThanOrEqual(Math.log(1.19));
    expect(Math.abs(best.tuning.saturation - PEAK.saturation)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(best.tuning.rangeCompression - PEAK.rangeCompression)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(best.tuning.unsharp - PEAK.unsharp)).toBeLessThanOrEqual(0.25);
    expect(Math.abs(best.tuning.edges - PEAK.edges)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(best.tuning.tone - PEAK.tone)).toBeLessThanOrEqual(0.1);
    expect(best.score).toBeGreaterThan(hill(neutral()) + 0.3);
    expect(best.score).toBeGreaterThan(0.99);
  });

  it("hands out only settings the sliders can show, and none twice", () => {
    const search = new TuningSearch("colour", { ...NEUTRAL_TUNING, gamma: 1.234, brightness: 0.123, tone: 0.33 }), seen = new Set<string>();
    const batches = drive(search, hill);
    expect(batches[0]).toHaveLength(2); // the current settings and the neutral ones
    expect(batches[0]![0]).toEqual({ ...NEUTRAL_TUNING, gamma: 1.23, brightness: 0.12, tone: 0.35 }); // on the sliders' steps
    expect(batches[0]![1]).toEqual(NEUTRAL_TUNING);
    for (const t of batches.flat()) {
      for (const k of KEYS) {
        expect(t[k], k).toBeGreaterThanOrEqual(SLIDER[k].min);
        expect(t[k], k).toBeLessThanOrEqual(SLIDER[k].max);
        expect(Math.abs(t[k] / SLIDER[k].step - Math.round(t[k] / SLIDER[k].step)), k).toBeLessThan(1e-9);
      }
      const key = JSON.stringify(t);
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
    // after the first, a batch is the values of one slider: at most five, which suits the page's four workers
    for (const batch of batches.slice(1)) {
      expect(KEYS.filter((k) => new Set(batch.map((t) => t[k])).size > 1).length).toBeLessThanOrEqual(1);
      expect(batch.length).toBeLessThanOrEqual(5);
    }
    expect(seen.size).toBeLessThan(50);
  });

  it("leaves saturation alone in mono mode, and searches it in colour mode", () => {
    const start = { ...NEUTRAL_TUNING, saturation: 1.7 };
    const mono = drive(new TuningSearch("mono", start), hill).flat();
    expect(new Set(mono.map((t) => t.saturation))).toEqual(new Set([1.7]));
    const colour = drive(new TuningSearch("colour", start), hill).flat();
    expect(new Set(colour.map((t) => t.saturation)).size).toBeGreaterThan(3);
    expect(colour.length).toBeGreaterThan(mono.length);
  });

  it("starts from the current settings when they are better than neutral ones, and gives the same answer every time", () => {
    const near: Tuning = { ...PEAK, tone: 0.5 };
    const a = new TuningSearch("colour", near), b = new TuningSearch("colour", near);
    const first = drive(a, hill), second = drive(b, hill);
    expect(first).toEqual(second);
    expect(a.start()).toEqual(near);
    expect(a.scoreOf(near)).toBe(hill(near));
    expect(a.scoreOf(neutral())).toBe(hill(neutral()));
    // the first scan keeps everything but tone at the current values
    for (const t of first[1]!) expect({ ...t, tone: 0 }).toEqual({ ...near, tone: 0 });
    expect(a.best(1)[0]!.score).toBeGreaterThanOrEqual(hill(near));
    // the best settings, best first, without repeats
    const top = a.best(TUNE_VERIFY);
    expect(top).toHaveLength(TUNE_VERIFY);
    expect(top[0]!.score).toBeGreaterThanOrEqual(top[1]!.score);
    expect(top[1]!.score).toBeGreaterThanOrEqual(top[2]!.score);
    expect(sameTuning(top[0]!.tuning, top[1]!.tuning) || sameTuning(top[1]!.tuning, top[2]!.tuning)).toBe(false);
  });

  it("never prefers a run that failed, and wants every batch reported", () => {
    const search = new TuningSearch("mono", neutral());
    // everything darker than neutral fails to generate
    drive(search, (t) => (t.brightness < 0 ? null : hill(t)));
    expect(search.best(1)[0]!.tuning.brightness).toBeGreaterThanOrEqual(0);
    expect(search.best(1)[0]!.score).toBeGreaterThan(-Infinity);
    const other = new TuningSearch("mono", neutral()), batch = other.next();
    expect(() => other.next()).toThrow("not been reported");
    expect(() => other.report([])).toThrow(RangeError);
    other.report(batch.map(hill));
    expect(() => other.report([1])).toThrow(RangeError);
  });

  it("tells how far it is: the count only grows and ends at the total", () => {
    const search = new TuningSearch("colour", neutral());
    let last = search.progress();
    expect(last.done).toBe(0);
    expect(last.total).toBeGreaterThan(30);
    for (let batch = search.next(); batch.length; batch = search.next()) {
      search.report(batch.map(hill));
      const now = search.progress();
      expect(now.done).toBe(last.done + batch.length);
      expect(now.total).toBeGreaterThanOrEqual(now.done);
      expect(now.total).toBeLessThanOrEqual(last.total + 1);
      last = now;
    }
    expect(last.done).toBe(last.total);
    expect(search.next()).toEqual([]);
  });
});

describe("autoAdjust", () => {
  const scores = (f: (job: TuneJob) => number | null) => async (jobs: readonly TuneJob[]) => jobs.map(f);

  it("at the real settings throughout, takes the search's best", async () => {
    const jobs: TuneJob[] = [];
    const found = await autoAdjust("colour", neutral(), false, async (batch) => { jobs.push(...batch); return batch.map((j) => hill(j.tuning)); });
    expect(jobs.every((j) => j.real)).toBe(true);
    expect(found).toMatchObject({ changed: true, before: hill(neutral()), tried: jobs.length });
    expect(found!.after).toBe(hill(found!.tuning));
    expect(found!.after).toBeGreaterThan(0.99);
  });

  it("with a quick set-up, runs its best few and the current settings again at the real ones, and believes those", async () => {
    const batches: TuneJob[][] = [];
    // the real set-up disagrees with the quick one about the two best: it likes less tone
    const real = (t: Tuning) => hill(t) - 0.4 * t.tone;
    const found = await autoAdjust("mono", neutral(), true, async (batch) => { batches.push([...batch]); return batch.map((j) => (j.real ? real(j.tuning) : hill(j.tuning))); });
    const last = batches[batches.length - 1]!, before = batches.slice(0, -1).flat();
    expect(before.every((j) => !j.real)).toBe(true);
    expect(last.every((j) => j.real)).toBe(true);
    expect(last).toHaveLength(TUNE_VERIFY + 1);
    expect(last[0]!.tuning).toEqual(neutral()); // the current settings lead
    const best = last.map((j) => real(j.tuning)).reduce((a, b) => Math.max(a, b));
    expect(found).toMatchObject({ changed: true, before: real(neutral()), after: best, tried: batches.flat().length });
    expect(real(found!.tuning)).toBe(best);
  });

  it("keeps the current settings when nothing is clearly better", async () => {
    const top: Tuning = { ...NEUTRAL_TUNING, tone: 0.5 }, flat = (t: Tuning) => (sameTuning(t, top) ? 0.6 : 0.6 - 1e-5);
    const found = await autoAdjust("mono", top, false, scores((j) => flat(j.tuning)));
    expect(found).toMatchObject({ changed: false, tuning: top, before: 0.6, after: 0.6 });
    // the quick search may like something else; the real settings decide
    const kept = await autoAdjust("mono", neutral(), true, scores((j) => (j.real ? (sameTuning(j.tuning, neutral()) ? 0.5 : 0.4) : hill(j.tuning))));
    expect(kept).toMatchObject({ changed: false, tuning: neutral(), before: 0.5, after: 0.5 });
  });

  it("ends with nothing when it is stopped, during the search or during the final runs", async () => {
    let calls = 0;
    expect(await autoAdjust("mono", neutral(), true, async (jobs) => (++calls > 3 ? null : jobs.map((j) => hill(j.tuning))))).toBeNull();
    expect(calls).toBe(4);
    expect(await autoAdjust("mono", neutral(), true, async (jobs) => (jobs[0]!.real ? null : jobs.map((j) => hill(j.tuning))))).toBeNull();
  });

  it("reports its progress up to the end, and fails when no setting can be generated", async () => {
    const seen: [number, number][] = [];
    const found = await autoAdjust("mono", neutral(), true, scores((j) => hill(j.tuning)), (done, total) => seen.push([done, total]));
    expect(seen[0]![0]).toBe(0);
    for (let i = 1; i < seen.length; i++) expect(seen[i]![0]).toBeGreaterThan(seen[i - 1]![0]);
    for (const [done, total] of seen) expect(total).toBeGreaterThanOrEqual(done);
    expect(seen[seen.length - 1]).toEqual([found!.tried, found!.tried]);
    await expect(autoAdjust("mono", neutral(), true, scores(() => null))).rejects.toThrow("no setting");
    // a current setting that cannot be generated is replaced by one that can
    const rescued = await autoAdjust("mono", neutral(), false, scores((j) => (sameTuning(j.tuning, neutral()) ? null : hill(j.tuning))));
    expect(rescued).toMatchObject({ changed: true, before: -Infinity });
  });
});

describe("one setting, scored", () => {
  // a small frame with thick thread, so a run takes a few tens of milliseconds
  const o: Options = { res: 200, pins: 96, diameterMm: 500, threadWidthMm: 0.6, board: [1, 1, 1], threads: [[0, 0, 0]], maxLines: [1500], minSkip: 8, allowRepeat: false };
  const input = (options: Options, tuning: Tuning): TuneInput => ({ options, mode: "mono", picture: lineDrawing(options.res), painted: circleMask(options.res), invert: false, tuning });

  it("the quick set-up halves the working resolution, down to 160 pixels, and changes nothing else", () => {
    expect(tuningProxy({ ...o, res: 400 })).toEqual({ ...o, res: 200 });
    expect(tuningProxy({ ...o, res: 240 })).toEqual({ ...o, res: 160 });
    expect(tuningProxy({ ...o, res: 321 })).toEqual({ ...o, res: 161 });
    const small = { ...o, res: 160 }, tiny = { ...o, res: 96 };
    expect(tuningProxy(small)).toBe(small); // the same object: there is no quicker set-up
    expect(tuningProxy(tiny)).toBe(tiny);
  });

  it("is the similarity the result view shows for the piece those settings generate", () => {
    const tuning: Tuning = { ...NEUTRAL_TUNING, tone: 0.5, unsharp: 1, brightness: -0.05 }, palette = { mode: "mono" as const, board: o.board, threads: o.threads };
    const picture = lineDrawing(o.res), painted = circleMask(o.res);
    const target = adjustTarget(picture, o.res, adjustOf(tuning, false), palette), weight = emphasizedWeights(painted, target, o.res, tuning.edges, tuning.tone);
    const run = runGreedy(o, target, weight);
    const shown = measureTrueWidth(o, run.seq, target, weight, { reference: referencePicture(picture, o.res, false, palette), painted });
    const tuned = evaluateTuning(input(o, tuning));
    expect(tuned.lines).toEqual([run.lines]);
    expect(tuned.similarity).toBe(shown.similarity);
    expect(tuned.similarity).toBeGreaterThan(0.2);
    expect(tuned.similarity).toBeLessThan(0.8);
    // without the picture the measurement has no similarity to give
    expect(measureTrueWidth(o, run.seq, target, weight).similarity).toBeNull();
  });

  it("a line drawing at neutral settings gets a handful of lines; emphasis on its dark outlines gets it a piece", () => {
    const plain = evaluateTuning(input(o, neutral())), helped = evaluateTuning(input(o, { ...NEUTRAL_TUNING, tone: 1, unsharp: 1 }));
    expect(plain.lines[0]!).toBeLessThan(60);
    expect(helped.lines[0]!).toBeGreaterThan(5 * plain.lines[0]!);
    expect(helped.similarity).toBeGreaterThan(plain.similarity + 0.1);
    // inverted, the reference is the negative: the same piece is then far from it
    expect(evaluateTuning({ ...input(o, neutral()), invert: true }).similarity).not.toBe(plain.similarity);
  });

  it("the whole search on a line drawing: clearly closer to the picture, and the same every time", async () => {
    const small = tuningProxy(o);
    expect(small.res).toBe(160);
    let runs = 0;
    const run = async (jobs: readonly TuneJob[]) => jobs.map((job) => { runs++; return evaluateTuning(input(job.real ? o : small, job.tuning)).similarity; });
    const found = await autoAdjust("mono", neutral(), true, run);
    expect(found!.changed).toBe(true);
    expect(found!.before).toBe(evaluateTuning(input(o, neutral())).similarity);
    expect(found!.after).toBe(evaluateTuning(input(o, found!.tuning)).similarity);
    expect(found!.after).toBeGreaterThan(found!.before + 0.15);
    expect(found!.tried).toBe(runs);
    expect(runs).toBeLessThan(50);
    expect(await autoAdjust("mono", neutral(), true, run)).toEqual(found);
    // asked again from what it found, it does not make things worse
    const again = await autoAdjust("mono", found!.tuning, true, run);
    expect(again!.before).toBe(found!.after);
    expect(again!.after).toBeGreaterThanOrEqual(found!.after);
  });
});
