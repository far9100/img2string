// The browser half of §13.4: "on both benchmarks ... time no more than twice the reference in a current
// desktop browser". Both benchmarks run in the page's real generate worker and must draw the reference's
// lines; their time is compared with the specification's generate() timed in the same browser and worker,
// and with Node on this machine (`node scripts/bench.ts --json`), because a time only means something next to
// one measured on the same computer (DECISIONS D-08). Run with `npm run bench:browser`; not part of CI.
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import type { BenchResult } from "../../src/app/testHooks.ts";
import { hooks } from "./helpers.ts";

interface NodeBench { results: Record<string, Record<string, { seconds: number }>> }

test("both benchmarks, in the worker of a desktop browser", async ({ page }) => {
  const node = JSON.parse(execFileSync(process.execPath, ["scripts/bench.ts", "--json", "--runs=2"], { encoding: "utf8", maxBuffer: 1 << 26 })) as NodeBench;
  await page.goto("./?test");
  await hooks(page);
  const rows: string[] = [];
  for (const id of ["mono", "colour"] as const) {
    const r = (await page.evaluate(`window.__i2s.bench(${JSON.stringify(id)})`)) as BenchResult;
    const nodeReference = Object.values(node.results[id]!)[0]!.seconds;
    rows.push(`| ${id} | ${(r.appMs / 1000).toFixed(2)} s | ${(r.referenceMs / 1000).toFixed(2)} s | ${nodeReference.toFixed(2)} s | ${(r.appMs / r.referenceMs).toFixed(2)} | ${(r.appMs / 1000 / nodeReference).toFixed(2)} |`);
    expect(r.appSha, `${id}: the app's lines`).toBe(r.expectedSha);
    expect(r.referenceSha, `${id}: the reference's lines in this browser`).toBe(r.expectedSha);
    expect(r.appMs, `${id}: against the reference in the same worker`).toBeLessThanOrEqual(2 * r.referenceMs);
    expect(r.appMs / 1000, `${id}: against the reference in Node`).toBeLessThanOrEqual(2 * nodeReference);
  }
  console.log(["", "| Benchmark | App in the browser | §12 in the browser | §12 in Node | App / browser reference | App / Node reference |", "|---|---|---|---|---|---|", ...rows, ""].join("\n"));
});
