// The generate worker's job on a piece with pins inside the picture (DECISIONS D-60), through a fake port:
// what it posts lets the page keep the whole sequence, steps round the frame included; a stop never falls
// inside a trip, and a stopped run continues from its sequence; the runs that only score see the pins too.
import { describe, expect, it } from "vitest";
import { evaluateTuning, NEUTRAL_TUNING, type TuneInput } from "../../src/core/autoAdjust.ts";
import { allowedPairs, frameMask, isRound, pinCount, pinOf, type FrameOptions } from "../../src/core/frame.ts";
import { replayModel, runGreedy } from "../../src/core/greedy.ts";
import { placeInside, placeRes } from "../../src/core/inside.ts";
import { createGenerateJob, PROGRESS_EVERY, type JobPort } from "../../src/workers/generateJob.ts";
import type { FromGen, ToGen } from "../../src/workers/protocol.ts";
import { lineDrawing } from "../helpers/pictures.ts";

const at = placeRes(200);
const inside = placeInside(lineDrawing(at, 2), frameMask({ res: at }), { res: at, board: [1, 1, 1], diameterMm: 200, pinDiameterMm: 1.5 }, 40);
const o: FrameOptions = { res: 96, pins: 64, diameterMm: 200, threadWidthMm: 0.5, board: [1, 1, 1], threads: [[0, 0, 0]], maxLines: [3000], minSkip: 6, allowRepeat: false, inside, pinDiameterMm: 1.5 };
const T = lineDrawing(o.res, 1.5), W = frameMask(o), whole = runGreedy(o, T, W);

function harness() {
  const out: FromGen[] = [], inbox: ToGen[] = [];
  let clock = 0, pauses = 0;
  const hooks: { onPause?: (n: number) => void } = {};
  const port: JobPort = {
    post: (m) => out.push(m),
    now: () => (clock += 30), // every look at the clock is 30 ms later, so the job pauses after every step
    pause: async () => {
      hooks.onPause?.(++pauses);
      while (inbox.length) handle(inbox.shift()!);
    },
  };
  const handle = createGenerateJob(port);
  const start = (id: number, resume: number[][] | null = null) => handle({ t: "start", id, options: o, target: T.slice(), weight: W.slice(), resume, preview: false });
  const done = async (id: number) => {
    await expect.poll(() => out.some((m) => m.t === "done" && m.id === id), { timeout: 60_000, interval: 10 }).toBe(true);
    const m = out.find((x) => x.t === "done" && x.id === id)!;
    if (m.t !== "done") throw new Error("unreachable");
    return m;
  };
  return { out, inbox, hooks, handle, start, done };
}

/** Every step a line the pins allow, or a way round the frame between two of the frame's pins. */
function valid(sequence: readonly number[]): void {
  const N = pinCount(o), ok = allowedPairs(o);
  for (let i = 1; i < sequence.length; i++) {
    const u = pinOf(sequence[i - 1]!), v = pinOf(sequence[i]!);
    if (isRound(sequence[i]!)) expect(u < o.pins && v < o.pins).toBe(true);
    else expect(ok[u * N + v]).toBe(1);
  }
}

describe("the generate job with pins inside the picture", () => {
  it("runs to the stepper's end, and its progress lets the page keep every step, those round the frame too", async () => {
    const h = harness();
    h.start(1);
    const done = await h.done(1);
    expect(done.sequences).toEqual(whole.seq);
    expect(done.sequences[0]!.some(isRound)).toBe(true);
    expect(done.error).toBe(whole.error());
    expect(done.reason).toBe("converged");
    // the page's copy, built from the tails as the client builds it
    const kept: number[] = [];
    for (const m of h.out) if (m.t === "progress") for (let i = 0; i < m.tail.length; i += 2) kept.push(m.tail[i + 1]!);
    expect(kept.length).toBeGreaterThanOrEqual(PROGRESS_EVERY);
    expect(kept).toEqual(whole.seq[0]!.slice(0, kept.length));
    expect(kept.some(isRound)).toBe(true);
  });

  it("stops between two steps, never inside a trip, and goes on from what it has", async () => {
    // a step may be a whole trip, so there are fewer steps than pins in the sequence: stop well before the end
    for (const pause of [3, Math.floor(whole.lines / 4), Math.floor(whole.lines / 2)]) {
      const h = harness();
      h.hooks.onPause = (n) => { if (n === pause) h.inbox.push({ t: "stop", id: 99 }); };
      h.start(1);
      const stopped = await h.done(1), s = stopped.sequences[0]!;
      expect(stopped.reason).toBe("stopped");
      expect(s.length).toBeGreaterThan(pause);
      expect(s.length).toBeLessThan(whole.seq[0]!.length);
      // a trip ends with the line it was made for: a piece never ends on a step that draws nothing
      expect(isRound(s.at(-1)!)).toBe(false);
      valid(s);
      expect(replayModel(o, T, W, stopped.sequences).error()).toBe(stopped.error);
      h.hooks.onPause = undefined;
      h.start(2, stopped.sequences);
      const finished = await h.done(2), f = finished.sequences[0]!;
      expect(f.slice(0, s.length)).toEqual(s);
      expect(f.length).toBeGreaterThan(s.length);
      valid(f);
      expect(finished.error).toBeLessThan(stopped.error);
      expect(finished.reason).toBe("converged");
    }
  });

  it("answers a piece it cannot stand on with an error the page can show, not with silence", async () => {
    const h = harness(), off = { ...o, inside: [0.5, 0.5, 1.2, 0.5] };
    h.handle({ t: "start", id: 3, options: off, target: T.slice(), weight: W.slice(), resume: null, preview: false });
    await expect.poll(() => h.out.length, { timeout: 10_000, interval: 10 }).toBe(1);
    expect(h.out[0]).toMatchObject({ t: "error", id: 3, code: "settings" });
    // a sequence that walks round the frame to a pin inside the picture is no piece either
    const h2 = harness();
    h2.start(4, [[0, -(o.pins + 1) - 1]]);
    await expect.poll(() => h2.out.length, { timeout: 10_000, interval: 10 }).toBe(1);
    expect(h2.out[0]).toMatchObject({ t: "error", id: 4, code: "settings" });
  });

  it("scores an order and a setting on the same pins", () => {
    const h = harness();
    h.handle({ t: "score", id: 5, options: o, target: T.slice(), weight: W.slice() });
    const scored = h.out.find((m) => m.t === "scored");
    expect(scored).toMatchObject({ error: whole.error(), lines: [whole.lines] });
    const job: TuneInput = { options: o, mode: "mono", picture: T, painted: W, invert: false, tuning: { ...NEUTRAL_TUNING } };
    h.handle({ t: "tune", id: 6, ...job, picture: T.slice(), painted: W.slice() });
    const tuned = h.out.find((m) => m.t === "tuned"), direct = evaluateTuning(job);
    expect(tuned).toMatchObject({ similarity: direct.similarity, lines: direct.lines });
    // the pins inside count for it: the same setting on the frame alone is another piece
    const { inside: _pins, pinDiameterMm: _thick, ...frame } = o;
    expect(evaluateTuning({ ...job, options: frame }).similarity).toBeLessThan(direct.similarity);
  });
});
