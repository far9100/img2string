// src/core/frame.ts: the round frame is stringart.ts's own, to the last bit; the rectangular one has the
// picture's proportions, pins along its four sides and the circle's rule for which pins a thread may join.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allowedPairs, ASPECT_LIMITS, clampAspect, cropSpan, FRAME_SPARE, frameBounds, frameMask, framePins, framePixels, frameSizeMm, frameThreadMm, pictureAspect, pinPlace,
  pinSpacingMm, rectPinsMm, sideCounts, unitPins, unitSides, type FrameOptions,
} from "../../src/core/frame.ts";
import { circDist, circleMask, pinPositions, threadLengthMm, type Options } from "../../src/core/stringart.ts";
import { cropTransform } from "../../src/core/strokes.ts";
import { mulberry32 } from "../helpers/rng.ts";

const options = (over: Partial<FrameOptions> = {}): FrameOptions => ({
  res: 400, pins: 256, diameterMm: 500, threadWidthMm: 0.25, board: [1, 1, 1], threads: [[0, 0, 0]], maxLines: [4000], minSkip: 20, allowRepeat: false, ...over,
});
const sameBits = (a: Float64Array, b: Float64Array) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const ASPECTS = [0.25, 0.4, 2 / 3, 0.75, 1, 4 / 3, 1.5, 2.5, 4];

describe("the round frame", () => {
  it("has stringart.ts's pins and mask, with or without the word 'circle'", () => {
    for (const [pins, res] of [[256, 400], [200, 240], [64, 64], [511, 1001]] as const) {
      expect(sameBits(framePins({ pins, res }), pinPositions(pins, res))).toBe(true);
      expect(sameBits(framePins({ pins, res, shape: "circle", aspect: 0.5 }), pinPositions(pins, res))).toBe(true);
      expect(sameBits(frameMask({ res }), circleMask(res))).toBe(true);
      expect(frameBounds({ res })).toEqual({ x0: 0, y0: 0, x1: res - 1, y1: res - 1 });
    }
  });

  it("allows the pairs at least minSkip apart round the circle, and no pin with itself", () => {
    for (const [pins, minSkip] of [[256, 20], [200, 15], [64, 1], [65, 32]] as const) {
      const ok = allowedPairs({ pins, minSkip });
      let wrong = 0;
      for (let u = 0; u < pins; u++) for (let v = 0; v < pins; v++) if ((ok[u * pins + v] === 1) !== (circDist(u, v, pins) >= minSkip)) wrong++;
      expect(wrong).toBe(0);
    }
  });

  it("measures thread as stringart.ts does, and has no sides", () => {
    const o = options(), r = mulberry32(5), seq = Array.from({ length: 400 }, () => Math.floor(r() * o.pins));
    expect(frameThreadMm(o, seq, 2.2)).toBe(threadLengthMm(seq, o as Options, 2.2));
    expect(frameThreadMm(o, seq)).toBe(threadLengthMm(seq, o as Options));
    expect(pinPlace(o, 12)).toBeNull();
    expect(frameSizeMm({ diameterMm: 500 })).toEqual({ width: 500, height: 500 });
    expect(pinSpacingMm({ pins: 256, diameterMm: 500 })).toEqual({ along: (Math.PI * 500) / 256, nearest: (Math.PI * 500) / 256 });
  });

  it("takes the picture's short side across the grid, however the picture is turned", () => {
    for (const turn of [0, 17, 90, -135]) expect(cropSpan({}, turn, 658, 873, 400)).toBe(658);
    expect(cropSpan({ shape: "circle" }, 0, 900, 300, 240)).toBe(300);
  });
});

