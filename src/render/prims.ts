// Drawing primitives shared by the three back ends (canvas on screen, SVG and PDF downloads), so the nail
// template is computed once. Coordinates are drawing units (millimetres for exports), with y pointing DOWN
// like SVG, canvas and the working grid of the core (spec §3). Ported from img2fold, plus a circle.
// No DOM here: the export worker builds PDFs from the same primitives.

export type Vec = [number, number];

export type PathCmd = { c: "M"; p: Vec } | { c: "L"; p: Vec } | { c: "C"; p1: Vec; p2: Vec; p: Vec } | { c: "Z" };

export type Prim =
  | { t: "poly"; pts: Vec[]; fill?: string; stroke?: string; width?: number }
  | { t: "line"; a: Vec; b: Vec; stroke: string; width: number; dash?: number[] }
  | { t: "circle"; c: Vec; r: number; fill?: string; stroke?: string; width?: number }
  | { t: "path"; d: PathCmd[]; fill?: string; stroke?: string; width?: number; dash?: number[] }
  | { t: "text"; at: Vec; text: string; size: number; color: string; align?: "left" | "center" | "right"; bold?: boolean };

export interface Drawing {
  width: number;
  height: number;
  prims: Prim[];
}

/** Stroke width of an outline that does not give one (drawing units). */
export const DEFAULT_STROKE = 0.3;

/** Moves every primitive by (dx, dy). */
export function translate(prims: readonly Prim[], dx: number, dy: number): Prim[] {
  const mv = (p: Vec): Vec => [p[0] + dx, p[1] + dy];
  return prims.map((p): Prim => {
    switch (p.t) {
      case "poly": return { ...p, pts: p.pts.map(mv) };
      case "line": return { ...p, a: mv(p.a), b: mv(p.b) };
      case "circle": return { ...p, c: mv(p.c) };
      case "text": return { ...p, at: mv(p.at) };
      case "path":
        return { ...p, d: p.d.map((c): PathCmd => (c.c === "Z" ? c : c.c === "C" ? { c: "C", p1: mv(c.p1), p2: mv(c.p2), p: mv(c.p) } : { c: c.c, p: mv(c.p) })) };
    }
  });
}

/** A box [x0, y0, x1, y1] that certainly contains the primitive, strokes included. Text is measured without
 * a font: no glyph is wider than its size, so one size per character is always enough. Used to leave out
 * what a page of a tiled print cannot show. */
export function primBox(p: Prim): [number, number, number, number] {
  const around = (pts: readonly Vec[], pad: number): [number, number, number, number] => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  };
  switch (p.t) {
    case "poly": return around(p.pts, p.stroke ? (p.width ?? DEFAULT_STROKE) : 0);
    case "line": return around([p.a, p.b], p.width);
    case "circle": return around([p.c], p.r + (p.stroke ? (p.width ?? DEFAULT_STROKE) : 0));
    // a Bezier curve stays inside the hull of its control points
    case "path": return around(p.d.flatMap((c): Vec[] => (c.c === "Z" ? [] : c.c === "C" ? [c.p1, c.p2, c.p] : [c.p])), p.stroke ? (p.width ?? DEFAULT_STROKE) : 0);
    case "text": {
      const w = [...p.text].length * p.size;
      const x = p.align === "center" ? p.at[0] - w / 2 : p.align === "right" ? p.at[0] - w : p.at[0];
      return [x, p.at[1] - p.size, x + w, p.at[1] + 0.4 * p.size];
    }
  }
}

/** Hex colour "#rrggbb" -> [r, g, b] in [0, 1]. */
export function rgb01(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Relative luminance of a hex colour (for picking a readable stroke on it). */
export function luminanceOf(hex: string): number {
  const [r, g, b] = rgb01(hex).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
