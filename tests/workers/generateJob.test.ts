// The generate worker's job, driven through a fake port: progress, stop, continue, replacing, scoring.
import { describe, expect, it } from "vitest";
import { evaluateTuning, NEUTRAL_TUNING, type TuneInput } from "../../src/core/autoAdjust.ts";
import { runGreedy } from "../../src/core/greedy.ts";
import { MAX_REPEAT } from "../../src/core/project.ts";
import { circleMask, hexToLinear, type Options } from "../../src/core/stringart.ts";
import { createGenerateJob, PROGRESS_EVERY, type JobPort } from "../../src/workers/generateJob.ts";
import type { FromGen, ToGen } from "../../src/workers/protocol.ts";
import { blobs, discAndBar, lineDrawing } from "../helpers/pictures.ts";

const o: Options = {
  res: 90, pins: 64, diameterMm: 500, threadWidthMm: 0.7, board: [1, 1, 1], threads: ["#FFE000", "#00A0E0", "#111111"].map(hexToLinear),
  maxLines: [140, 140, 140], minSkip: 6, allowRepeat: false,
};
const T = blobs(o.res, 21), W = circleMask(o.res);

/** A port whose pause() delivers the messages queued for the "worker", like the event loop does. */
function harness() {
  const out: FromGen[] = [], inbox: ToGen[] = [];
  let clock = 0, pauses = 0;
  const hooks: { onPause?: (n: number) => void } = {};
  const port: JobPort = {
    post: (m) => out.push(m),
    now: () => (clock += 30), // every look at the clock is 30 ms later, so the job pauses after every line
    pause: async () => {
      hooks.onPause?.(++pauses);
      while (inbox.length) handle(inbox.shift()!);
    },
  };
  const handle = createGenerateJob(port);
  const start = (id: number, resume: number[][] | null = null, preview = false) => handle({ t: "start", id, options: o, target: T.slice(), weight: W.slice(), resume, preview });
  const done = async (id: number) => {
    await expect.poll(() => out.some((m) => m.t === "done" && m.id === id), { timeout: 60_000, interval: 10 }).toBe(true);
    const m = out.find((x) => x.t === "done" && x.id === id)!;
    if (m.t !== "done") throw new Error("unreachable");
    return m;
  };
  return { out, inbox, hooks, handle, start, done };
}

