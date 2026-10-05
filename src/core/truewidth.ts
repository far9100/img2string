// The realistic render (spec §7.1) and the check of the image model against it (§13.1 "Model check",
// DECISIONS D-10): every line as an opaque stripe of true thread width, layers in winding order so a later
// thread hides an earlier one where they cross, then averaged in linear light. Done on typed arrays, not on a
// canvas (D-19): a canvas antialiases in gamma-encoded values and may add noise when pixels are read back.
//
// The picture is drawn on a grid of sub-pixels, S per output pixel side. Each sub-pixel holds one byte, the
// thread on top there (0 = bare board), so painting a stripe is writing its label and "opaque, in winding
// order" is painting layer 0 first. Only a band of rows is held at a time; its output pixels are the mean
// colour of their S x S sub-pixels.
import { coverageAlpha, pinPositions, type Options } from "./stringart.ts";

/** A rectangle in working-grid coordinates (pixel centres at whole numbers; may be fractional). */
export interface Region { x0: number; y0: number; x1: number; y1: number }

/** A stripe this many sub-pixels wide is drawn by which sub-pixel centres it contains. */
const MIN_STRIPE = 3;
/** Labels held at a time (16 MB): the grid is drawn in bands of rows of about this size. */
const BAND_BYTES = 1 << 24;
/** renderTrueWidth draws at most this many sub-pixels (unless it is asked for more output pixels than that). */
const MAX_SUB_PIXELS = 1 << 26;
/** renderTrueWidth uses at least this many sub-pixels per output pixel side, so that a magnified stripe has smooth edges. */
const SMOOTH = 4;

/** The whole working grid: pixel p covers [p - 0.5, p + 0.5]. */
const wholeGrid = (res: number): Region => ({ x0: -0.5, y0: -0.5, x1: res - 0.5, y1: res - 0.5 });

/**
 * `width` x `height` output pixels showing `region`, S x S sub-pixels each. Sub-pixel i covers [i, i + 1) and its
 * centre is i + 0.5; a pin at working coordinates (px, py) is at ((px - x0) sx, (py - y0) sy) with sx, sy
 * sub-pixels per working pixel (for the whole grid at S per working pixel: ((px + 0.5) S, (py + 0.5) S)).
 *
 * A line is walked along its major axis, one sub-pixel column at a time, the columns being those whose centre
 * lies between the two pins. Where the stripe is at least MIN_STRIPE sub-pixels wide, a column gets the
 * sub-pixels whose centre is within half the stripe of the line: line - e <= centre < line + e along the minor
 * axis, with e = half the width x sqrt(1 + slope^2) (half open, so a stripe a whole number of sub-pixels wide
 * always gets exactly that many). A thinner stripe that runs along the grid would be drawn in every column or
 * in none, so there the number of sub-pixels in a column is the rounded running total of 2e less what the
 * columns before it got, placed nearest the line: the area is right for every line, whatever its direction.
 */
