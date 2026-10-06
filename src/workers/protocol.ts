// Messages between the page and its workers: discriminated on `t`, matched by `id` (after img2shadow's
// worker/protocol.ts). Typed arrays travel as transferables where the sender no longer needs them.
import type { FrameOptions, FrameSpec } from "../core/frame.ts";
import type { Tuning } from "../core/autoAdjust.ts";
import type { GamutSummary } from "../core/gamut.ts";
import type { Adjust, Crop, ImportancePreset, Mode, StopReason, Stroke } from "../core/project.ts";
import type { Options, RGB } from "../core/stringart.ts";
import type { SampleId } from "../core/targets.ts";
import type { Region } from "../core/truewidth.ts";

// ---------- generate.worker: one greedy run, or one score-only run for the winding-order search or the
// automatic adjustment

export type ToGen =
  | { t: "start"; id: number; options: FrameOptions; target: Float64Array; weight: Float64Array; resume: number[][] | null; preview: boolean }
  | { t: "stop"; id: number }
  /** Runs to the end without progress and answers with the error only (the winding-order search, §6.3). */
  | { t: "score"; id: number; options: FrameOptions; target: Float64Array; weight: Float64Array }
  /** Makes the target from the picture with these sliders, runs to the end and answers with how close the piece
   * at true thread width is to the picture (automatic adjustment, DECISIONS D-55). `picture` is the cropped
   * picture before any adjustment and `painted` the importance map without automatic emphasis. */
  | { t: "tune"; id: number; options: FrameOptions; mode: Mode; picture: Float64Array; painted: Float64Array; invert: boolean; tuning: Tuning }
  /** Runs the specification's own generate() (§12) here, so its time can be compared with the app's
   * generator in the same browser and worker (§13.4, DECISIONS D-08). */
  | { t: "reference"; id: number; options: FrameOptions; target: Float64Array; weight: Float64Array };

export type FromGen =
  /** Every 100 lines (§5.2). `tail` holds the (thread, pin) pairs appended since the previous message, so the
   * page always has the complete sequences, whatever happens to the worker. */
  | { t: "progress"; id: number; lines: number[]; error: number; initialError: number; tail: Int32Array; rgba: Uint8ClampedArray | null }
  | {
      t: "done"; id: number; reason: StopReason; sequences: number[][]; error: number; initialError: number;
      /** Mean Delta-E_OK x 100 inside the circle: the bare board, then the result. */
      deltaE: [number, number];
      unstarted: number[]; budgetBlocked: number[]; ms: number; rgba: Uint8ClampedArray;
    }
  | { t: "scored"; id: number; error: number; initialError: number; lines: number[]; ms: number }
  | { t: "tuned"; id: number; similarity: number; lines: number[]; ms: number }
  | { t: "reference"; id: number; sequences: number[][]; ms: number }
  | { t: "error"; id: number; code: string; detail?: string };

// ---------- preprocess.worker: keeps the picture's pixels and makes the target and the importance map

export interface TargetRequest {
  res: number;
  /** The frame's shape: the crop and the weights depend on it (nothing for a round frame). */
  frame: FrameSpec;
  crop: Crop;
  adjust: Adjust;
  mode: Mode;
  board: RGB;
  threads: RGB[];
  preset: ImportancePreset;
  strokes: Stroke[];
  /** Automatic emphasis (§6.5, §13.5): strength of the edge factor and amount of the tone factor; 0 is off. */
  edges: number;
  tone: number;
  /** Also check which of the picture's colours the palette cannot mix (§6.3). */
  gamut: boolean;
}

/** The picture through a crop and the painted importance map, with nothing else done to them: what the
 * automatic adjustment tries its settings on, and what a piece is compared with (DECISIONS D-54, D-55). */
export interface CropRequest {
  res: number;
  frame: FrameSpec;
  crop: Crop;
  board: RGB;
  preset: ImportancePreset;
  strokes: Stroke[];
}

export type ToPre =
  | { t: "picture"; id: number; width: number; height: number; rgba: Uint8ClampedArray }
  | { t: "sample"; id: number; sample: SampleId }
  /** `ticket` lets the page drop answers to requests it has since replaced. */
  | { t: "target"; id: number; ticket: number; request: TargetRequest }
  | { t: "crop"; id: number; ticket: number; request: CropRequest };

export type FromPre =
  | { t: "ready"; id: number; width: number; height: number }
  | {
      t: "target"; id: number; ticket: number; res: number; target: Float64Array; weight: Float64Array; rgba: Uint8ClampedArray; weightRgba: Uint8ClampedArray;
      /** The gamut check and its picture (the out-of-reach parts hatched), when it was asked for. */
      gamut: GamutSummary | null; gamutRgba: Uint8ClampedArray | null;
      /** blankShare() of the picture before any adjustment: how much of it is like the bare board. */
      blank: number;
    }
  /** 3 x res x res linear RGB, and one weight per pixel (0 outside the pin circle). */
  | { t: "cropped"; id: number; ticket: number; res: number; picture: Float64Array; painted: Float64Array }
  | { t: "error"; id: number; code: string; detail?: string };

// ---------- render.worker: the picture at true thread width (§7.1)

export type ToRender =
  /** `sigmaMm` > 0 blurs for the viewing distance; `region` is in working-grid coordinates (the magnifier). */
  | { t: "render"; id: number; ticket: number; options: FrameOptions; sequences: number[][]; width: number; height: number; region: Region | null; sigmaMm: number }
  /** The error reduction and Delta-E measured on the true-width render at the working resolution; with
   * `original` (the cropped picture before any adjustment, the painted importance map, and what the reference
   * picture is made with) also how close the render is to that picture. */
  | {
      t: "measure"; id: number; ticket: number; options: FrameOptions; sequences: number[][]; target: Float64Array; weight: Float64Array;
      original: { picture: Float64Array; painted: Float64Array; mode: Mode; invert: boolean } | null;
    };

export type FromRender =
  | { t: "image"; id: number; ticket: number; width: number; height: number; rgba: Uint8ClampedArray }
  | { t: "measured"; id: number; ticket: number; errorReduction: number; deltaE: number; similarity: number | null }
  | { t: "error"; id: number; ticket: number; code: string; detail?: string };

/** The buffers of a message, for postMessage's transfer list. */
export function transferables(msg: FromGen | FromPre | FromRender | ToGen | ToPre | ToRender): Transferable[] {
  const out: Transferable[] = [];
  for (const value of Object.values(msg)) if (ArrayBuffer.isView(value)) out.push(value.buffer as ArrayBuffer);
  return out;
}