describe("the generate job", () => {
  const whole = runGreedy(o, T, W);

  it("runs to the end like the stepper and reports why it ended", async () => {
    const h = harness();
    h.start(1, null, true);
    const done = await h.done(1);
    expect(done.sequences).toEqual(whole.seq);
    expect(done.error).toBe(whole.error());
    expect(done.reason).toBe(whole.outcome().reason);
    expect(done.rgba.length).toBe(4 * o.res * o.res);
    const progress = h.out.filter((m) => m.t === "progress");
    expect(progress.length).toBe(Math.floor(whole.lines / PROGRESS_EVERY));
    for (const m of progress) if (m.t === "progress") expect(m.rgba?.length).toBe(4 * o.res * o.res);
  });

  it("stops when asked, keeps what it has, and continues later to the same end", async () => {
    const h = harness();
    h.hooks.onPause = (n) => { if (n === 120) h.inbox.push({ t: "stop", id: 99 }); };
    h.start(1);
    const stopped = await h.done(1);
    expect(stopped.reason).toBe("stopped");
    const lines = stopped.sequences.reduce((n, s) => n + Math.max(0, s.length - 1), 0);
    expect(lines).toBeGreaterThan(50);
    expect(lines).toBeLessThan(whole.lines);
    stopped.sequences.forEach((s, k) => expect(whole.seq[k]!.slice(0, s.length)).toEqual(s));

    h.hooks.onPause = undefined;
    h.start(2, stopped.sequences);
    const finished = await h.done(2);
    expect(finished.sequences).toEqual(whole.seq);
    // a continued run reports only the lines added since: the page already has the rest
    const tails = h.out.filter((m) => m.t === "progress" && m.id === 2).reduce((n, m) => n + (m.t === "progress" ? m.tail.length / 2 : 0), 0);
    expect(tails).toBeLessThanOrEqual(whole.lines - lines);
  });

  it("a newer start ends the older run", async () => {
    const h = harness();
    h.hooks.onPause = (n) => { if (n === 30) h.inbox.push({ t: "start", id: 2, options: o, target: T.slice(), weight: W.slice(), resume: null, preview: false }); };
    h.start(1);
    expect((await h.done(1)).reason).toBe("stopped");
    h.hooks.onPause = undefined;
    expect((await h.done(2)).sequences).toEqual(whole.seq);
  });

  it("scores a set-up without progress messages (the winding-order search)", () => {
    const h = harness();
    h.handle({ t: "score", id: 5, options: o, target: T.slice(), weight: W.slice() });
    expect(h.out).toHaveLength(1);
    expect(h.out[0]).toMatchObject({ t: "scored", id: 5, error: whole.error(), initialError: whole.initialError, lines: whole.seq.map((s) => s.length - 1) });
  });

  it("with repeats allowed, no thread uses a pin pair more than three times (§13.5)", async () => {
    // a black disc and a bar: a picture dark enough for one black thread to want the same line again
    const h = harness(), repeating: Options = { ...o, threads: [[0, 0, 0]], maxLines: [400], allowRepeat: true }, dark = discAndBar(o.res);
    h.handle({ t: "start", id: 3, options: repeating, target: dark.slice(), weight: W.slice(), resume: null, preview: false });
    const done = await h.done(3);
    expect(done.sequences).toEqual(runGreedy(repeating, dark, W, null, { maxRepeat: MAX_REPEAT }).seq);
    const uses = new Map<number, number>(), s = done.sequences[0]!;
    for (let i = 1; i < s.length; i++) {
      const key = Math.min(s[i - 1]!, s[i]!) * o.pins + Math.max(s[i - 1]!, s[i]!);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
    expect(Math.max(...uses.values())).toBeGreaterThan(1); // repeats are used on this picture
    expect(Math.max(...uses.values())).toBeLessThanOrEqual(3);
    // the order search scores with the same rule
    h.handle({ t: "score", id: 4, options: repeating, target: dark.slice(), weight: W.slice() });
    expect(h.out.find((m) => m.t === "scored")).toMatchObject({ id: 4, error: done.error });
  });

  it("scores a setting of the sliders by how close its piece comes to the picture (the automatic adjustment)", () => {
    const h = harness(), mono: Options = { ...o, threads: [[0, 0, 0]], maxLines: [600], allowRepeat: true };
    const job: TuneInput = { options: mono, mode: "mono", picture: lineDrawing(o.res), painted: W.slice(), invert: false, tuning: { ...NEUTRAL_TUNING, tone: 1, unsharp: 1 } };
    h.handle({ t: "tune", id: 6, ...job, picture: job.picture.slice(), painted: job.painted.slice() });
    expect(h.out).toHaveLength(1);
    // the same run the page would generate with these settings: repeats are held to three here too
    const tuned = evaluateTuning(job, { maxRepeat: MAX_REPEAT });
    expect(h.out[0]).toMatchObject({ t: "tuned", id: 6, similarity: tuned.similarity, lines: tuned.lines });
    expect(tuned.similarity).toBeGreaterThan(0.1);
    expect(tuned.lines[0]!).toBeGreaterThan(50);
  });

  it("answers invalid settings with an error, not an exception", () => {
    const h = harness();
    h.handle({ t: "start", id: 7, options: { ...o, maxLines: [0, 10, 10] }, target: T.slice(), weight: W.slice(), resume: null, preview: false });
    h.handle({ t: "score", id: 8, options: { ...o, pins: 10 }, target: T.slice(), weight: W.slice() });
    h.handle({ t: "tune", id: 9, options: { ...o, pins: 10 }, mode: "colour", picture: T.slice(), painted: W.slice(), invert: false, tuning: { ...NEUTRAL_TUNING } });
    expect(h.out.map((m) => [m.t, m.id, m.t === "error" ? m.code : ""])).toEqual([["error", 7, "settings"], ["error", 8, "settings"], ["error", 9, "settings"]]);
  });
});
