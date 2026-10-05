// Messages between the page and the export worker (spec §7.6). The page sends the project as it is; the worker
// answers every request once, with the file or with why there is none, under the request's id.
import type { ExportInput, ExportKind } from "../export/build.ts";

export type ToExport = { t: "build"; id: number; input: ExportInput; kind: ExportKind };

export type FromExport =
  /** `bytes` is transferred, not copied. */
  | { t: "file"; id: number; name: string; mime: string; bytes: Uint8Array }
  /** `detail` is the Error's message: "no-result", "no-font" (the font file could not be loaded), or what went wrong. */
  | { t: "error"; id: number; detail: string };
