// SVG downloads (spec §7.2, §7.6), in millimetre units so they print, cut or drill at their real size:
// the nail template, with the pins as <circle> elements in a group of their own, and the finished piece as
// vectors, every line a stroke of the thread's width. The primitive writer is ported from img2fold.
import { isRound, pinOf } from "../core/frame.ts";
import { NO_RESULT, threadLabel, threadPlans } from "../core/instructions.ts";
import type { Project } from "../core/project.ts";
import { DEFAULT_STROKE, type PathCmd, type Prim } from "../render/prims.ts";
import { boardSize, templateLayers, templatePins } from "../render/template.ts";

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
/** Text for an element or attribute. Control characters, which XML 1.0 cannot carry, are dropped (a thread's
 * name is the user's text). */
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = "'Noto Sans TC', 'Microsoft JhengHei', 'PingFang TC', system-ui, sans-serif";

function pathData(d: readonly PathCmd[]): string {
  return d
    .map((c) => (c.c === "Z" ? "Z" : c.c === "C" ? `C${n(c.p1[0])} ${n(c.p1[1])} ${n(c.p2[0])} ${n(c.p2[1])} ${n(c.p[0])} ${n(c.p[1])}` : `${c.c}${n(c.p[0])} ${n(c.p[1])}`))
    .join(" ");
}

export function primSvg(p: Prim): string {
  const strokeAttrs = (stroke?: string, width?: number, dash?: number[]) =>
    stroke ? ` stroke="${esc(stroke)}" stroke-width="${n(width ?? DEFAULT_STROKE)}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash.map(n).join(" ")}"` : ""}` : "";
  const fill = (color?: string) => `fill="${color ? esc(color) : "none"}"`;
  switch (p.t) {
    case "poly":
      return `<polygon points="${p.pts.map((q) => `${n(q[0])},${n(q[1])}`).join(" ")}" ${fill(p.fill)}${strokeAttrs(p.stroke, p.width)}/>`;
    case "line":
      return `<line x1="${n(p.a[0])}" y1="${n(p.a[1])}" x2="${n(p.b[0])}" y2="${n(p.b[1])}"${strokeAttrs(p.stroke, p.width, p.dash)}/>`;
    case "circle":
      return `<circle cx="${n(p.c[0])}" cy="${n(p.c[1])}" r="${n(p.r)}" ${fill(p.fill)}${strokeAttrs(p.stroke, p.width)}/>`;
    case "path":
      return `<path d="${pathData(p.d)}" ${fill(p.fill)}${strokeAttrs(p.stroke, p.width, p.dash)}/>`;
    case "text": {
      const anchor = p.align === "center" ? "middle" : p.align === "right" ? "end" : "start";
      return `<text x="${n(p.at[0])}" y="${n(p.at[1])}" font-size="${n(p.size)}" fill="${esc(p.color)}" text-anchor="${anchor}"${p.bold ? ' font-weight="700"' : ""}>${esc(p.text)}</text>`;
    }
  }
}

/** Primitives as one <g> with an id. */
export function svgGroup(id: string, prims: readonly Prim[]): string {
  return [`<g id="${esc(id)}">`, ...prims.map(primSvg), `</g>`].join("\n");
}

/** A standalone SVG document in millimetres around ready-made elements. Without `background` the page stays
 * transparent: a cutting program would take a background rectangle for something to cut. */
export function svgDocument(width: number, height: number, body: readonly string[], o: { title?: string; background?: string } = {}): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}mm" height="${n(height)}mm" viewBox="0 0 ${n(width)} ${n(height)}" font-family="${FONT}">`,
    o.title ? `<title>${esc(o.title)}</title>` : "",
    o.background ? `<rect width="${n(width)}" height="${n(height)}" fill="${esc(o.background)}"/>` : "",
    ...body,
    `</svg>`,
  ]
    .filter((line) => line !== "")
    .join("\n") + "\n";
}

/** The nail template: the drawing of render/template.ts in the groups "board", "frame", "marks" and "pins".
 * The group "pins" holds one <circle> per pin, in pin order, and nothing else. */
export function templateSvg(frame: Project["frame"], title?: string, inside?: ArrayLike<number>): string {
  const L = templateLayers(frame, inside), { width, height } = boardSize(frame);
  return svgDocument(width, height, [svgGroup("board", L.board), svgGroup("frame", L.frame), svgGroup("marks", L.marks), svgGroup("pins", L.pins)], { title });
}

/** The piece as vectors (§7.6): the board in its colour, then one <g> per thread in winding order (so later
 * threads paint over earlier ones, as on the frame), every line a <line> as wide as the thread with butt
 * ends. Same coordinates as the template. Throws Error("no-result") when the project has no result. */
export function linesSvg(p: Project, title?: string): string {
  if (!p.result) throw new Error(NO_RESULT);
  const { width, height } = boardSize(p.frame), inside = p.result.inside, pinned = !!inside?.length;
  const P = templatePins(p.frame, inside).map(([x, y]) => [n(x), n(y)] as const);
  const groups = threadPlans(p).map((plan) => {
    const out = [`<g id="thread-${plan.index + 1}" fill="none" stroke="${esc(plan.hex)}" stroke-width="${n(p.thread.widthMm)}" stroke-linecap="butt">`, `<title>${esc(threadLabel(plan.name, plan.hex))}</title>`];
    for (let i = 1; i < plan.sequence.length; i++) {
      // on a piece with pins inside the picture, a step round the frame is no line (D-60)
      if (pinned && isRound(plan.sequence[i]!)) continue;
      const a = P[pinned ? pinOf(plan.sequence[i - 1]!) : plan.sequence[i - 1]!]!, b = P[plan.sequence[i]!]!;
      out.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`);
    }
    out.push(`</g>`);
    return out.join("\n");
  });
  return svgDocument(width, height, groups, { title, background: p.board });
}
