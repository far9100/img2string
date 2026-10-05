// The crop geometry (spec §6.2) and the brush strokes of the importance map (§6.5). Strokes are stored in
// picture coordinates, so they stay on the same part of the picture when the crop changes; this file places
// them on the working grid.
//
// Coordinates. The working grid has pixel centres at whole numbers and the pin circle has centre and radius
// c = (res - 1) / 2. A picture of width x height pixels covers the rectangle [0, width] x [0, height]: pixel
// (i, j) is the square [i, i + 1] x [j, j + 1], its centre is (i + 0.5, j + 0.5), and a picture point is
// given as fractions of the width and the height, (0, 0) being the top left corner and (1, 1) the bottom right.
import type { Crop, Stroke } from "./project.ts";

/** A crop as a map from the working grid to the picture: grid (x, y) shows the picture pixel coordinate
 * (x0 + k (dx cos + dy sin), y0 + k (dy cos - dx sin)), where dx = x - c and dy = y - c. */
export interface CropTransform {
  /** Centre of the working grid, (res - 1) / 2. */
  c: number;
  /** The picture pixel coordinate under the centre of the pin circle. */
  x0: number;
  y0: number;
  /** Picture pixels per working pixel. */
  k: number;
  cos: number;
  sin: number;
}

/**
 * At scale 1 the pin circle's diameter, res - 1 working pixels, is the picture's short side, so one working
 * pixel is short / (scale (res - 1)) picture pixels. A positive rotateDeg turns the picture clockwise on screen
 * (y points down). Whole quarter turns use exact sines and cosines: turning a picture by 90 degrees then only
 * moves its pixels, it does not resample them. Needs res >= 2.
 */
export function cropTransform(crop: Crop, width: number, height: number, res: number): CropTransform {
  const quarter = (((crop.rotateDeg % 360) + 360) % 360) / 90, exact = Number.isInteger(quarter), t = (crop.rotateDeg * Math.PI) / 180;
  return {
    c: (res - 1) / 2,
    x0: crop.cx * width,
    y0: crop.cy * height,
    k: Math.min(width, height) / (crop.scale * (res - 1)),
    cos: exact ? [1, 0, -1, 0][quarter]! : Math.cos(t),
    sin: exact ? [0, 1, 0, -1][quarter]! : Math.sin(t),
  };
}

/** Working-grid pixel coordinates -> picture point (fractions of the width and the height). */
export function gridToPicture(crop: Crop, width: number, height: number, res: number, x: number, y: number): [number, number] {
  const t = cropTransform(crop, width, height, res), dx = x - t.c, dy = y - t.c;
  return [(t.x0 + t.k * (dx * t.cos + dy * t.sin)) / width, (t.y0 + t.k * (dy * t.cos - dx * t.sin)) / height];
}

/** Picture point (fractions of the width and the height) -> working-grid pixel coordinates: the inverse of gridToPicture. */
export function pictureToGrid(crop: Crop, width: number, height: number, res: number, sx: number, sy: number): [number, number] {
  const t = cropTransform(crop, width, height, res), px = sx * width - t.x0, py = sy * height - t.y0;
  return [t.c + (px * t.cos - py * t.sin) / t.k, t.c + (px * t.sin + py * t.cos) / t.k];
}

/**
 * Paints the strokes over `base` (one weight per pixel, res x res) in order and returns a new array. A stroke
 * sets its weight on every pixel whose centre is within the stroke's radius of its polyline (a capsule around
 * each segment; a single point gives a disc), so a later stroke replaces an earlier one where they overlap.
 * The radius is a fraction of the picture's short side and so scales with the picture when the crop zooms.
 */
export function paintStrokes(base: Float64Array, res: number, strokes: readonly Stroke[], crop: Crop, width: number, height: number): Float64Array {
  const out = base.slice();
  if (!strokes.length) return out;
  const t = cropTransform(crop, width, height, res), short = Math.min(width, height);
  for (const s of strokes) {
    const points = s.pts.length >> 1, rad = (s.r * short) / t.k, r2 = rad * rad;
    let ax = 0, ay = 0;
    for (let i = 0; i < points; i++) {
      const px = s.pts[2 * i]! * width - t.x0, py = s.pts[2 * i + 1]! * height - t.y0;
      const bx = t.c + (px * t.cos - py * t.sin) / t.k, by = t.c + (px * t.sin + py * t.cos) / t.k;
      // the capsule from the previous point to this one; a stroke of one point is the capsule from it to itself
      if (i > 0 || points === 1) {
        if (i === 0) { ax = bx; ay = by; }
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        const xLo = Math.max(0, Math.ceil(Math.min(ax, bx) - rad)), xHi = Math.min(res - 1, Math.floor(Math.max(ax, bx) + rad));
        const yLo = Math.max(0, Math.ceil(Math.min(ay, by) - rad)), yHi = Math.min(res - 1, Math.floor(Math.max(ay, by) + rad));
        for (let y = yLo; y <= yHi; y++) {
          for (let x = xLo; x <= xHi; x++) {
            // the nearest point of the segment: the foot of the perpendicular, held between the two ends
            const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
            if ((x - ax - u * dx) ** 2 + (y - ay - u * dy) ** 2 <= r2) out[y * res + x] = s.w;
          }
        }
      }
      ax = bx;
      ay = by;
    }
  }
  return out;
}
