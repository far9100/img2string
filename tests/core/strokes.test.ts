// src/core/strokes.ts: the crop geometry (picture <-> working grid) and the brush strokes of the importance map.
import { describe, expect, it } from "vitest";
import { IDENTITY_CROP, type Crop, type Stroke } from "../../src/core/project.ts";
import { cropTransform, gridToPicture, paintStrokes, pictureToGrid } from "../../src/core/strokes.ts";
import { mulberry32 } from "../helpers/rng.ts";

/** Any crop the project allows: centre anywhere on the picture, scale 0.2 to 20, any rotation. */
const randomCrop = (r: () => number): Crop => ({ cx: r(), cy: r(), scale: 0.2 * 100 ** r(), rotateDeg: 720 * r() - 360 });

/** Distance from (x, y) to the segment a-b. */
function toSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
  return Math.hypot(x - ax - u * dx, y - ay - u * dy);
}

/** Number of pixels holding `value`, and their centroid. */
function painted(W: Float64Array, res: number, value: number) {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) if (W[y * res + x] === value) { n++; sx += x; sy += y; }
  return { n, x: sx / n, y: sy / n };
}

describe("crop geometry", () => {
  it("is the formula of the crop: centre + R (u cos + v sin, -u sin + v cos), with the pin circle at u^2 + v^2 = 1", () => {
    const r = mulberry32(21);
    for (let i = 0; i < 300; i++) {
      const crop = randomCrop(r), width = 16 + Math.floor(4000 * r()), height = 16 + Math.floor(4000 * r()), res = 64 + Math.floor(1100 * r());
      const x = (res + 20) * r() - 10, y = (res + 20) * r() - 10;
      const c = (res - 1) / 2, u = (x - c) / c, v = (y - c) / c, R = Math.min(width, height) / (2 * crop.scale), t = (crop.rotateDeg * Math.PI) / 180;
      const [sx, sy] = gridToPicture(crop, width, height, res, x, y);
      expect(sx).toBeCloseTo((crop.cx * width + R * (u * Math.cos(t) + v * Math.sin(t))) / width, 9);
      expect(sy).toBeCloseTo((crop.cy * height + R * (-u * Math.sin(t) + v * Math.cos(t))) / height, 9);
    }
  });

  it("grid -> picture -> grid and picture -> grid -> picture are the identity for random crops", () => {
    const r = mulberry32(22);
    for (let i = 0; i < 500; i++) {
      const crop = randomCrop(r), width = 16 + Math.floor(4000 * r()), height = 16 + Math.floor(4000 * r()), res = 64 + Math.floor(1100 * r());
      const x = (res + 20) * r() - 10, y = (res + 20) * r() - 10;
      const [x2, y2] = pictureToGrid(crop, width, height, res, ...gridToPicture(crop, width, height, res, x, y));
      expect(x2).toBeCloseTo(x, 8);
      expect(y2).toBeCloseTo(y, 8);
      const sx = 1.4 * r() - 0.2, sy = 1.4 * r() - 0.2;
      const [sx2, sy2] = gridToPicture(crop, width, height, res, ...pictureToGrid(crop, width, height, res, sx, sy));
      expect(sx2).toBeCloseTo(sx, 9);
      expect(sy2).toBeCloseTo(sy, 9);
    }
  });

  it("at scale 1 the pin circle's diameter is the picture's short side, whatever the resolution", () => {
    for (const res of [64, 257, 400]) {
      const c = (res - 1) / 2;
      // landscape: the circle touches the top and bottom edges and leaves the sides
      expect(gridToPicture(IDENTITY_CROP, 300, 200, res, c, c)).toEqual([0.5, 0.5]);
      expect(gridToPicture(IDENTITY_CROP, 300, 200, res, c, 0)[1]).toBeCloseTo(0, 12);
      expect(gridToPicture(IDENTITY_CROP, 300, 200, res, c, res - 1)[1]).toBeCloseTo(1, 12);
      expect(gridToPicture(IDENTITY_CROP, 300, 200, res, 0, c)[0]).toBeCloseTo(0.5 - 100 / 300, 12);
      expect(gridToPicture(IDENTITY_CROP, 300, 200, res, res - 1, c)[0]).toBeCloseTo(0.5 + 100 / 300, 12);
      // portrait
      expect(gridToPicture(IDENTITY_CROP, 200, 500, res, 0, c)[0]).toBeCloseTo(0, 12);
      expect(gridToPicture(IDENTITY_CROP, 200, 500, res, c, 0)[1]).toBeCloseTo(0.5 - 100 / 500, 12);
      // scale 2 shows half as much, around the crop's centre
      const zoomed = { cx: 0.3, cy: 0.6, scale: 2, rotateDeg: 0 };
      expect(gridToPicture(zoomed, 300, 200, res, c, c)[0]).toBeCloseTo(0.3, 12);
      expect(gridToPicture(zoomed, 300, 200, res, c, c)[1]).toBeCloseTo(0.6, 12);
      expect(gridToPicture(zoomed, 300, 200, res, res - 1, c)[0]).toBeCloseTo(0.3 + 50 / 300, 12);
      expect(gridToPicture(zoomed, 300, 200, res, c, 0)[1]).toBeCloseTo(0.6 - 50 / 200, 12);
    }
    // one working pixel is short / (scale (res - 1)) picture pixels
    expect(cropTransform({ ...IDENTITY_CROP, scale: 4 }, 3000, 1200, 401).k).toBe(1200 / (4 * 400));
  });

  it("a positive rotation turns the picture clockwise on screen, and whole quarter turns are exact", () => {
    const res = 101, c = 50, W = 400, H = 300, at = (deg: number, sx: number, sy: number) => pictureToGrid({ ...IDENTITY_CROP, rotateDeg: deg }, W, H, res, sx, sy);
    // the point to the right of the picture's centre: on screen it goes right, down, left, up
    const k = 300 / 100, d = (0.75 - 0.5) * W / k;
    expect(at(0, 0.75, 0.5)).toEqual([c + d, c]);
    expect(at(90, 0.75, 0.5)).toEqual([c, c + d]);
    expect(at(180, 0.75, 0.5)).toEqual([c - d, c]);
    expect(at(270, 0.75, 0.5)).toEqual([c, c - d]);
    expect(at(-90, 0.75, 0.5)).toEqual([c, c - d]);
    expect(at(360, 0.75, 0.5)).toEqual([c + d, c]);
    expect(at(-360, 0.75, 0.5)).toEqual([c + d, c]);
    // a small clockwise turn moves it down a little
    const [x, y] = at(10, 0.75, 0.5);
    expect(x).toBeCloseTo(c + d * Math.cos(Math.PI / 18), 10);
    expect(y).toBeCloseTo(c + d * Math.sin(Math.PI / 18), 10);
    // and the picture's top edge, seen through a 90 degree turn, is on the right
    expect(at(90, 0.5, 0)[0]).toBeGreaterThan(c);
    for (const deg of [0, 90, 180, 270, -90, 450]) {
      const t = cropTransform({ ...IDENTITY_CROP, rotateDeg: deg }, W, H, res);
      expect(Math.abs(t.cos) + Math.abs(t.sin)).toBe(1);
      expect(t.cos).toBeCloseTo(Math.cos((deg * Math.PI) / 180), 14);
      expect(t.sin).toBeCloseTo(Math.sin((deg * Math.PI) / 180), 14);
    }
  });
});

