// The page's side of the generate worker and the score pool, with fake workers (the real ones need a browser).
import { describe, expect, it, vi } from "vitest";
import { createGenerateClient, type GenWorker } from "../../src/app/generateClient.ts";
import { defaultPoolSize, ScorePool } from "../../src/app/orderPool.ts";
import { runGreedy } from "../../src/core/greedy.ts";
import { circleMask, hexToLinear, type Options } from "../../src/core/stringart.ts";
import { createGenerateJob } from "../../src/workers/generateJob.ts";
import type { FromGen, ToGen } from "../../src/workers/protocol.ts";
import { blobs } from "../helpers/pictures.ts";

const o: Options = {
  res: 80, pins: 60, diameterMm: 500, threadWidthMm: 0.8, board: [1, 1, 1], threads: ["#00A0E0", "#111111"].map(hexToLinear),
  maxLines: [130, 130], minSkip: 5, allowRepeat: false,
};
const T = blobs(o.res, 33), W = circleMask(o.res);
const whole = runGreedy(o, T, W);

/** A worker that runs the real job in this thread, with messages delivered as tasks like a real worker's. */
function fakeWorker(opts: { deaf?: boolean } = {}): GenWorker & { terminated: boolean } {
  const inbox: ToGen[] = [];
  let clock = 0;
  const w: GenWorker & { terminated: boolean } = {
    terminated: false,
    onmessage: null,
    onerror: null,
    terminate() { this.terminated = true; },
    postMessage(msg) {
      if (opts.deaf && msg.t === "stop") return; // a worker stuck in a long computation never sees the stop
      inbox.push(msg);
      setTimeout(() => { while (inbox.length) handle(inbox.shift()!); }, 0);
    },
  };
  const handle = createGenerateJob({
    post: (m: FromGen) => { if (!w.terminated) setTimeout(() => w.onmessage?.({ data: m } as MessageEvent<FromGen>), 0); },
    now: () => (clock += 30),
    pause: () => new Promise((r) => setTimeout(r, 0)),
  });
  return w;
}

describe("the generate client", () => {
  it("resolves with the worker's result and passes progress on", async () => {
    const client = createGenerateClient(() => fakeWorker());
    const seen: number[] = [];
    const done = await client.start(o, T, W, null, (p) => seen.push(p.lines.reduce((a, b) => a + b, 0)));
    expect(done.sequences).toEqual(whole.seq);
    expect(done.reason).toBe(whole.outcome().reason);
    expect(done.deltaE).not.toBeNull();
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.length).toBe(Math.floor(whole.lines / 100));
    expect(client.running()).toBe(false);
  });

  it("refuses a second run while one is going", async () => {
    const client = createGenerateClient(() => fakeWorker());
    const first = client.start(o, T, W, null);
    await expect(client.start(o, T, W, null)).rejects.toThrow("busy");
    await first;
  });

  it("stops a run that listens", async () => {
    const client = createGenerateClient(() => fakeWorker());
    const run = client.start(o, T, W, null, (p) => { if (p.lines.reduce((a, b) => a + b, 0) >= 100) client.stop(); });
    const done = await run;
    expect(done.reason).toBe("stopped");
    done.sequences.forEach((s, k) => expect(whole.seq[k]!.slice(0, s.length)).toEqual(s));
    // and it continues to the same end
    const rest = await client.start(o, T, W, done.sequences);
    expect(rest.sequences).toEqual(whole.seq);
  });

  it("replaces a worker that does not answer a stop, keeping the lines already reported", async () => {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    const client = createGenerateClient(() => { const w = fakeWorker({ deaf: true }); workers.push(w); return w; }, 20);
    let asked = false;
    const done = await client.start(o, T, W, null, (p) => {
      if (!asked && p.lines.reduce((a, b) => a + b, 0) >= 100) { asked = true; client.stop(); }
    });
    expect(done.reason).toBe("stopped");
    expect(done.rgba).toBeNull();
    expect(done.deltaE).toBeNull();
    expect(workers[0]!.terminated).toBe(true);
    const lines = done.sequences.reduce((n, s) => n + Math.max(0, s.length - 1), 0);
    expect(lines).toBeGreaterThanOrEqual(100);
    done.sequences.forEach((s, k) => {
      expect(s.length).not.toBe(1);
      expect(whole.seq[k]!.slice(0, s.length)).toEqual(s);
    });
    // a new worker is started for the next run
    expect((await client.start(o, T, W, done.sequences)).sequences).toEqual(whole.seq);
    expect(workers).toHaveLength(2);
  });

  it("reports invalid settings as an error", async () => {
    const client = createGenerateClient(() => fakeWorker());
    await expect(client.start({ ...o, maxLines: [0, 5] }, T, W, null)).rejects.toMatchObject({ code: "settings" });
    expect(client.running()).toBe(false);
  });
});

describe("the score pool", () => {
  const jobs = [[0, 1], [1, 0]].map((order) => ({ options: { ...o, threads: order.map((i) => o.threads[i]!), maxLines: order.map((i) => o.maxLines[i]!) }, target: T, weight: W }));

  it("uses one core less than the machine has, four at most", () => {
    expect([1, 2, 4, 8, 16, 0].map(defaultPoolSize)).toEqual([1, 1, 3, 4, 4, 1]);
  });

  it("scores every job, in order, on as many workers as it was given", async () => {
    const made: GenWorker[] = [];
    const pool = new ScorePool(() => { const w = fakeWorker(); made.push(w); return w; }, 2);
    const seen = vi.fn();
    const scores = await pool.run(jobs, seen);
    expect(made).toHaveLength(2);
    expect(scores[0]).toMatchObject({ error: whole.error(), initialError: whole.initialError });
    expect(scores[1]!.error).not.toBe(scores[0]!.error);
    expect(seen).toHaveBeenCalledTimes(2);
    // the workers are kept for the next run
    await pool.run(jobs.slice(0, 1));
    expect(made).toHaveLength(2);
  });

  it("stop ends the run with what is there and terminates the workers", async () => {
    const made: ReturnType<typeof fakeWorker>[] = [];
    const pool = new ScorePool(() => { const w = fakeWorker(); made.push(w); return w; }, 1);
    const run = pool.run([...jobs, ...jobs]);
    pool.stop();
    const scores = await run;
    expect(scores).toEqual([null, null, null, null]);
    expect(made.every((w) => w.terminated)).toBe(true);
    expect(await pool.run([])).toEqual([]);
  });
});
