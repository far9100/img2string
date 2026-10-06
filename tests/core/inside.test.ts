// Pins inside the picture (DECISIONS D-60): where they are put, how they are held beside the frame's pins,
// which two pins a thread may then join, and the way round the frame.
import { describe, expect, it } from "vitest";
import {
  allowedPairs, aroundFrame, clearanceMm, frameBounds, frameMask, framePins, frameThreadMm, insideCount, insideMm, isRound, joinRule, pinCount, pinOf, roundTo,
  tooDenseForInside, unitAll, type FrameOptions, type Joinable,
} from "../../src/core/frame.ts";
import { BAND_MM, INSIDE_MAX, insideGapMm, placeInside, placeRes, type PlaceInput } from "../../src/core/inside.ts";
import { oklab } from "../../src/core/stringart.ts";
import { discAndBar, lineDrawing } from "../helpers/pictures.ts";
import { mulberry32 } from "../helpers/rng.ts";

// 200 mm across 161 pixels: the 1.25 mm a pixel the pins are placed at
const place = (over: Partial<PlaceInput> = {}): PlaceInput => ({ res: 161, board: [1, 1, 1], diameterMm: 200, pinDiameterMm: 1.5, ...over });
const points = (inside: readonly number[]): [number, number][] => Array.from({ length: inside.length / 2 }, (_, j): [number, number] => [inside[2 * j]!, inside[2 * j + 1]!]);
const sameBits = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((v, i) => Object.is(v, b[i]));

describe("where the pins inside the picture stand", () => {
  const o = place(), L = o.res - 1, picture = lineDrawing(o.res, 2), W = frameMask(o), gap = insideGapMm(o.pinDiameterMm) / (o.diameterMm / L);

  it("on the picture's ink, the gap from one another and from the frame's outline", () => {
    const pins = points(placeInside(picture, W, o, 60));
    expect(pins).toHaveLength(60);
    for (const [x, y] of pins) {
      const gx = x * L, gy = y * L, p = 3 * (Math.round(gy) * o.res + Math.round(gx));
      // a pixel of the grid, and one that is ink: at least 0.1 from the board in OKLab
      expect(Math.abs(gx - Math.round(gx)) + Math.abs(gy - Math.round(gy))).toBeLessThan(1e-3);
      expect(1 - oklab(picture[p]!, picture[p + 1]!, picture[p + 2]!)[0]).toBeGreaterThanOrEqual(0.1);
      expect(Math.hypot(gx - L / 2, gy - L / 2)).toBeLessThanOrEqual(L / 2 - gap + 1e-3);
    }
    for (let i = 0; i < pins.length; i++) for (let j = i + 1; j < pins.length; j++) {
      expect(Math.hypot((pins[i]![0] - pins[j]![0]) * L, (pins[i]![1] - pins[j]![1]) * L), `pins ${i} and ${j}`).toBeGreaterThanOrEqual(gap - 1e-3);
    }
  });

  it("are the same every time, and the same numbers after a trip through a file", () => {
    const a = placeInside(picture, W, o, 40);
    expect(placeInside(picture, W, o, 40)).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    for (const v of a) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
      expect(Number(v.toFixed(6))).toBe(v);
    }
  });

  it("are as many as were asked for while the picture has room, and none on a picture with no ink", () => {
    expect(placeInside(picture, W, o, 0)).toEqual([]);
    expect(placeInside(picture, W, o, -3)).toEqual([]);
    expect(placeInside(picture, W, o, 5)).toHaveLength(10);
    // this drawing has about 0.7 m of outline: at 6 mm apart, not far over a hundred pins
    const all = placeInside(picture, W, o, 100_000).length / 2;
    expect(all).toBeGreaterThan(50);
    expect(all).toBeLessThan(250);
    expect(all).toBeLessThanOrEqual(INSIDE_MAX);
    expect(placeInside(new Float64Array(3 * o.res * o.res).fill(1), W, o, 50)).toEqual([]);
    // a frame too small to hold a pin the gap inside its outline
    expect(placeInside(picture, W, { ...o, pinDiameterMm: 30 }, 50)).toEqual([]);
  });

  it("a longer list holds the shorter one: more pins never move those there are", () => {
    const few = new Set(points(placeInside(picture, W, o, 25)).map(String)), more = new Set(points(placeInside(picture, W, o, 40)).map(String));
    expect(few.size).toBe(25);
    for (const pin of few) expect(more.has(pin), pin).toBe(true);
  });

  it("are numbered down the page: in bands of 25 mm from the top, and from left to right in a band", () => {
    const pins = points(placeInside(picture, W, o, 80)), band = (y: number) => Math.floor((y * o.diameterMm) / BAND_MM);
    expect(new Set(pins.map(([, y]) => band(y))).size).toBeGreaterThan(3);
    for (let i = 1; i < pins.length; i++) {
      expect(band(pins[i]![1])).toBeGreaterThanOrEqual(band(pins[i - 1]![1]));
      if (band(pins[i]![1]) === band(pins[i - 1]![1])) expect(pins[i]![0]).toBeGreaterThanOrEqual(pins[i - 1]![0]);
    }
  });

  it("stand only where the picture counts, and closer where it counts for more", () => {
    const left = W.slice(), c = L / 2;
    for (let y = 0; y < o.res; y++) for (let x = 0; x < o.res; x++) if (x < c) left[y * o.res + x] = 0;
    const kept = points(placeInside(picture, left, o, 60));
    expect(kept.length).toBeGreaterThan(10);
    for (const [x] of kept) expect(x * L).toBeGreaterThanOrEqual(c);
    // the same count with the lower half painted three times as important: more of the pins are there
    const low = W.map((w, p) => (Math.floor(p / o.res) > c ? 3 * w : w)), below = (list: [number, number][]) => list.filter(([, y]) => y * L > c).length;
    expect(below(points(placeInside(picture, low, o, 30)))).toBeGreaterThan(below(points(placeInside(picture, W, o, 30))));
  });

  it("stay the gap inside a rectangular frame too, and thick pins stand further apart", () => {
    const r = place({ shape: "rect", aspect: 0.75 }), b = frameBounds(r), pins = points(placeInside(discAndBar(r.res), frameMask(r), r, 80));
    expect(pins.length).toBeGreaterThan(20);
    for (const [x, y] of pins) expect(Math.min(x * L - b.x0, b.x1 - x * L, y * L - b.y0, b.y1 - y * L)).toBeGreaterThanOrEqual(gap - 1e-3);
    expect([insideGapMm(1.5), insideGapMm(0.5), insideGapMm(3)]).toEqual([6, 6, 12]);
    const thick = points(placeInside(picture, W, { ...o, pinDiameterMm: 3 }, 60)), wide = 12 / (o.diameterMm / L);
    for (let i = 0; i < thick.length; i++) for (let j = i + 1; j < thick.length; j++) expect(Math.hypot((thick[i]![0] - thick[j]![0]) * L, (thick[i]![1] - thick[j]![1]) * L)).toBeGreaterThanOrEqual(wide - 1e-3);
  });

  it("are placed on a grid of 1.25 mm a pixel, whatever the working resolution, and never on more than 401 pixels", () => {
    expect([200, 300, 500, 1000].map(placeRes)).toEqual([161, 241, 401, 401]);
  });
});

