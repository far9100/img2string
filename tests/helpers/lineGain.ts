// What a line gains a thread as a model stands, the way the generator works it out on a piece with pins inside
// the picture (greedy.ts's weigh() and gain(), DECISIONS D-61): pixel by pixel, coverage w gains
// w x rise - w^2 x curve. In exact arithmetic that is Model.gain(); in floating point it differs from it in
// the last digits, and the tests that hold the generator to a search written straight down need the very
// number. Nothing here is remembered: both factors are worked out from the model for every pixel of every line.
import type { Line, Model } from "../../src/core/stringart.ts";

export function lineGain(m: Model, k: number, line: Line): number {
  const c = m.o.threads[k]!, a = m.a[k]!, U = m.U[k]!, B = m.below[k]!, C = m.C, T = m.T;
  let g = 0;
  for (let i = 0; i < line.idx.length; i++) {
    const p = line.idx[i]!, q = 3 * p, wt = m.Wt[p]!, w = line.w[i]!;
    if (wt === 0) continue;
    const s = (1 - a[p]!) * U[p]!;
    const e0 = s * (c[0] - B[q]!), e1 = s * (c[1] - B[q + 1]!), e2 = s * (c[2] - B[q + 2]!);
    const rise = -2 * wt * ((C[q]! - T[q]!) * e0 + (C[q + 1]! - T[q + 1]!) * e1 + (C[q + 2]! - T[q + 2]!) * e2);
    const curve = wt * (e0 * e0 + e1 * e1 + e2 * e2);
    g += w * rise - w * w * curve;
  }
  return g;
}