function render(o: Options, sequences: readonly (readonly number[])[], width: number, height: number, region: Region, S: number): Float64Array {
  const K = o.threads.length;
  if (K > 255) throw new RangeError(`the true-width render labels threads with one byte: 255 threads at most, got ${K}`);
  const gw = width * S, gh = height * S, sx = gw / (region.x1 - region.x0), sy = gh / (region.y1 - region.y0);
  const alpha = coverageAlpha(o), P = pinPositions(o.pins, o.res);
  const thin = alpha * Math.min(Math.abs(sx), Math.abs(sy)) < MIN_STRIPE * (1 - 1e-9);

  // every line once, in sub-pixel coordinates along its major (a) and minor (b) axis, in winding order
  let lines = 0;
  for (let k = 0; k < K && k < sequences.length; k++) lines += Math.max(0, sequences[k]!.length - 1);
  const geometry = new Float64Array(5 * lines), steep = new Uint8Array(lines), label = new Uint8Array(lines);
  let count = 0;
  for (let k = 0; k < K && k < sequences.length; k++) {
    const s = sequences[k]!;
    for (let i = 1; i < s.length; i++) {
      const ux = P[2 * s[i - 1]!]!, uy = P[2 * s[i - 1]! + 1]!, vx = P[2 * s[i]!]!, vy = P[2 * s[i]! + 1]!;
      const tall = Math.abs((vy - uy) * sy) > Math.abs((vx - ux) * sx);
      let a0 = tall ? (uy - region.y0) * sy : (ux - region.x0) * sx, a1 = tall ? (vy - region.y0) * sy : (vx - region.x0) * sx;
      let b0 = tall ? (ux - region.x0) * sx : (uy - region.y0) * sy, b1 = tall ? (vx - region.x0) * sx : (vy - region.y0) * sy;
      if (a1 < a0) { let t = a0; a0 = a1; a1 = t; t = b0; b0 = b1; b1 = t; }
      if (!(a1 > a0)) continue; // no length, or a pin that does not exist
      // slope in working pixels: the stripe's extent along the minor axis is its width x sqrt(1 + slope^2)
      const slope = tall ? (vx - ux) / (vy - uy) : (vy - uy) / (vx - ux);
      geometry[5 * count] = a0;
      geometry[5 * count + 1] = a1;
      geometry[5 * count + 2] = b0;
      geometry[5 * count + 3] = (b1 - b0) / (a1 - a0);
      geometry[5 * count + 4] = 0.5 * alpha * Math.abs(tall ? sx : sy) * Math.sqrt(1 + slope * slope);
      steep[count] = tall ? 1 : 0;
      label[count++] = k + 1;
    }
  }

  const colours = new Float64Array(3 * (K + 1));
  colours.set(o.board, 0);
  for (let k = 0; k < K; k++) colours.set(o.threads[k]!, 3 * (k + 1));

  const out = new Float64Array(3 * width * height), area = S * S;
  const bandRows = Math.max(1, Math.min(gh, Math.floor(BAND_BYTES / gw)));
  const labels = new Uint8Array(gw * bandRows), counts = new Int32Array((K + 1) * width);
  for (let r0 = 0; r0 < gh; r0 += bandRows) {
    const r1 = Math.min(gh, r0 + bandRows);
    labels.fill(0, 0, (r1 - r0) * gw);
    for (let e = 0; e < count; e++) {
      const a0 = geometry[5 * e]!, b0 = geometry[5 * e + 2]!, slope = geometry[5 * e + 3]!, ext = geometry[5 * e + 4]!, mark = label[e]!;
      const first = Math.ceil(a0 - 0.5), last = Math.ceil(geometry[5 * e + 1]! - 0.5) - 1; // centres in [a0, a1)
      if (steep[e]) {
        // major axis y: one run of sub-pixels in each row of the band
        for (let j = Math.max(r0, first), end = Math.min(r1 - 1, last); j <= end; j++) {
          const b = b0 + slope * (j + 0.5 - a0);
          let lo: number, hi: number;
          if (thin) {
            const m = j - first, n = Math.floor((m + 1) * 2 * ext + 0.5) - Math.floor(m * 2 * ext + 0.5);
            lo = Math.ceil(b - n / 2 - 0.5);
            hi = lo + n;
          } else {
            lo = Math.ceil(b - ext - 0.5);
            hi = Math.ceil(b + ext - 0.5);
          }
          if (lo < 0) lo = 0;
          if (hi > gw) hi = gw;
          for (let p = (j - r0) * gw + lo, q = (j - r0) * gw + hi; p < q; p++) labels[p] = mark;
        }
      } else {
        // major axis x: one run in each column, cut to the band; only the columns whose run can reach it
        let from = Math.max(0, first), to = Math.min(gw - 1, last);
        if (slope !== 0) {
          const u = a0 - 0.5 + (r0 - ext - 1 - b0) / slope, v = a0 - 0.5 + (r1 + ext + 1 - b0) / slope;
          from = Math.max(from, Math.floor(Math.min(u, v)));
          to = Math.min(to, Math.ceil(Math.max(u, v)));
        } else if (b0 + ext + 1 < r0 || b0 - ext - 1 > r1) continue;
        for (let i = from; i <= to; i++) {
          const b = b0 + slope * (i + 0.5 - a0);
          let lo: number, hi: number;
          if (thin) {
            const m = i - first, n = Math.floor((m + 1) * 2 * ext + 0.5) - Math.floor(m * 2 * ext + 0.5);
            lo = Math.ceil(b - n / 2 - 0.5);
            hi = lo + n;
          } else {
            lo = Math.ceil(b - ext - 0.5);
            hi = Math.ceil(b + ext - 0.5);
          }
          if (lo < r0) lo = r0;
          if (hi > r1) hi = r1;
          for (let p = (lo - r0) * gw + i, q = (hi - r0) * gw + i; p < q; p += gw) labels[p] = mark;
        }
      }
    }
    // count the labels of each output pixel; a band may end in the middle of an output row, so the counts
    // are kept until the row's last sub-pixel row has been seen
    for (let r = r0; r < r1; r++) {
      for (let x = 0, p = (r - r0) * gw, c = 0; x < width; x++, c += K + 1) for (let s = 0; s < S; s++) counts[c + labels[p++]!]!++;
      if ((r + 1) % S !== 0) continue;
      for (let x = 0, c = 0, q = 3 * width * ((r + 1) / S - 1); x < width; x++, c += K + 1, q += 3) {
        let red = 0, green = 0, blue = 0, whole = -1;
        for (let l = 0; l <= K; l++) {
          const n = counts[c + l]!;
          if (!n) continue;
          counts[c + l] = 0;
          if (n === area) whole = l;
          red += n * colours[3 * l]!;
          green += n * colours[3 * l + 1]!;
          blue += n * colours[3 * l + 2]!;
        }
        // a pixel of one colour is that colour exactly (n x colour / n is not always the colour again)
        out[q] = whole < 0 ? red / area : colours[3 * whole]!;
        out[q + 1] = whole < 0 ? green / area : colours[3 * whole + 1]!;
        out[q + 2] = whole < 0 ? blue / area : colours[3 * whole + 2]!;
      }
    }
  }
  return out;
}