describe("a rectangle without a size", () => {
  it("clamps the proportions to 1:4 .. 4:1 and reads nonsense as square", () => {
    expect(ASPECT_LIMITS).toEqual([0.25, 4]);
    expect([clampAspect(0.1), clampAspect(9), clampAspect(0.75), clampAspect(NaN), clampAspect(-2), clampAspect("3")]).toEqual([0.25, 4, 0.75, 1, 1, 1]);
    expect(unitSides(0.75)).toEqual({ w: 0.75, h: 1 });
    expect(unitSides(2)).toEqual({ w: 1, h: 0.5 });
    expect(unitSides(1)).toEqual({ w: 1, h: 1 });
  });

  it("shares the pins among the sides by their length: top and bottom alike, right at most one more than left", () => {
    expect(sideCounts(256, 0.75)).toEqual([55, 73, 55, 73]);
    expect(sideCounts(256, 1)).toEqual([64, 64, 64, 64]);
    expect(sideCounts(200, 1.5)).toEqual([60, 40, 60, 40]);
    expect(sideCounts(65, 1.5)).toEqual([20, 13, 20, 12]);
    for (const aspect of ASPECTS) for (const pins of [64, 65, 127, 256, 511, 512]) {
      const [top, right, bottom, left] = sideCounts(pins, aspect);
      expect(top + right + bottom + left).toBe(pins);
      expect(top).toBe(bottom);
      expect(right - left === 0 || right - left === 1).toBe(true);
      expect(Math.min(top, left)).toBeGreaterThanOrEqual(3);
      // within a pin of the proportions, on every side
      const along = pins / (2 * (aspect + 1));
      expect(Math.abs(top - along * aspect)).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.abs(right - along)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("puts the pins on the outline, clockwise from the top left corner, never on a corner", () => {
    for (const aspect of ASPECTS) for (const pins of [64, 127, 256]) {
      const P = unitPins(pins, aspect), { w, h } = unitSides(aspect), x0 = (1 - w) / 2, y0 = (1 - h) / 2, counts = sideCounts(pins, aspect);
      expect(Math.max(w, h)).toBe(1);
      let i = 0;
      for (let s = 0; s < 4; s++) for (let j = 0; j < counts[s]!; j++, i++) {
        const x = P[2 * i]!, y = P[2 * i + 1]!, step = (s % 2 ? h : w) / counts[s]!, t = (j + 0.5) * step;
        const want = s === 0 ? [x0 + t, y0] : s === 1 ? [x0 + w, y0 + t] : s === 2 ? [x0 + w - t, y0 + h] : [x0, y0 + h - t];
        expect(Math.abs(x - want[0]!) + Math.abs(y - want[1]!)).toBeLessThan(1e-12);
        expect(x >= 0 && x <= 1 && y >= 0 && y <= 1).toBe(true);
        // half a step from the corner at the least
        expect(Math.min(t, (s % 2 ? h : w) - t)).toBeGreaterThanOrEqual(step / 2 - 1e-12);
      }
      expect(i).toBe(pins);
      // pin 0 is the pin nearest the top left corner on the top side
      expect(P[1]).toBe(y0);
      expect(P[0]! - x0).toBeCloseTo(w / counts[0]! / 2, 12);
    }
  });

  it("says on which side a pin is and where along it, counted the way the pins are numbered", () => {
    const layout = { pins: 256, shape: "rect" as const, aspect: 0.75 }; // 55, 73, 55, 73
    expect(pinPlace(layout, 0)).toEqual({ side: "top", n: 1, of: 55 });
    expect(pinPlace(layout, 54)).toEqual({ side: "top", n: 55, of: 55 });
    expect(pinPlace(layout, 55)).toEqual({ side: "right", n: 1, of: 73 });
    expect(pinPlace(layout, 128)).toEqual({ side: "bottom", n: 1, of: 55 });
    expect(pinPlace(layout, 183)).toEqual({ side: "left", n: 1, of: 73 });
    expect(pinPlace(layout, 255)).toEqual({ side: "left", n: 73, of: 73 });
    expect(pinPlace(layout, 256)).toEqual({ side: "top", n: 1, of: 55 });
    expect(pinPlace(layout, -1)).toEqual({ side: "left", n: 73, of: 73 });
  });
});

describe("a rectangle on the working grid", () => {
  it("is the unit rectangle scaled by res - 1: the same pins at every resolution", () => {
    for (const aspect of ASPECTS) for (const res of [64, 240, 400, 1001]) {
      const P = framePins({ pins: 200, res, shape: "rect", aspect }), U = unitPins(200, aspect);
      for (let i = 0; i < P.length; i++) {
        expect(P[i]).toBe(U[i]! * (res - 1));
        expect(P[i]! >= 0 && P[i]! <= res - 1).toBe(true); // rasterLine checks one axis only
      }
      const b = frameBounds({ res, shape: "rect", aspect });
      expect(Math.max(b.x1 - b.x0, b.y1 - b.y0)).toBeCloseTo(res - 1, 9);
      expect((b.x1 - b.x0) / (b.y1 - b.y0)).toBeCloseTo(aspect, 9);
      expect(b.x0 + b.x1).toBeCloseTo(res - 1, 9);
      expect(b.y0 + b.y1).toBeCloseTo(res - 1, 9);
    }
  });

  it("masks the pixels on and inside its outline", () => {
    for (const aspect of ASPECTS) for (const res of [65, 400]) {
      const o = { res, shape: "rect" as const, aspect }, W = frameMask(o), b = frameBounds(o), px = framePixels(o);
      let ones = 0;
      for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
        const inside = x >= b.x0 - 1e-9 && x <= b.x1 + 1e-9 && y >= b.y0 - 1e-9 && y <= b.y1 + 1e-9;
        expect(W[y * res + x]).toBe(inside ? 1 : 0);
        ones += W[y * res + x]!;
      }
      expect(ones).toBe((px.x1 - px.x0 + 1) * (px.y1 - px.y0 + 1));
    }
    // a square frame is the whole grid
    expect(frameMask({ res: 50, shape: "rect", aspect: 1 }).every((v) => v === 1)).toBe(true);
  });
});

describe("which pins a thread may join on a rectangle", () => {
  it("is symmetric, never joins a side with itself, and keeps pins at least minSkip apart round the frame", () => {
    for (const aspect of ASPECTS) for (const [pins, minSkip] of [[256, 20], [200, 15], [96, 8], [64, 1]] as const) {
      const ok = allowedPairs({ pins, minSkip, shape: "rect", aspect }), counts = sideCounts(pins, aspect), side: number[] = [];
      counts.forEach((n, s) => { for (let j = 0; j < n; j++) side.push(s); });
      for (let u = 0; u < pins; u++) for (let v = 0; v < pins; v++) {
        expect(ok[u * pins + v]).toBe(ok[v * pins + u]);
        if (u === v || side[u] === side[v] || circDist(u, v, pins) < minSkip) expect(ok[u * pins + v]).toBe(0);
      }
    }
  });

  it("asks a line to leave both its sides at (minSkip - 1) x 180 / pins degrees or more, 30 at most", () => {
    for (const aspect of ASPECTS) for (const [pins, minSkip] of [[256, 20], [128, 20], [96, 30], [64, 1]] as const) {
      const ok = allowedPairs({ pins, minSkip, shape: "rect", aspect }), P = unitPins(pins, aspect), counts = sideCounts(pins, aspect), side: number[] = [];
      counts.forEach((n, s) => { for (let j = 0; j < n; j++) side.push(s); });
      const least = Math.min(30, ((minSkip - 1) * 180) / pins);
      let allowed = 0, edge = 0;
      for (let u = 0; u < pins; u++) for (let v = u + 1; v < pins; v++) {
        if (side[u] === side[v] || circDist(u, v, pins) < minSkip) continue;
        const dx = Math.abs(P[2 * v]! - P[2 * u]!), dy = Math.abs(P[2 * v + 1]! - P[2 * u + 1]!);
        // the angle between the line and a horizontal side is atan(dy / dx), with a vertical side atan(dx / dy)
        const leave = (s: number) => (Math.atan2(s % 2 ? dx : dy, s % 2 ? dy : dx) * 180) / Math.PI, angle = Math.min(leave(side[u]!), leave(side[v]!));
        if (Math.abs(angle - least) < 1e-6) { edge++; continue; }
        expect(ok[u * pins + v], `${pins} pins, ${aspect}: ${u}-${v} leaves at ${angle}`).toBe(angle > least ? 1 : 0);
        allowed += ok[u * pins + v]!;
      }
      expect(allowed).toBeGreaterThan(pins);
      expect(edge).toBeLessThan(pins);
    }
  });

  it("with the default settings leaves every pin about half as many partners as on the circle", () => {
    const circle = allowedPairs({ pins: 256, minSkip: 20 }).reduce((a, v) => a + v, 0) / 256;
    expect(circle).toBe(217);
    for (const aspect of ASPECTS) {
      const ok = allowedPairs({ pins: 256, minSkip: 20, shape: "rect", aspect });
      let fewest = Infinity, total = 0;
      for (let u = 0; u < 256; u++) { let n = 0; for (let v = 0; v < 256; v++) n += ok[u * 256 + v]!; fewest = Math.min(fewest, n); total += n; }
      expect(fewest, `aspect ${aspect}`).toBeGreaterThanOrEqual(90);
      expect(total / 256).toBeGreaterThan(110);
    }
  });

  it("leaves every pin a partner up to a minimum skip of a quarter of the pins", () => {
    for (const aspect of ASPECTS) for (const pins of [64, 65, 127, 256, 512]) {
      const minSkip = Math.floor(pins / 4), ok = allowedPairs({ pins, minSkip, shape: "rect", aspect });
      let fewest = Infinity;
      for (let u = 0; u < pins; u++) { let n = 0; for (let v = 0; v < pins; v++) n += ok[u * pins + v]!; fewest = Math.min(fewest, n); }
      expect(fewest, `${pins} pins, aspect ${aspect}`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("a rectangle in millimetres", () => {
  it("has the longer side as its size, and the pins of the unit rectangle scaled", () => {
    expect(frameSizeMm({ diameterMm: 500, shape: "rect", aspect: 0.75 })).toEqual({ width: 375, height: 500 });
    expect(frameSizeMm({ diameterMm: 600, shape: "rect", aspect: 1.5 })).toEqual({ width: 600, height: 400 });
    const frame = { pins: 256, diameterMm: 500, shape: "rect" as const, aspect: 0.75 }, mm = rectPinsMm(frame), counts = sideCounts(256, 0.75);
    expect(mm.at.length).toBe(512);
    expect(mm.at[0]).toBeCloseTo(375 / 55 / 2, 9);
    expect(mm.at[1]).toBe(0);
    expect(Array.from(mm.side.slice(53, 57))).toEqual([0, 0, 1, 1]);
    for (let i = 0; i < 256; i++) {
      const x = mm.at[2 * i]!, y = mm.at[2 * i + 1]!, s = mm.side[i]!;
      expect(s === 0 ? y : s === 1 ? x - 375 : s === 2 ? y - 500 : x).toBeCloseTo(0, 9);
      expect(x >= -1e-9 && x <= 375 + 1e-9 && y >= -1e-9 && y <= 500 + 1e-9).toBe(true);
    }
    expect(counts).toEqual([55, 73, 55, 73]);
  });

  it("measures thread pin to pin in a straight line, plus half a turn round each pin", () => {
    const o = options({ shape: "rect", aspect: 0.75, diameterMm: 500 }), mm = rectPinsMm({ pins: 256, diameterMm: 500, shape: "rect", aspect: 0.75 });
    const seq = [3, 150, 70, 220, 10], by = (a: number, b: number) => Math.hypot(mm.at[2 * b]! - mm.at[2 * a]!, mm.at[2 * b + 1]! - mm.at[2 * a + 1]!);
    const want = by(3, 150) + by(150, 70) + by(70, 220) + by(220, 10) + 4 * ((Math.PI * 1.5) / 2);
    expect(frameThreadMm(o, seq)).toBeCloseTo(want, 9);
    expect(frameThreadMm(o, seq, 3)).toBeCloseTo(want + 4 * ((Math.PI * 1.5) / 2), 9);
    expect(frameThreadMm(o, [])).toBe(0);
    expect(frameThreadMm(o, [5])).toBe(0);
    // the same piece twice the size needs twice the lines' length
    expect(frameThreadMm({ ...o, diameterMm: 1000 }, seq, 0)).toBeCloseTo(2 * frameThreadMm(o, seq, 0), 9);
  });

  it("says how far apart the pins are, and that the nearest two stand either side of a corner", () => {
    const s = pinSpacingMm({ pins: 256, diameterMm: 500, shape: "rect", aspect: 0.75 });
    expect(s.along).toBeCloseTo(1750 / 256, 9);
    expect(s.nearest).toBeCloseTo(Math.hypot(375 / 55 / 2, 500 / 73 / 2), 9);
    expect(s.nearest / s.along).toBeGreaterThan(0.69);
    expect(s.nearest / s.along).toBeLessThan(0.72);
  });
});

describe("the picture in a rectangular frame", () => {
  it("gives the frame the picture's proportions, turned with it at a quarter turn", () => {
    expect(pictureAspect(658, 873)).toBe(658 / 873);
    expect(pictureAspect(658, 873, 90)).toBe(873 / 658);
    expect(pictureAspect(658, 873, -90)).toBe(873 / 658);
    expect(pictureAspect(658, 873, 180)).toBe(658 / 873);
    expect(pictureAspect(658, 873, 44)).toBe(658 / 873);
    expect(pictureAspect(658, 873, 46)).toBe(873 / 658);
    expect(pictureAspect(658, 873, 45)).toBe(658 / 873);
    expect(pictureAspect(4000, 500)).toBe(4);
    expect(pictureAspect(100, 1000)).toBe(0.25);
    expect(pictureAspect(0, 0)).toBe(1);
    expect(pictureAspect(300, 300, 33)).toBe(1);
  });

  it("at scale 1 the picture covers the frame with two working pixels to spare, however it is turned", () => {
    expect(FRAME_SPARE).toBe(2);
    const S = FRAME_SPARE;
    const r = mulberry32(8);
    for (let i = 0; i < 400; i++) {
      const width = 40 + Math.floor(3000 * r()), height = 40 + Math.floor(3000 * r()), res = 64 + Math.floor(700 * r());
      const rotateDeg = i % 4 === 0 ? [0, 90, 180, -90][(i / 4) % 4]! : 360 * r() - 180, aspect = i % 3 === 0 ? clampAspect(0.25 * 16 ** r()) : pictureAspect(width, height, rotateDeg);
      const frame = { shape: "rect" as const, aspect }, span = cropSpan(frame, rotateDeg, width, height, res), b = frameBounds({ res, ...frame });
      const t = cropTransform({ cx: 0.5, cy: 0.5, scale: 1, rotateDeg }, width, height, res, span);
      let slack = Infinity;
      for (const [x, y] of [[b.x0 - S, b.y0 - S], [b.x1 + S, b.y0 - S], [b.x1 + S, b.y1 + S], [b.x0 - S, b.y1 + S]] as const) {
        const dx = x - t.c, dy = y - t.c, u = t.x0 + t.k * (dx * t.cos + dy * t.sin), v = t.y0 + t.k * (dy * t.cos - dx * t.sin);
        expect(u, `${width} x ${height} at ${rotateDeg}`).toBeGreaterThanOrEqual(-1e-6);
        expect(v).toBeGreaterThanOrEqual(-1e-6);
        expect(u).toBeLessThanOrEqual(width + 1e-6);
        expect(v).toBeLessThanOrEqual(height + 1e-6);
        slack = Math.min(slack, u, v, width - u, height - v);
      }
      // and no more than covers it: one corner of that margin is on the picture's edge
      expect(slack).toBeLessThan(1e-6 * Math.max(width, height));
    }
  });

  it("with the picture's own proportions and no turn, the frame shows all of the picture but those pixels", () => {
    for (const [width, height] of [[658, 873], [1200, 800], [500, 500]] as const) {
      const res = 400, aspect = pictureAspect(width, height), frame = { shape: "rect" as const, aspect }, b = frameBounds({ res, ...frame });
      const t = cropTransform({ cx: 0.5, cy: 0.5, scale: 1, rotateDeg: 0 }, width, height, res, cropSpan(frame, 0, width, height, res));
      const left = t.x0 + t.k * (b.x0 - t.c), right = t.x0 + t.k * (b.x1 - t.c), top = t.y0 + t.k * (b.y0 - t.c), bottom = t.y0 + t.k * (b.y1 - t.c);
      // the frame's outline is two working pixels inside the picture's edge on two sides, and at most a pixel
      // and a half more on the other two (the spare pixels are the same number both ways, the sides are not)
      for (const gap of [left, width - right, top, height - bottom]) { expect(gap).toBeGreaterThanOrEqual(FRAME_SPARE * t.k - 1e-9); expect(gap).toBeLessThan((FRAME_SPARE + 1.5) * t.k); }
      expect(Math.min(left, top)).toBeCloseTo(FRAME_SPARE * t.k, 9);
    }
  });
});

describe("the circle's own functions", () => {
  it("are used by frame.ts alone: every other part of the app asks frame.ts, so it cannot draw a circle by mistake", () => {
    const root = join(__dirname, "../../src"), names = /\b(pinPositions|circleMask|circDist|chordMm|threadLengthMm)\b/;
    // the reference itself, the frame module, and the two that reproduce the spec's benchmarks on the circle
    const may = new Set(["core/stringart.ts", "core/frame.ts", "core/benchmarks.ts", "app/testHooks.ts"]);
    const offenders: string[] = [];
    const walk = (dir: string, rel: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name), name = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path, name);
        else if (name.endsWith(".ts") && !may.has(name)) {
          // comments may name them; code may not
          const code = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
          if (names.test(code)) offenders.push(name);
        }
      }
    };
    walk(root, "");
    expect(offenders).toEqual([]);
  });
});
