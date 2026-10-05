// Drawing primitives on a 2D canvas: the nail template on screen. Ported from img2fold, plus the circle.
import { DEFAULT_STROKE, type PathCmd, type Prim } from "./prims.ts";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function tracePath(ctx: Ctx, d: readonly PathCmd[]): void {
  ctx.beginPath();
  for (const c of d) {
    if (c.c === "M") ctx.moveTo(c.p[0], c.p[1]);
    else if (c.c === "L") ctx.lineTo(c.p[0], c.p[1]);
    else if (c.c === "C") ctx.bezierCurveTo(c.p1[0], c.p1[1], c.p2[0], c.p2[1], c.p[0], c.p[1]);
    else ctx.closePath();
  }
}

/** Draws `prims` with drawing units scaled by `scale` and shifted by (dx, dy) canvas pixels. */
export function drawPrims(ctx: Ctx, prims: readonly Prim[], scale: number, dx = 0, dy = 0, font = "system-ui, sans-serif"): void {
  ctx.save();
  ctx.translate(dx, dy);
  ctx.scale(scale, scale);
  ctx.lineJoin = "round";
  ctx.lineCap = "butt";
  for (const p of prims) {
    switch (p.t) {
      case "poly": {
        ctx.beginPath();
        p.pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
        ctx.closePath();
        if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(); }
        if (p.stroke) { ctx.setLineDash([]); ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width ?? DEFAULT_STROKE; ctx.stroke(); }
        break;
      }
      case "line":
        ctx.beginPath();
        ctx.moveTo(p.a[0], p.a[1]);
        ctx.lineTo(p.b[0], p.b[1]);
        ctx.setLineDash(p.dash ?? []);
        ctx.strokeStyle = p.stroke;
        ctx.lineWidth = p.width;
        ctx.stroke();
        break;
      case "circle":
        ctx.beginPath();
        ctx.arc(p.c[0], p.c[1], p.r, 0, 2 * Math.PI);
        if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(); }
        if (p.stroke) { ctx.setLineDash([]); ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width ?? DEFAULT_STROKE; ctx.stroke(); }
        break;
      case "path":
        tracePath(ctx, p.d);
        if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(); }
        if (p.stroke) { ctx.setLineDash(p.dash ?? []); ctx.strokeStyle = p.stroke; ctx.lineWidth = p.width ?? DEFAULT_STROKE; ctx.stroke(); }
        break;
      case "text":
        ctx.fillStyle = p.color;
        ctx.font = `${p.bold ? "700 " : ""}${p.size}px ${font}`;
        ctx.textAlign = p.align ?? "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(p.text, p.at[0], p.at[1]);
        break;
    }
  }
  ctx.restore();
}
