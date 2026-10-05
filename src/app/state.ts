// The page's state. `project` is exactly what the project file holds; everything else lives for the session.
import type { GamutSummary } from "../core/gamut.ts";
import { defaultProject, type Project, type StopReason } from "../core/project.ts";
import type { SampleId } from "../core/targets.ts";
import type { ShelfThread } from "./threadShelf.ts";

export interface SourceInfo {
  name: string;
  width: number;
  height: number;
  sha256: string;
  sample: SampleId | null;
  /** An object URL of the opened file, for the crop view. */
  url: string | null;
}

/** The target picture and the importance map at the working resolution, as the generator will get them. */
export interface TargetView {
  /** targetKey() of the project these were made from. */
  key: string;
  res: number;
  target: Float64Array;
  weight: Float64Array;
  rgba: Uint8ClampedArray;
  weightRgba: Uint8ClampedArray;
  /** Colour mode only (§6.3): which of the picture's colours the palette cannot mix, and those parts hatched. */
  gamut: GamutSummary | null;
  gamutRgba: Uint8ClampedArray | null;
  /** How much of the picture, before any adjustment, is like the bare board (0..1): mostly, for a line drawing. */
  blank: number;
}

export interface RunState {
  status: "idle" | "running" | "stopping";
  lines: number[];
  error: number;
  initialError: number;
  /** The model's picture so far (sRGB RGBA at the working resolution). */
  rgba: Uint8ClampedArray | null;
  res: number;
}

/** What is shown for project.result: the model's picture and the numbers measured with it. */
export interface ResultView {
  res: number;
  rgba: Uint8ClampedArray;
  /** Mean Delta-E_OK x 100: the bare board, then the result (null when the picture is not available). */
  deltaE: [number, number] | null;
  reason: StopReason;
  unstarted: number[];
  budgetBlocked: number[];
  ms: number;
  /** Measured on the true-width render (DECISIONS D-10); null until that has run. */
  trueReduction: number | null;
  trueDeltaE: number | null;
  /** How close the true-width render is to the picture before any adjustment, 0..1 (DECISIONS D-54); null
   * until that has run, or when the picture is not there. */
  similarity: number | null;
}

export interface OrderScore {
  /** Positions in the thread list at the time of the search, bottom to top. */
  order: number[];
  proxy: number;
  full: number | null;
}

export interface OrderSearch {
  status: "idle" | "running";
  done: number;
  total: number;
  scores: OrderScore[] | null;
  /** Colours (hex) the scores refer to, in the order they had when the search ran. */
  hexes: string[];
}

/** The automatic adjustment (DECISIONS D-55): its progress, and what the last one found. */
export interface TuneState {
  status: "idle" | "running";
  done: number;
  total: number;
  /** The last finished search: the similarity before and after, and targetKey() of the project it left
   * behind, so the note goes away as soon as a setting it depends on is changed. */
  last: { key: string; before: number; after: number; changed: boolean } | null;
}

/** "target": the picture as the generator will see it (crop and brush are edited here); "result": the piece. */
export type Tab = "target" | "result";
export type Compare = "none" | "side" | "wipe";

export interface ViewState {
  tab: Tab;
  realistic: boolean;
  /** Viewing distance in metres; 0 shows the render unblurred. */
  distanceM: number;
  compare: Compare;
  magnifier: boolean;
  brush: { on: boolean; weight: number; radius: number };
  /** Hatch the parts of the picture the palette cannot mix (colour mode). */
  gamut: boolean;
  player: boolean;
}

export interface AppState {
  project: Project;
  source: SourceInfo | null;
  /** A project was opened without its picture: the result can be shown and made, but not regenerated. */
  pictureMissing: boolean;
  target: TargetView | null;
  targetBusy: boolean;
  run: RunState;
  /**
   * The project exactly as it was when its result was generated (with that result): what the result views,
   * the instructions and the player work from. `project.result` is this result while the current settings
   * still match it, and null once they differ ("out of date"); the made piece itself is kept, because someone
   * may be hours into winding it (DECISIONS D-31).
   */
  made: Project | null;
  result: ResultView | null;
  order: OrderSearch;
  tune: TuneState;
  view: ViewState;
  /** Codes of things to tell the user about the settings ("issue.<code>"). */
  issues: string[];
  busyExport: boolean;
  /** The user's own thread colours (§6.3), from localStorage. */
  shelf: ShelfThread[];
}

export function initialState(): AppState {
  return {
    project: defaultProject(),
    source: null,
    pictureMissing: false,
    target: null,
    targetBusy: false,
    run: { status: "idle", lines: [], error: 0, initialError: 0, rgba: null, res: 0 },
    made: null,
    result: null,
    order: { status: "idle", done: 0, total: 0, scores: null, hexes: [] },
    tune: { status: "idle", done: 0, total: 0, last: null },
    view: { tab: "target", realistic: false, distanceM: 0, compare: "none", magnifier: false, brush: { on: false, weight: 2, radius: 0.05 }, gamut: true, player: false },
    issues: [],
    busyExport: false,
    shelf: [],
  };
}
