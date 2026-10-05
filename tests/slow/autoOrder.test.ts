// §13.5: "Auto order picks the best of all orders on the colour benchmark (verified by brute force)."
// The search ranks every order on a small proxy (96 px, 96 pins, full budgets), then runs its best three at
// the real settings and keeps the best of those (src/core/palette.ts, DECISIONS D-11). Here all 24 orders are
// also run at the real settings, which takes a few minutes; run with `npm run test:slow`.
import { describe, expect, it } from "vitest";
import { benchmark } from "../../src/core/benchmarks.ts";
import { runGreedy } from "../../src/core/greedy.ts";
import { ORDER_SEARCH_VERIFY, permutations, proxyOptions, reorder } from "../../src/core/palette.ts";
import { circleMask, type Options } from "../../src/core/stringart.ts";
import { colourWheel } from "../../src/core/targets.ts";

const reduction = (o: Options, target: Float64Array, weight: Float64Array) => {
  const run = runGreedy(o, target, weight);
  return 1 - run.error() / run.initialError;
};

describe("M2 (§13.5): the winding-order search on the colour benchmark", () => {
  it("picks the order that brute force finds best", () => {
    const { options: o, target, weight } = benchmark("colour");
    const proxy = proxyOptions(o), small = colourWheel(proxy.res), smallMask = circleMask(proxy.res);
    const orders = permutations(o.threads.length), name = (order: number[]) => order.map((i) => "YCMK"[i]).join("");

    const quick = orders.map((order) => reduction(reorder(proxy, order), small, smallMask));
    const candidates = orders.map((order, i) => ({ order, proxy: quick[i]! })).sort((a, b) => b.proxy - a.proxy).slice(0, ORDER_SEARCH_VERIFY);
    const full = orders.map((order) => reduction(reorder(o, order), target, weight));
    const fullOf = (order: number[]) => full[orders.indexOf(order)]!;
    const picked = candidates.reduce((a, b) => (fullOf(b.order) > fullOf(a.order) ? b : a));
    const best = orders[full.indexOf(Math.max(...full))]!;

    const table = orders.map((order, i) => ({ order: name(order), full: (100 * full[i]!).toFixed(2), proxy: (100 * quick[i]!).toFixed(2) })).sort((a, b) => Number(b.full) - Number(a.full));
    console.log(table.map((r) => `${r.order}  full ${r.full} %  proxy ${r.proxy} %`).join("\n"));

    expect(name(picked.order)).toBe(name(best));
    expect(name(best)).toBe("KYMC"); // black first; measured 83.42 %
    expect(fullOf(best)).toBeCloseTo(0.8342, 3);
    // the spec's default, lightest first, is the benchmark's order and close to the worst (DECISIONS D-11)
    expect(fullOf(orders[0]!)).toBeCloseTo(0.7695, 3);
    expect(full.filter((v) => v > fullOf(orders[0]!)).length).toBe(22);
  });
});
