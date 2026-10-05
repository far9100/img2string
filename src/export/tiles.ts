// Printing at 1:1 (spec §7.2): a drawing larger than the page is split into tiles that overlap by 10 mm; it
// takes whichever orientation needs fewer pages. A strip of BAND mm at the bottom of every page, outside the
// drawing, carries the scale bar and the page's labels. Ported from img2fold (originally img2shadow), with
// the paper names taken from the project model.
import type { Paper } from "../core/project.ts";

export const PT_PER_MM = 72 / 25.4;
export const pt = (mm: number): number => mm * PT_PER_MM;
/** Height of the label strip at the bottom of each page (mm). */
export const BAND = 8;

export const PAPER_SIZE: Record<Paper, [number, number]> = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4] };

export interface Tile {
  col: number;
  row: number;
  /** The part of the drawing this page shows (drawing mm, y DOWN, origin at the drawing's top-left). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TilePlan {
  paper: Paper;
  orientation: "portrait" | "landscape";
  /** Page size (mm). */
  pageW: number;
  pageH: number;
  /** Where the content box sits on the page (mm from the page's top-left) and its size. */
  contentX: number;
  contentY: number;
  contentW: number;
  contentH: number;
  cols: number;
  rows: number;
  /** Row by row, so tiles[row * cols + col]. */
  tiles: Tile[];
}

/** Pages needed along one side: 1 if it fits, else ceil((L - overlap) / (P - overlap)). */
export function tileCount(length: number, page: number, overlap: number): number {
  if (length <= page + 1e-9) return 1;
  return Math.ceil((length - overlap) / (page - overlap) - 1e-9);
}

export function planTiles(drawingW: number, drawingH: number, paper: Paper, printerMargin: number, overlap: number): TilePlan {
  const [pw, ph] = PAPER_SIZE[paper];
  const plans = (["portrait", "landscape"] as const).map((orientation) => {
    const pageW = orientation === "portrait" ? pw : ph;
    const pageH = orientation === "portrait" ? ph : pw;
    const contentW = pageW - 2 * printerMargin;
    const contentH = pageH - 2 * printerMargin - BAND;
    const ov = Math.min(overlap, contentW / 2, contentH / 2);
    const cols = tileCount(drawingW, contentW, ov);
    const rows = tileCount(drawingH, contentH, ov);
    const tiles: Tile[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // the last column/row ends exactly at the drawing's edge
        const x = cols === 1 ? 0 : Math.min(col * (contentW - ov), drawingW - contentW);
        const y = rows === 1 ? 0 : Math.min(row * (contentH - ov), drawingH - contentH);
        tiles.push({ col, row, x, y, w: contentW, h: contentH });
      }
    }
    return { paper, orientation, pageW, pageH, contentX: printerMargin, contentY: printerMargin, contentW, contentH, cols, rows, tiles };
  });
  const [portrait, landscape] = plans as [TilePlan, TilePlan];
  return landscape.tiles.length < portrait.tiles.length ? landscape : portrait;
}