describe("the frame's pins with pins inside the picture after them", () => {
  const inside = [0.5, 0.5, 0.25, 0.6, 0.7, 0.3];

  it("keeps the frame's pins as they are and puts the others on the grid by their fractions", () => {
    for (const frame of [{}, { shape: "rect" as const, aspect: 0.75 }]) {
      const alone = framePins({ pins: 48, res: 101, ...frame }), all = framePins({ pins: 48, res: 101, ...frame, inside });
      expect(all).toHaveLength(2 * 51);
      expect(sameBits(all.subarray(0, 96), alone)).toBe(true);
      expect(Array.from(all.subarray(96))).toEqual(inside.map((v) => v * 100));
      const U = unitAll({ pins: 48, ...frame, inside });
      for (let i = 0; i < all.length; i++) expect(U[i]! * 100).toBeCloseTo(all[i]!, 9);
      expect([pinCount({ pins: 48, ...frame, inside }), insideCount({ inside }), insideCount({}), pinCount({ pins: 48 })]).toEqual([51, 3, 0, 48]);
    }
    // an empty list is no pins inside: the frame's own array
    expect(sameBits(framePins({ pins: 64, res: 90, inside: [] }), framePins({ pins: 64, res: 90 }))).toBe(true);
  });

  it("says where a pin inside is in millimetres from the left and the top of the frame", () => {
    expect(insideMm({ diameterMm: 500 }, [0.25, 0.5], 0)).toEqual({ left: 125, top: 250 });
    // a rectangle 375 mm wide stands 62.5 mm in from the left of the square grid
    expect(insideMm({ diameterMm: 500, shape: "rect", aspect: 0.75 }, [0.9, 0.9, 0.5, 0.5], 1)).toEqual({ left: 187.5, top: 250 });
  });

  it("holds a step round the frame as a pin below zero, and reads every entry back as its pin", () => {
    for (const pin of [0, 5, 255, 1111]) {
      expect(roundTo(pin)).toBeLessThan(0);
      expect([isRound(roundTo(pin)), pinOf(roundTo(pin)), isRound(pin), pinOf(pin)]).toEqual([true, pin, false, pin]);
    }
  });
});

