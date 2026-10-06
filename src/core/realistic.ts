// What the render worker computes (spec §7.1), kept apart from the worker so Node tests can call it: the piece
// at true thread width as the screen shows it, blurred for a viewing distance when asked, and the error
// numbers measured on the true-width render (DECISIONS D-10), with its similarity to the picture (D-54).
import { gaussianBlur } from "./image.ts";
import { errorReduction, meanDeltaE, weightedError } from "./metrics.ts";
import { inkOf, similarity } from "./similarity.ts";
import { frameMask, type FrameOptions } from "./frame.ts";
import { coverageAlpha, pixelMm } from "./stringart.ts";
import { renderTrueWidth, trueWidthComposite, type Region } from "./truewidth.ts";

/**
 * `width` x `height` linear-RGB pixels of the piece (or of `region`, in working-grid coordinates), every line at
 * its true width; with sigmaMm > 0, blurred by a Gaussian of that size on the piece (viewingSigmaMm gives the
 * size for a viewing distance). The blur is often finer than an output pixel (0.25 mm at 2 m, while a 1,400 px
 * picture of a 500 mm frame has 0.35 mm pixels), so its weights are the Gaussian's area over each pixel.
 */
export function viewedRender(o: FrameOptions, sequences: readonly (readonly number[])[], width: number, height: number, region: Region | null, sigmaMm: number): Float64Array {
  const w = Math.floor(width), h = Math.floor(height);
  const img = renderTrueWidth(o, sequences, w, h, region ?? undefined);
  if (!(sigmaMm > 0) || !img.length) return img;
  // output pixels per working pixel, then per millimetre of the piece
  const span = region ? Math.abs(region.x1 - region.x0) : o.res;
  const sigmaPx = (sigmaMm / pixelMm(o)) * (w / span);
  return sigmaPx > 0.02 ? gaussianBlur(img, w, h, sigmaPx, 3, true) : img;
}

/** Sub-pixels per working pixel side for the measurement: enough for a 3 sub-pixel stripe, but never more than
 * 16. A very thin thread on a large frame would otherwise ask for billions of sub-pixels, and below 3 the
 * render still gives every line its area (measured on the mono benchmark: 87.24 % at 8, 87.22 % at 16). */
export const measureSubPixels = (o: FrameOptions): number => Math.max(1, Math.min(16, Math.ceil(3 / coverageAlpha(o))));

export interface TrueMeasure {
  /** Share of the bare board's weighted squared error that the piece removes, on the true-width render. */
  errorReduction: number;
  /** Mean Delta-E_OK x 100 between the true-width render and the target, inside the circle. */
  deltaE: number;
  /** similarity() of the true-width render to the picture before any adjustment (D-54); null without that picture. */
  similarity: number | null;
}

/** The picture a piece is compared with (referencePicture() of it), and the importance map as painted. */
export interface Original { reference: Float64Array; painted: Float64Array }

/** The numbers of §4.5 measured on the true-width render at the working resolution instead of on the model,
 * and with `original`, how close that render is to the picture the piece was made from. */
export function measureTrueWidth(o: FrameOptions, sequences: readonly (readonly number[])[], target: Float64Array, weight: Float64Array, original?: Original | null): TrueMeasure {
  const composite = trueWidthComposite(o, sequences, measureSubPixels(o)), px = o.res * o.res;
  const bare = new Float64Array(3 * px);
  for (let p = 0; p < px; p++) bare.set(o.board, 3 * p);
  return {
    errorReduction: errorReduction(weightedError(composite, target, weight), weightedError(bare, target, weight)),
    deltaE: meanDeltaE(composite, target, frameMask(o)),
    similarity: original ? similarity(inkOf(composite, o.res, original.painted, o.board), inkOf(original.reference, o.res, original.painted, o.board)).value : null,
  };
}