describe("paintStrokes", () => {
  const res = 200, width = 300, height = 200, ones = () => new Float64Array(res * res).fill(1);
  // on this picture at scale 1 a radius of 0.1 (of the short side) is 0.1 x 199 = 19.9 working pixels
  const radius = (crop: Crop, r: number) => (r * Math.min(width, height)) / cropTransform(crop, width, height, res).k;

  it("returns a new array and leaves the base alone", () => {
    const base = ones(), out = paintStrokes(base, res, [], IDENTITY_CROP, width, height);
    expect(out).not.toBe(base);
    expect(out).toEqual(base);
    const painted2 = paintStrokes(base, res, [{ w: 0, r: 0.1, pts: [0.5, 0.5] }], IDENTITY_CROP, width, height);
    expect(painted2).not.toEqual(base);
    expect(base.every((v) => v === 1)).toBe(true);
  });

  it("a single-point stroke paints a disc of the right area, on the pixels within its radius", () => {
    const stroke: Stroke = { w: 2.5, r: 0.1, pts: [0.43, 0.61] }, out = paintStrokes(ones(), res, [stroke], IDENTITY_CROP, width, height);
    const [gx, gy] = pictureToGrid(IDENTITY_CROP, width, height, res, 0.43, 0.61), rad = radius(IDENTITY_CROP, 0.1);
    expect(rad).toBeCloseTo(19.9, 10);
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      const d = Math.hypot(x - gx, y - gy);
      if (d < rad - 1e-9 && out[y * res + x] !== 2.5) throw new Error(`pixel ${x}, ${y} is ${d} from the point and was not painted`);
      if (d > rad + 1e-9 && out[y * res + x] !== 1) throw new Error(`pixel ${x}, ${y} is ${d} from the point and was painted`);
    }
    const disc = painted(out, res, 2.5);
    expect(Math.abs(disc.n / (Math.PI * rad * rad) - 1)).toBeLessThan(0.02);
    expect(disc.x).toBeCloseTo(gx, 0);
    expect(disc.y).toBeCloseTo(gy, 0);
    // two equal points are the same disc
    expect(paintStrokes(ones(), res, [{ ...stroke, pts: [0.43, 0.61, 0.43, 0.61] }], IDENTITY_CROP, width, height)).toEqual(out);
  });

  it("a polyline paints every pixel within the radius of any of its segments", () => {
    const pts = [0.2, 0.3, 0.5, 0.35, 0.55, 0.8, 0.8, 0.75], stroke: Stroke = { w: 3, r: 0.04, pts };
    const crop: Crop = { cx: 0.5, cy: 0.5, scale: 1, rotateDeg: 20 }, out = paintStrokes(ones(), res, [stroke], crop, width, height), rad = radius(crop, 0.04);
    const g = [0, 2, 4, 6].map((i) => pictureToGrid(crop, width, height, res, pts[i]!, pts[i + 1]!));
    let length = 0;
    for (let i = 1; i < g.length; i++) length += Math.hypot(g[i]![0] - g[i - 1]![0], g[i]![1] - g[i - 1]![1]);
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      const d = Math.min(...[1, 2, 3].map((i) => toSegment(x, y, g[i - 1]![0], g[i - 1]![1], g[i]![0], g[i]![1])));
      if (d < rad - 1e-9 && out[y * res + x] !== 3) throw new Error(`pixel ${x}, ${y} is ${d} from the stroke and was not painted`);
      if (d > rad + 1e-9 && out[y * res + x] !== 1) throw new Error(`pixel ${x}, ${y} is ${d} from the stroke and was painted`);
    }
    // a band 2 rad wide along the polyline with round ends, less the little that is counted twice inside the two bends
    const area = painted(out, res, 3).n;
    expect(area).toBeGreaterThan(0.98 * (2 * rad * length + Math.PI * rad * rad));
    expect(area).toBeLessThan(1.01 * (2 * rad * length + Math.PI * rad * rad));
  });

  it("later strokes win where they overlap", () => {
    const a: Stroke = { w: 3, r: 0.15, pts: [0.4, 0.5] }, b: Stroke = { w: 0.5, r: 0.15, pts: [0.5, 0.5] };
    const ab = paintStrokes(ones(), res, [a, b], IDENTITY_CROP, width, height), ba = paintStrokes(ones(), res, [b, a], IDENTITY_CROP, width, height);
    const onlyA = paintStrokes(ones(), res, [a], IDENTITY_CROP, width, height), onlyB = paintStrokes(ones(), res, [b], IDENTITY_CROP, width, height);
    let both = 0;
    for (let p = 0; p < res * res; p++) {
      const inA = onlyA[p] === 3, inB = onlyB[p] === 0.5;
      if (inA && inB) both++;
      expect(ab[p]).toBe(inB ? 0.5 : inA ? 3 : 1);
      expect(ba[p]).toBe(inA ? 3 : inB ? 0.5 : 1);
    }
    expect(both).toBeGreaterThan(500);
  });

  it("a stroke stays on its part of the picture when the crop changes", () => {
    const stroke: Stroke = { w: 2, r: 0.05, pts: [0.45, 0.55] };
    const crops: Crop[] = [IDENTITY_CROP, { cx: 0.45, cy: 0.5, scale: 1.8, rotateDeg: 30 }, { cx: 0.55, cy: 0.6, scale: 0.7, rotateDeg: -115 }];
    const discs = crops.map((crop) => {
      const out = paintStrokes(ones(), res, [stroke], crop, width, height), [gx, gy] = pictureToGrid(crop, width, height, res, 0.45, 0.55), disc = painted(out, res, 2);
      // the disc is where the crop shows that picture point, and its centre shows that point again
      expect(Math.hypot(disc.x - gx, disc.y - gy)).toBeLessThan(0.3);
      expect(out[Math.round(gy) * res + Math.round(gx)]).toBe(2);
      const [sx, sy] = gridToPicture(crop, width, height, res, disc.x, disc.y);
      expect(sx).toBeCloseTo(0.45, 2);
      expect(sy).toBeCloseTo(0.55, 2);
      // and it grows with the picture: its radius is a share of the picture's short side
      expect(Math.abs(disc.n / (Math.PI * radius(crop, 0.05) ** 2) - 1)).toBeLessThan(0.04);
      return { gx, gy, n: disc.n };
    });
    // three different places and sizes on the grid
    expect(Math.hypot(discs[0]!.gx - discs[1]!.gx, discs[0]!.gy - discs[1]!.gy)).toBeGreaterThan(5);
    expect(Math.hypot(discs[0]!.gx - discs[2]!.gx, discs[0]!.gy - discs[2]!.gy)).toBeGreaterThan(5);
    expect(discs[1]!.n / discs[0]!.n).toBeCloseTo(1.8 ** 2, 0);
    expect(discs[2]!.n / discs[0]!.n).toBeCloseTo(0.7 ** 2, 1);
  });

  it("strokes off the grid, without points or with a stray coordinate paint nothing", () => {
    const base = ones();
    for (const pts of [[], [0.5], [7, 7], [-3, 0.5, -3, 0.6], [NaN, 0.5], [0.5, Infinity]]) {
      expect(paintStrokes(base, res, [{ w: 3, r: 0.02, pts }], IDENTITY_CROP, width, height)).toEqual(base);
    }
    // a stray last coordinate is ignored, the points before it are painted
    const two = paintStrokes(base, res, [{ w: 3, r: 0.02, pts: [0.4, 0.5, 0.6, 0.5] }], IDENTITY_CROP, width, height);
    expect(paintStrokes(base, res, [{ w: 3, r: 0.02, pts: [0.4, 0.5, 0.6, 0.5, 0.9] }], IDENTITY_CROP, width, height)).toEqual(two);
    // a stroke that starts outside is painted where it crosses the grid
    const crossing = paintStrokes(base, res, [{ w: 3, r: 0.02, pts: [-1, 0.5, 2, 0.5] }], IDENTITY_CROP, width, height);
    expect(crossing[100 * res]).toBe(3);
    expect(crossing[100 * res + res - 1]).toBe(3);
    expect(crossing[50 * res + 100]).toBe(1);
  });
});
