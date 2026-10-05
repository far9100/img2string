// M1 (spec §13.4), the part a unit test can hold: on both benchmarks the generator the app ships draws exactly
// the reference's lines, which is stronger than "no worse than the reference minus 1 percentage point". The
// reference's sequences are pinned by hash in src/core/benchmarks.ts (and tests/acceptance/m0.test.ts checks
// that generate() still produces them), so this file does not run the reference again.
// The browser-speed criterion is tests/e2e/bench.spec.ts; print scale and pin positions are in tests/export.
import { describe, expect, it } from "vitest";
import { BENCHMARK_EXPECTED, benchmark, type BenchmarkId } from "../../src/core/benchmarks.ts";
import { runGreedy } from "../../src/core/greedy.ts";
import { errorReduction } from "../../src/core/metrics.ts";
import { createGenerateJob } from "../../src/workers/generateJob.ts";
import type { FromGen } from "../../src/workers/protocol.ts";
import { sha256 } from "../helpers/hash.ts";

describe.each(["mono", "colour"] as BenchmarkId[])("M1 (§13.4): the %s benchmark", (id) => {
  const b = benchmark(id), expected = BENCHMARK_EXPECTED[id];

  it("the stepper draws the reference's lines", { timeout: 300_000 }, () => {
    const run = runGreedy(b.options, b.target, b.weight);
    expect(sha256(run.seq)).toBe(expected.sequencesSha256);
    expect(run.seq.map((s) => s.length - 1)).toEqual(expected.lines);
    expect((100 * errorReduction(run.error(), run.initialError)).toFixed(1)).toBe((100 * expected.errorReduction).toFixed(1));
  });

  it("the worker's job reports the same lines, piece by piece and in its final message", { timeout: 300_000 }, async () => {
    const messages: FromGen[] = [];
    let clock = 0;
    const handle = createGenerateJob({ post: (m) => messages.push(m), pause: () => Promise.resolve(), now: () => (clock += 30) });
    handle({ t: "start", id: 1, options: b.options, target: b.target.slice(), weight: b.weight.slice(), resume: null, preview: false });
    await expect.poll(() => messages.some((m) => m.t === "done"), { timeout: 280_000, interval: 50 }).toBe(true);
    const done = messages.find((m) => m.t === "done")!;
    if (done.t !== "done") throw new Error("no done message");
    expect(sha256(done.sequences)).toBe(expected.sequencesSha256);
    expect(done.deltaE.map((v) => v.toFixed(1))).toEqual(expected.deltaE.map((v) => v.toFixed(1)));
    // the tails of the progress messages rebuild the sequences up to the last progress message
    const rebuilt: number[][] = b.options.threads.map(() => []);
    let progress = 0;
    for (const m of messages) {
      if (m.t !== "progress") continue;
      progress++;
      for (let i = 0; i < m.tail.length; i += 2) rebuilt[m.tail[i]!]!.push(m.tail[i + 1]!);
      expect(m.lines).toEqual(rebuilt.map((s) => Math.max(0, s.length - 1)));
    }
    expect(progress).toBe(Math.floor(expected.lines.reduce((a, c) => a + c, 0) / 100));
    rebuilt.forEach((s, k) => expect(done.sequences[k]!.slice(0, s.length)).toEqual(s));
  });
});