/**
 * Every line as an opaque stripe of true thread width, in winding order (later layers cover earlier ones),
 * then a box average in linear light back to the working grid: 3 * res * res linear RGB, to compare with the
 * model's composite. `subPixels` per working pixel side defaults to the smallest count that makes the stripe
 * at least 3 sub-pixels wide (16 for 0.25 mm thread on 500 mm at 400 px). The work grows with
 * (res x subPixels)^2, about (3 x diameter / thread width)^2 sub-pixels by default; the memory does not.
 */
export function trueWidthComposite(o: Options, sequences: readonly (readonly number[])[], subPixels?: number): Float64Array {
  let S = subPixels === undefined ? Math.ceil(MIN_STRIPE / coverageAlpha(o)) : Math.floor(subPixels);
  if (!(S >= 1 && Number.isFinite(S))) S = 1;
  return render(o, sequences, o.res, o.res, wholeGrid(o.res), S);
}

/**
 * The same render at any size, for the screen and the magnifier: `width` x `height` linear RGB pixels showing
 * `region` (default: the whole grid, [-0.5, res - 0.5] both ways; anything beyond it is bare board). The
 * sub-pixels are chosen so that a stripe is at least 3 of them wide however coarse the output is, so thread
 * thinner than an output pixel still darkens it by the area it covers, and at least 4 per output pixel side.
 * Their total is capped at 67 million; where that leaves a stripe narrower than 3 sub-pixels, render()'s rule
 * for thin stripes keeps every line's area right. `width` and `height` are rounded down to whole pixels.
 * At res x res for the whole grid, when the cap does not bind, this is trueWidthComposite.
 */
export function renderTrueWidth(o: Options, sequences: readonly (readonly number[])[], width: number, height: number, region?: Region): Float64Array {
  const w = Math.floor(width), h = Math.floor(height), view = region ?? wholeGrid(o.res);
  if (!(w >= 1 && h >= 1)) return new Float64Array(0);
  // the stripe's width in output pixels, along the axis where it is narrower
  const stripe = coverageAlpha(o) * Math.min(Math.abs(w / (view.x1 - view.x0)), Math.abs(h / (view.y1 - view.y0)));
  let S = Math.ceil(MIN_STRIPE / stripe);
  if (!(S >= SMOOTH)) S = SMOOTH;
  S = Math.max(1, Math.min(S, Math.floor(Math.sqrt(MAX_SUB_PIXELS / (w * h)))));
  return render(o, sequences, w, h, view, S);
}

/** One arcminute, the detail a normal eye resolves, as millimetres per metre of viewing distance (0.2909). */
const ARCMINUTE_MM_PER_M = (1000 * Math.PI) / (180 * 60);

/** Gaussian sigma (mm on the piece) that models viewing from `distanceM` metres: its full width at half
 * maximum is one arcminute, 0.2909 mm per metre, so sigma is 0.1235 mm per metre (0.2471 mm at 2 m). */
export function viewingSigmaMm(distanceM: number): number {
  return (ARCMINUTE_MM_PER_M * distanceM) / (2 * Math.sqrt(2 * Math.LN2));
}
