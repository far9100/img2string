// Every download by kind (spec §7.6), except the project file and the preview picture: what the export worker
// builds. Pure functions of the project, so the tests build the same files in Node.
// The two PDF writers are imported only when a PDF is asked for: pdf-lib and fontkit stay out of whatever
// loads this module for an SVG or a CSV.
import { instructionsCsv, instructionsTxt, NO_RESULT } from "../core/instructions.ts";
import type { Project } from "../core/project.ts";
import { t, type Lang } from "../i18n/translate.ts";
import { templateDxf } from "./dxf.ts";
import { FILE } from "./names.ts";
import { linesSvg, templateSvg } from "./svg.ts";

export type ExportKind = "template-pdf" | "template-svg" | "template-dxf" | "instructions-pdf" | "instructions-csv" | "instructions-txt" | "lines-svg";

export const EXPORT_KINDS: readonly ExportKind[] = ["template-pdf", "template-svg", "template-dxf", "instructions-pdf", "instructions-csv", "instructions-txt", "lines-svg"];

/** The kinds that cannot be built without the PDF font. */
export const needsFont = (kind: ExportKind): boolean => kind === "template-pdf" || kind === "instructions-pdf";
/** The kinds that need a generated result; the others only need the frame. */
export const needsResult = (kind: ExportKind): boolean => kind.startsWith("instructions-") || kind === "lines-svg";

export interface ExportInput {
  project: Project;
  lang: Lang;
  /** File-name stem from names.ts stemOf. */
  stem: string;
}

export interface BuiltFile {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);
/** Text people open by double-clicking: the byte-order mark makes spreadsheets and older editors read it as
 * UTF-8, so Chinese text and thread names survive. */
const utf8Marked = (s: string): Uint8Array => utf8(String.fromCharCode(0xfeff) + s);

/**
 * `font` is needed for the two PDF kinds only (Error "no-font" without it). The instruction kinds and the
 * lines SVG throw Error("no-result") when the project has no result; the template kinds never need one.
 */
export async function buildFile(font: Uint8Array | null, input: ExportInput, kind: ExportKind): Promise<BuiltFile> {
  const { project, lang, stem } = input;
  if (needsResult(kind) && !project.result) throw new Error(NO_RESULT);
  if (needsFont(kind) && !font) throw new Error("no-font");
  switch (kind) {
    case "template-pdf": {
      const { templatePdf } = await import("./templatePdf.ts");
      return { name: FILE.template(stem, "pdf"), mime: "application/pdf", bytes: await templatePdf(font!, project, lang) };
    }
    case "template-svg": {
      const title = t("tpl.title", { d: project.frame.diameterMm, pins: project.frame.pins }, undefined, lang);
      return { name: FILE.template(stem, "svg"), mime: "image/svg+xml", bytes: utf8(templateSvg(project.frame, title)) };
    }
    case "template-dxf":
      return { name: FILE.template(stem, "dxf"), mime: "image/vnd.dxf", bytes: utf8(templateDxf(project.frame)) };
    case "instructions-pdf": {
      const { instructionsPdf } = await import("./instructionsPdf.ts");
      return { name: FILE.instructions(stem, "pdf"), mime: "application/pdf", bytes: await instructionsPdf(font!, project, lang, stem) };
    }
    case "instructions-csv":
      return { name: FILE.instructions(stem, "csv"), mime: "text/csv;charset=utf-8", bytes: utf8Marked(instructionsCsv(project)) };
    case "instructions-txt":
      return { name: FILE.instructions(stem, "txt"), mime: "text/plain;charset=utf-8", bytes: utf8Marked(instructionsTxt(project, lang)) };
    case "lines-svg":
      return { name: FILE.lines(stem), mime: "image/svg+xml", bytes: utf8(linesSvg(project, stem)) };
  }
}
