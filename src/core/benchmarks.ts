// The two benchmark set-ups of spec §13.1, shared by the acceptance tests, `npm run bench` and the browser
// benchmark. The mono run uses a pure black thread (0, 0, 0): that is what reproduces the spec's 1,410 lines;
// the preset's #111111 gives 1,450 (DECISIONS D-05).
import { circleMask, hexToLinear, type Options } from "./stringart.ts";
import { colourWheel, face } from "./targets.ts";

export const BENCHMARK_IDS = ["mono", "colour"] as const;
export type BenchmarkId = (typeof BENCHMARK_IDS)[number];

/** The benchmark palette (§6.3 "CMYK on white"), in the spec's winding order: yellow, cyan, magenta, black. */
export const CMYK_HEX = ["#FFE000", "#00A0E0", "#E0007A", "#111111"] as const;

export function benchmarkOptions(id: BenchmarkId): Options {
  if (id === "mono") {
    return { res: 400, pins: 256, diameterMm: 500, threadWidthMm: 0.25, board: [1, 1, 1], threads: [[0, 0, 0]], maxLines: [4000], minSkip: 20, allowRepeat: false };
  }
  return { res: 240, pins: 200, diameterMm: 500, threadWidthMm: 0.25, board: [1, 1, 1], threads: CMYK_HEX.map(hexToLinear), maxLines: [1500, 1500, 1500, 1500], minSkip: 15, allowRepeat: false };
}

export interface Benchmark {
  id: BenchmarkId;
  options: Options;
  target: Float64Array;
  weight: Float64Array;
}

export function benchmark(id: BenchmarkId): Benchmark {
  const options = benchmarkOptions(id);
  return { id, options, target: id === "mono" ? face(options.res) : colourWheel(options.res), weight: circleMask(options.res) };
}

/** What §13.1 reports for each run (thread lengths without the 5 % margin of §7.5), and the SHA-256 of
 * JSON.stringify(sequences) as the reference generates them, so every engine can be held to the same lines. */
export const BENCHMARK_EXPECTED: Record<BenchmarkId, { lines: number[]; errorReduction: number; deltaE: [number, number]; threadM: number[]; sequencesSha256: string }> = {
  mono: { lines: [1410], errorReduction: 0.907, deltaE: [24.6, 9.9], threadM: [586], sequencesSha256: "8c1821d0afffac6bf6c2834d05d3253d4df2fdd9ed452752cc9d0572ae293af0" },
  colour: {
    lines: [1500, 1379, 536, 606], errorReduction: 0.769, deltaE: [31.8, 18.2], threadM: [522, 437, 169, 257],
    sequencesSha256: "0cc0198e69dd16a2828e098c80311a9e338f355dd6dfb79396c38d09e5275acd",
  },
};
