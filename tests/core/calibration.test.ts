// Thread calibration (§6.6): the width that reproduces how dark a patch of parallel threads is.
import { describe, expect, it } from "vitest";
import { calibrate, meanLuminance, THREAD_PRESETS } from "../../src/core/calibration.ts";
import { luminance } from "../../src/core/palette.ts";
import { linearToSrgb } from "../../src/core/stringart.ts";

const base = { threads: 40, spanMm: 30, boardHex: "#FFFFFF", threadHex: "#111111" };

describe("calibrate", () => {
  it("recovers the width a simulated patch was made with", () => {
    for (const width of [0.15, 0.25, 0.4]) {
      const coverage = (width * base.threads) / base.spanMm;
      const board = 0.82, thread = board * luminance("#111111"); // any exposure: only the ratio counts
      const patch = coverage * thread + (1 - coverage) * board;
      const c = calibrate({ ...base, board, patch });
      expect(c.widthMm).toBeCloseTo(width, 10);
      expect(c.coverage).toBeCloseTo(coverage, 10);
      expect(c.problem).toBe("none");
    }
  });

  it("works for a light thread on a dark board", () => {
    const boardHex = "#111111", threadHex = "#F2F2F2", coverage = 0.3, board = 0.02;
    const patch = coverage * (board * luminance(threadHex) / luminance(boardHex)) + (1 - coverage) * board;
    expect(calibrate({ threads: 30, spanMm: 25, boardHex, threadHex, board, patch }).widthMm).toBeCloseTo((0.3 * 25) / 30, 10);
  });

  it("says when the photograph cannot give a width", () => {
    expect(calibrate({ ...base, board: 0.8, patch: 0.79 }).problem).toBe("too-light");
    expect(calibrate({ ...base, board: 0.8, patch: 0.1 }).problem).toBe("too-dense");
    expect(calibrate({ ...base, threadHex: "#FCFCFC", board: 0.8, patch: 0.5 }).problem).toBe("same-colour");
    expect(calibrate({ ...base, board: 0, patch: 0.5 }).problem).toBe("invalid");
    expect(calibrate({ ...base, threads: 0, board: 0.8, patch: 0.5 }).problem).toBe("invalid");
  });

  it("offers the three typical threads of §6.6, the default among them", () => {
    expect(THREAD_PRESETS.map((p) => p.widthMm)).toEqual([0.15, 0.25, 0.4]);
  });
});

describe("meanLuminance", () => {
  it("averages a rectangle in linear light", () => {
    const w = 4, h = 2, rgba = new Uint8ClampedArray(4 * w * h);
    const set = (x: number, y: number, v: number) => rgba.set([v, v, v, 255], 4 * (y * w + x));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, x < 2 ? 0 : 255);
    expect(meanLuminance(rgba, w, h, 0, 0, 2, 2)).toBe(0);
    expect(meanLuminance(rgba, w, h, 2, 0, 4, 2)).toBeCloseTo(1, 12);
    expect(meanLuminance(rgba, w, h, 0, 0, 4, 2)).toBeCloseTo(0.5, 12); // not the sRGB average, which would be 0.21
    expect(meanLuminance(rgba, w, h, 4, 2, 2, 0)).toBeCloseTo(1, 12); // corners in any order
    expect(meanLuminance(rgba, w, h, 9, 9, 12, 12)).toBe(0); // outside the picture
    const mid = Math.round(255 * linearToSrgb(0.25));
    set(0, 0, mid);
    expect(meanLuminance(rgba, w, h, 0, 0, 1, 1)).toBeCloseTo(0.25, 2);
  });
});
