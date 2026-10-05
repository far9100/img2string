// The numbers shown beside a result (spec §4.5): how much of the weighted squared error the threads removed,
// and the mean colour difference in OKLab between an image and the target inside the pin circle.
import { oklab } from "./stringart.ts";

/** Share of the initial error that is gone, 0..1 (0 when there was no error to remove). */
export const errorReduction = (error: number, initialError: number): number => (initialError > 0 ? 1 - error / initialError : 0);

/**
 * Mean Delta-E_OK x 100 between two linear-RGB images (3 values per pixel) over the pixels where `mask` is
 * positive. Pass the circle mask, not the importance map: a pixel the user weighted 0 is still looked at.
 */
export function meanDeltaE(image: ArrayLike<number>, target: ArrayLike<number>, mask: ArrayLike<number>): number {
  let sum = 0, n = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!(mask[p]! > 0)) continue;
    const q = 3 * p;
    const a = oklab(image[q]!, image[q + 1]!, image[q + 2]!), b = oklab(target[q]!, target[q + 1]!, target[q + 2]!);
    sum += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    n++;
  }
  return n ? (100 * sum) / n : 0;
}

/** Mean Delta-E_OK x 100 between a flat colour (the bare board) and the target: the "before" number. */
export function meanDeltaEFlat(colour: readonly [number, number, number], target: ArrayLike<number>, mask: ArrayLike<number>): number {
  const a = oklab(colour[0], colour[1], colour[2]);
  let sum = 0, n = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!(mask[p]! > 0)) continue;
    const q = 3 * p, b = oklab(target[q]!, target[q + 1]!, target[q + 2]!);
    sum += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    n++;
  }
  return n ? (100 * sum) / n : 0;
}

/** Weighted squared error (linear RGB) of an image against the target: the quantity the generator lowers. */
export function weightedError(image: ArrayLike<number>, target: ArrayLike<number>, weight: ArrayLike<number>): number {
  let e = 0;
  for (let p = 0; p < weight.length; p++) {
    const w = weight[p]!;
    if (!w) continue;
    const q = 3 * p;
    e += w * ((image[q]! - target[q]!) ** 2 + (image[q + 1]! - target[q + 1]!) ** 2 + (image[q + 2]! - target[q + 2]!) ** 2);
  }
  return e;
}