/** Which pins may be joined, by trying every third pin against every pair. */
function tryEveryPin(o: Joinable): Uint8Array {
  const F = o.pins, N = pinCount(o), U = unitAll(o), frame = allowedPairs({ pins: F, minSkip: o.minSkip, shape: o.shape, aspect: o.aspect }), clear = clearanceMm(o) / o.diameterMm!;
  const far = (w: number, u: number, v: number): boolean => {
    const ax = U[2 * u]!, ay = U[2 * u + 1]!, dx = U[2 * v]! - ax, dy = U[2 * v + 1]! - ay, t = Math.max(0, Math.min(1, ((U[2 * w]! - ax) * dx + (U[2 * w + 1]! - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(U[2 * w]! - ax - t * dx, U[2 * w + 1]! - ay - t * dy) >= clear;
  };
  const ok = new Uint8Array(N * N);
  for (let u = 0; u < N; u++) for (let v = u + 1; v < N; v++) {
    const both = u < F && v < F;
    let fine = both ? frame[u * F + v] === 1 : true;
    for (let w = both ? F : 0; fine && w < N; w++) if (w !== u && w !== v && !far(w, u, v)) fine = false;
    if (fine) ok[u * N + v] = ok[v * N + u] = 1;
  }
  return ok;
}

describe("which two pins a thread may join when there are pins inside", () => {
  const scattered = (count: number, seed: number): number[] => { const r = mulberry32(seed); return Array.from({ length: 2 * count }, () => Number((0.2 + 0.6 * r()).toFixed(6))); };
  const cases: Joinable[] = [
    { pins: 48, minSkip: 5, diameterMm: 300, threadWidthMm: 0.5, pinDiameterMm: 2, inside: scattered(30, 1) },
    { pins: 64, minSkip: 6, diameterMm: 250, threadWidthMm: 0.25, pinDiameterMm: 1.5, shape: "rect", aspect: 0.75, inside: scattered(30, 2).map((v, i) => (i % 2 ? v : 0.25 + 0.5 * v)) },
    { pins: 56, minSkip: 4, diameterMm: 400, threadWidthMm: 0.6, pinDiameterMm: 3, shape: "rect", aspect: 2, inside: scattered(24, 3).map((v, i) => (i % 2 ? 0.3 + 0.4 * v : v)) },
  ];

  it("is the pin's radius, the thread's and half a millimetre from any pin it passes: the round frame's own rule", () => {
    expect([clearanceMm({}), clearanceMm({ threadWidthMm: 0.5, pinDiameterMm: 2 })]).toEqual([1.375, 1.75]);
    // 256 pins on 500 mm: a chord 19 pins long passes the pin next to its end nearer than that, one 20 long does not
    const U = unitAll({ pins: 256 }), next = (v: number): number => {
      const dx = U[2 * v]! - U[0]!, dy = U[2 * v + 1]! - U[1]!, t = ((U[2]! - U[0]!) * dx + (U[3]! - U[1]!) * dy) / (dx * dx + dy * dy);
      return 500 * Math.hypot(U[2]! - U[0]! - t * dx, U[3]! - U[1]! - t * dy);
    };
    expect(next(19)).toBeCloseTo(1.344, 3);
    expect(next(20)).toBeCloseTo(1.418, 3);
    expect(next(19)).toBeLessThan(clearanceMm({}));
    expect(next(20)).toBeGreaterThan(clearanceMm({}));
  });

  it("is what trying every pin against every pair gives, on a round and on two rectangular frames", () => {
    for (const o of cases) {
      const N = pinCount(o), F = o.pins, ok = allowedPairs(o), want = tryEveryPin(o), frame = allowedPairs({ pins: F, minSkip: o.minSkip, shape: o.shape, aspect: o.aspect });
      expect(ok).toHaveLength(N * N);
      let wrong = 0, lop = 0, lost = 0, among = 0;
      for (let u = 0; u < N; u++) for (let v = 0; v < N; v++) {
        if (ok[u * N + v] !== want[u * N + v]) wrong++;
        if (ok[u * N + v] !== ok[v * N + u]) lop++;
        if (u < F && v < F && frame[u * F + v] && !ok[u * N + v]) lost++;
        if (u >= F && v > u && ok[u * N + v]) among++;
        // two pins of the frame are never joined where the frame alone would not join them
        if (u < F && v < F && ok[u * N + v]) expect(frame[u * F + v]).toBe(1);
      }
      expect([wrong, lop]).toEqual([0, 0]);
      for (let u = 0; u < N; u++) expect(ok[u * N + u]).toBe(0);
      expect(lost).toBeGreaterThan(0); // some of the frame's own lines now pass a pin inside
      expect(among).toBeGreaterThan(0);
      expect(among).toBeLessThan((N - F) * (N - F - 1) / 2); // and some pairs inside have a pin between them
    }
  });

  it("is kept for the next piece with the same pins, and made again for another", () => {
    const o = cases[0]!, table = allowedPairs(o);
    expect(allowedPairs({ ...o, inside: Array.from(o.inside!) })).toBe(table);
    const other = allowedPairs({ ...o, minSkip: 6 });
    expect(other).not.toBe(table);
    expect(allowedPairs({ ...o, inside: Array.from(o.inside!).map((v, i) => (i ? v : v + 0.01)) })).not.toBe(other);
    // without pins inside nothing is kept: a table of the frame's own, to change as one likes
    expect(allowedPairs({ pins: 48, minSkip: 5 })).not.toBe(allowedPairs({ pins: 48, minSkip: 5 }));
    expect(allowedPairs({ pins: 48, minSkip: 5, inside: [] })).toHaveLength(48 * 48);
  });

  it("can be asked pair by pair, with a little slack for a piece made elsewhere", () => {
    // two pins inside with a third just nearer their line than the clearance
    const clear = clearanceMm({}) / 500, o: Joinable = { pins: 8, minSkip: 1, diameterMm: 500, inside: [0.3, 0.5, 0.7, 0.5, 0.5, 0.5 + 0.9995 * clear] };
    expect(joinRule(o)(8, 9)).toBe(false);
    expect(joinRule(o, 0.999)(8, 9)).toBe(true);
    expect(joinRule(o)(8, 10)).toBe(true);
    expect(joinRule(o)(8, 8)).toBe(false);
    const table = allowedPairs(o), may = joinRule(o);
    for (let u = 0; u < 11; u++) for (let v = 0; v < 11; v++) expect(may(u, v), `${u}-${v}`).toBe(table[u * 11 + v] === 1);
    // with no pins inside the rule is the frame's
    const plain = joinRule({ pins: 64, minSkip: 6 });
    expect([plain(0, 5), plain(0, 6), plain(0, 60)]).toEqual([false, true, false]);
  });

  it("says when the frame's pins stand too close for a line to leave the frame", () => {
    expect(tooDenseForInside({ pins: 256, diameterMm: 500 }, 0.25)).toBe(false);
    expect(tooDenseForInside({ pins: 512, diameterMm: 200 }, 0.25)).toBe(true);
    expect(tooDenseForInside({ pins: 256, diameterMm: 500, pinDiameterMm: 5 }, 0.25)).toBe(true); // 6.1 mm apart, 3.1 mm to clear
  });
});

describe("the way round the frame", () => {
  it("is the shorter way round a circle, in units of its diameter", () => {
    expect(aroundFrame({ pins: 256 }, 0, 64)).toEqual({ length: Math.PI / 4, clockwise: true });
    const back = aroundFrame({ pins: 256 }, 0, 200);
    expect(back.clockwise).toBe(false);
    expect(back.length).toBeCloseTo((56 / 256) * Math.PI, 12);
    expect(aroundFrame({ pins: 256 }, 10, 10)).toEqual({ length: 0, clockwise: true });
    expect(aroundFrame({ pins: 256 }, 0, 128).clockwise).toBe(true); // as long both ways: clockwise
  });

  it("goes round the corners of a rectangle", () => {
    // 256 pins round 0.75 x 1: 55, 73, 55, 73. From the last pin of the top to the first of the right side
    const frame = { pins: 256, shape: "rect" as const, aspect: 0.75 }, corner = aroundFrame(frame, 54, 55);
    expect(corner.clockwise).toBe(true);
    expect(corner.length).toBeCloseTo(0.75 / 55 / 2 + 1 / 73 / 2, 12);
    const whole = 2 * (0.75 + 1), far = aroundFrame(frame, 0, 128); // to the first pin of the bottom side: half way round
    expect(far.length).toBeCloseTo(whole / 2, 12);
    expect(aroundFrame(frame, 55, 54)).toEqual({ length: corner.length, clockwise: false });
  });

  it("is measured into the thread: a step round the frame by its outline, the others pin to pin", () => {
    const o: FrameOptions = { res: 200, pins: 64, diameterMm: 400, threadWidthMm: 0.25, board: [1, 1, 1], threads: [[0, 0, 0]], maxLines: [100], minSkip: 6, allowRepeat: false, inside: [0.5, 0.5] };
    // top of the circle, the pin in the middle, pin 11, round to pin 31, the middle again
    const turn = (Math.PI * 1.5) / 2, length = frameThreadMm(o, [0, 64, 10, roundTo(30), 64], 1.5);
    expect(length).toBeCloseTo(200 + 200 + (20 / 64) * Math.PI * 400 + 200 + 4 * turn, 9);
    // the same pins without the walk: a chord instead of the arc
    expect(frameThreadMm(o, [0, 64, 10, 30, 64], 1.5)).toBeCloseTo(600 + 400 * Math.sin((Math.PI * 20) / 64) + 4 * turn, 9);
  });
});
