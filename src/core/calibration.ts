// Thread calibration (spec §6.6, M2). The effective thread width decides how dark one line is in the model;
// fuzz and shadows make a thread look wider than its label. Either pick a typical width, or measure it: wind
// a patch of parallel threads (for instance n turns side by side over a strip of the board L mm wide),
// photograph it together with a bare part of the board, and the width follows from how much darker the patch
// is. With coverage a = width x n / L, the patch reflects a x thread + (1 - a) x board, so
//     a = (1 - patch / board) / (1 - thread / board)
// where patch / board is measured in the photograph (in linear light, so the exposure cancels) and
// thread / board comes from the two colours of the palette.
import { luminance } from "./palette.ts";

/** Typical effective widths (mm) of §6.6's presets. */
export const THREAD_PRESETS = [
  { id: "fine", widthMm: 0.15 },
  { id: "standard", widthMm: 0.25 },
  { id: "floss", widthMm: 0.4 },
] as const;

export interface PatchMeasure {
  /** Mean linear luminance of the bare board and of the patch in the photograph (any common scale). */
  board: number;
  patch: number;
  /** Threads in the patch and the width they span, in mm. */
  threads: number;
  spanMm: number;
  boardHex: string;
  threadHex: string;
}

export interface Calibration {
  /** Share of the patch the threads cover, 0..1. */
  coverage: number;
  widthMm: number;
  /** Why the result should not be trusted, if so. */
  problem: "none" | "same-colour" | "too-light" | "too-dense" | "invalid";
}

/** The effective thread width that reproduces the patch's darkness. */
export function calibrate(m: PatchMeasure): Calibration {
  if (!(m.board > 0) || !(m.patch >= 0) || !(m.threads > 0) || !(m.spanMm > 0)) return { coverage: 0, widthMm: 0, problem: "invalid" };
  const contrast = 1 - luminance(m.threadHex) / luminance(m.boardHex);
  if (Math.abs(contrast) < 0.05) return { coverage: 0, widthMm: 0, problem: "same-colour" };
  const coverage = (1 - m.patch / m.board) / contrast;
  const widthMm = (coverage * m.spanMm) / m.threads;
  // Too little coverage drowns in the photograph's noise; with too much, threads overlap and the patch stops
  // getting darker in proportion, so the width comes out too small.
  const problem = !(coverage > 0.03) ? "too-light" : coverage > 0.75 ? "too-dense" : "none";
  return { coverage: Math.min(1, Math.max(0, coverage)), widthMm: Math.max(0, widthMm), problem };
}

/** Mean linear luminance of a rectangle of an sRGB RGBA image (x0, y0 inclusive; x1, y1 exclusive). */
export function meanLuminance(rgba: ArrayLike<number>, width: number, height: number, x0: number, y0: number, x1: number, y1: number): number {
  const lin = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const ax = Math.max(0, Math.floor(Math.min(x0, x1))), bx = Math.min(width, Math.ceil(Math.max(x0, x1)));
  const ay = Math.max(0, Math.floor(Math.min(y0, y1))), by = Math.min(height, Math.ceil(Math.max(y0, y1)));
  let sum = 0, n = 0;
  for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) {
    const q = 4 * (y * width + x);
    sum += 0.2126 * lin(rgba[q]!) + 0.7152 * lin(rgba[q + 1]!) + 0.0722 * lin(rgba[q + 2]!);
    n++;
  }
  return n ? sum / n : 0;
}
