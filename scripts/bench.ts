// The two benchmarks of spec §13.1, for the numbers §16.2 asks of every change that touches generation.
// Run with `npm run bench` (Node runs the TypeScript directly); single thread.
//   --json     print the results as JSON only (the browser benchmark reads this)
//   --runs=N   time each engine N times and report the fastest (default 1)
//   --assert   fail unless every engine reproduces the reference sequences and the accelerated engine is at
//              least twice as fast as the reference on the colour benchmark (§13.5)
// Thread lengths are without the 5 % margin of §7.5, as in the spec's table.
import { BENCHMARK_IDS, benchmark, type Benchmark } from "../src/core/benchmarks.ts";
import { errorReduction, meanDeltaE, meanDeltaEFlat } from "../src/core/metrics.ts";
import { coverageAlpha, generate, Model, pinPositions, rasterLine, threadLengthMm } from "../src/core/stringart.ts";

export interface Engine {
  name: string;
  run(b: Benchmark): number[][];
}

export const ENGINES: Engine[] = [{ name: "reference (§12)", run: (b) => generate(b.options, b.target, b.weight).sequences }];

const arg = (name: string) => process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const JSON_ONLY = Boolean(arg("json")), ASSERT = Boolean(arg("assert"));
const RUNS = Math.max(1, Number(arg("runs")?.split("=")[1] ?? 1));

function measure(b: Benchmark, sequences: number[][]) {
  const o = b.options, m = new Model(o, b.target, b.weight), P = pinPositions(o.pins, o.res), alpha = coverageAlpha(o);
  const initial = m.error();
  sequences.forEach((s, k) => {
    for (let i = 1; i < s.length; i++) m.apply(k, rasterLine(o.res, alpha, P[2 * s[i - 1]!]!, P[2 * s[i - 1]! + 1]!, P[2 * s[i]!]!, P[2 * s[i]! + 1]!));
  });
  return {
    lines: sequences.map((s) => Math.max(0, s.length - 1)),
    errorReduction: errorReduction(m.error(), initial),
    deltaE: [meanDeltaEFlat(o.board, b.target, b.weight), meanDeltaE(m.C, b.target, b.weight)],
    threadM: sequences.map((s) => threadLengthMm(s, o) / 1000),
  };
}

const results: Record<string, Record<string, ReturnType<typeof measure> & { seconds: number; sameAsReference: boolean }>> = {};
let failed = false;
for (const id of BENCHMARK_IDS) {
  const b = benchmark(id);
  results[id] = {};
  let reference: number[][] | null = null;
  for (const engine of ENGINES) {
    let best = Infinity, sequences: number[][] = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      sequences = engine.run(b);
      best = Math.min(best, (performance.now() - t0) / 1000);
    }
    reference ??= sequences;
    const same = JSON.stringify(sequences) === JSON.stringify(reference);
    if (!same) failed = true;
    results[id]![engine.name] = { ...measure(b, sequences), seconds: best, sameAsReference: same };
  }
}

if (JSON_ONLY) {
  console.log(JSON.stringify({ node: process.version, runs: RUNS, results }));
} else {
  console.log(`Node ${process.version}, fastest of ${RUNS} run${RUNS > 1 ? "s" : ""}; mono = face 400 px / 256 pins, colour = wheel 240 px / 200 pins, Y/C/M/K\n`);
  console.log("| Run | Engine | Lines | Error reduction | Mean ΔE_OK ×100 | Thread (m) | Time | Speed-up | Same sequences |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const id of BENCHMARK_IDS) {
    const ref = Object.values(results[id]!)[0]!;
    for (const [name, r] of Object.entries(results[id]!)) {
      console.log(
        `| ${id} | ${name} | ${r.lines.join(" / ")} | ${(100 * r.errorReduction).toFixed(2)} % | ${r.deltaE[0]!.toFixed(2)} → ${r.deltaE[1]!.toFixed(2)} | ${r.threadM.map((v) => v.toFixed(0)).join(" / ")} | ${r.seconds.toFixed(2)} s | ${(ref.seconds / r.seconds).toFixed(2)}× | ${r.sameAsReference ? "yes" : "NO"} |`,
      );
    }
  }
}

if (ASSERT) {
  const colour = Object.values(results.colour!);
  const fastest = Math.min(...colour.slice(1).map((r) => r.seconds));
  if (colour.length > 1 && colour[0]!.seconds / fastest < 2) {
    console.error(`colour benchmark: the fastest engine is only ${(colour[0]!.seconds / fastest).toFixed(2)}× the reference (needs 2×)`);
    failed = true;
  }
  if (failed) {
    console.error("bench --assert failed");
    process.exit(1);
  }
}
