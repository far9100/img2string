// The centre of the page: the canvas where the picture emerges from lines (spec §9). Two tabs: the target (the
// picture as the generator will see it; the crop is moved and the importance brush painted here) and the
// result (the model's picture, or the render at true thread width with the viewing-distance blur, the
// comparison with the target and the magnifier of §7.1).
import type { Controller } from "../app/controller.ts";
import type { AppState, Compare } from "../app/state.ts";
import { cropSpan, frameBounds, framePins } from "../core/frame.ts";
import { frameSpec, IDENTITY_CROP, type Crop } from "../core/project.ts";
import { gridToPicture } from "../core/strokes.ts";
import { viewingSigmaMm } from "../core/truewidth.ts";
import { t } from "../i18n/i18n.ts";
import { fitCanvas, onResize, rgbaCanvas, themeColour } from "./canvasUtil.ts";
import { button, checkField, h, rangeField, selectField, tx } from "./dom.ts";
import type { Sync } from "./inputPanels.ts";

const LENS = 220; // CSS px
const LENS_MM = 28; // millimetres of the piece the magnifier shows across

export function mountStage(root: HTMLElement, ctl: Controller, syncs: Sync[]): void {
  const tabs = h("div", { class: "segmented tabs", role: "tablist" },
    h("button", { type: "button", role: "tab", "data-i18n": "tab.target", text: t("tab.target"), onclick: () => ctl.setView({ tab: "target" }) }),
    h("button", { type: "button", role: "tab", "data-i18n": "tab.result", text: t("tab.result"), onclick: () => ctl.setView({ tab: "result" }) }),
  );
  const realistic = checkField({ label: "view.realistic", onChange: (v) => ctl.setView({ realistic: v }) });
  const distance = rangeField({
    label: "view.distance", min: 0, max: 5, step: 0.5, format: (v) => (v === 0 ? t("view.distanceOff") : `${v.toFixed(1)} m`),
    onInput: (v) => ctl.setView({ distanceM: v }), onCommit: (v) => ctl.setView({ distanceM: v }),
  });
  const compare = selectField({ label: "view.compare", options: ["none", "side", "wipe"].map((v) => ({ value: v, label: `compare.${v}` })), onChange: (v) => ctl.setView({ compare: v as Compare }) });
  const magnifier = checkField({ label: "view.magnifier", onChange: (v) => ctl.setView({ magnifier: v }) });
  const tools = h("div", { class: "view-tools" }, realistic.el, distance.el, compare.el, magnifier.el);
  const stale = h("div", { class: "banner" }, tx("result.stale"), button("result.restore", () => ctl.restoreMade()));
  const canvas = h("canvas", { class: "stage-canvas", tabindex: "0", "data-i18n-aria-label": "stage.label" });
  const lens = h("canvas", { class: "lens", hidden: true, width: LENS, height: LENS });
  const empty = h("p", { class: "empty" });
  const stage = h("div", { class: "stage" }, canvas, lens, empty);
  const caption = h("p", { class: "legend" });
  const metrics = h("dl", { class: "metrics" });
  root.append(tabs, tools, stale, stage, caption, metrics);

  let cssW = 600, wipe = 0.5, dirty = false;
  /** The latest true-width render and what it shows. */
  let truth: { key: string; width: number; height: number; rgba: Uint8ClampedArray } | null = null;
  let truthAsked = "";
  /** The brush stroke being drawn, in canvas CSS pixels. */
  let live: number[] | null = null;

  const invalidate = () => {
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(() => { dirty = false; draw(); });
  };
  onResize(stage, (w) => { cssW = w; invalidate(); });

  const side = (s: AppState) => s.view.tab === "result" && s.view.compare === "side" && !!s.target;
  /** The target is shown with its out-of-reach colours hatched. */
  const hatched = (s: AppState) => s.view.gamut && s.project.mode === "colour" && !s.view.brush.on && (s.target?.gamut?.outShare ?? 0) > 0;
  /** The square the piece occupies on the canvas, in CSS px: [x, y, size]. */
  const frameBox = (s: AppState): [number, number, number] => {
    const max = Math.min(cssW, Math.max(260, window.innerHeight - 300));
    if (side(s)) { const size = Math.min(max, cssW / 2 - 4); return [cssW - size, 0, size]; }
    return [(cssW - max) / 2, 0, max];
  };
  /** The picture and how the frame sees it: `span` is cropTransform's, the picture's short side for a round frame. */
  const sourceShape = (s: AppState): { crop: Crop; width: number; height: number; span: number } => {
    const res = s.project.generator.res, src = s.source;
    const shape = src && !src.sample ? { crop: s.project.image.crop, width: src.width, height: src.height } : { crop: IDENTITY_CROP, width: res, height: res };
    return { ...shape, span: cropSpan(frameSpec(s.project.frame), shape.crop.rotateDeg, shape.width, shape.height, res) };
  };

  function drawImage(ctx: CanvasRenderingContext2D, slot: string, rgba: Uint8ClampedArray, w: number, h: number, x: number, y: number, size: number, dpr: number): void {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(rgbaCanvas(slot, rgba, w, h), x * dpr, y * dpr, size * dpr, size * dpr);
  }

  /** Clears what lies beside a rectangular frame in the square a picture was drawn in: the working grid is
   * square and the frame is not, and what the grid holds beside it (the picture carried on for the sake of
   * the sharpening, or bare board) is not part of the piece. A round frame keeps its corners, as it always did. */
  function trim(ctx: CanvasRenderingContext2D, frame: AppState["project"]["frame"], res: number, x: number, y: number, size: number, dpr: number): void {
    if (frame.shape !== "rect" || res < 2) return;
    const b = frameBounds({ res, ...frameSpec(frame) }), k = (size * dpr) / res, left = x * dpr, top = y * dpr, side = size * dpr;
    const x0 = left + b.x0 * k, x1 = left + (b.x1 + 1) * k, y0 = top + b.y0 * k, y1 = top + (b.y1 + 1) * k;
    ctx.clearRect(left, top, x0 - left, side);
    ctx.clearRect(x1, top, left + side - x1, side);
    ctx.clearRect(left, top, side, y0 - top);
    ctx.clearRect(left, y1, side, top + side - y1);
  }

  /** The frame over a picture: its outline (the pin circle, or the rectangle) and a tick per pin, pointing
   * away from the picture. The pins are frame.ts's, as the generator has them: a working pixel (gx, gy) is
   * drawn at ((gx + 0.5) / res, (gy + 0.5) / res) of the square the piece takes on the canvas. */
  function ring(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, dpr: number, pins: number): void {
    const frame = ctl.state.project.frame, res = Math.max(2, ctl.state.project.generator.res), layout = { pins, res, ...frameSpec(frame) };
    const k = (size * dpr) / res, at = (g: number, origin: number) => origin * dpr + (g + 0.5) * k;
    const P = framePins(layout), b = frameBounds(layout), cx = at((res - 1) / 2, x), cy = at((res - 1) / 2, y), rect = frame.shape === "rect";
    ctx.save();
    ctx.strokeStyle = themeColour("--ring");
    ctx.lineWidth = dpr;
    ctx.beginPath();
    if (rect) ctx.rect(at(b.x0, x), at(b.y0, y), (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
    else ctx.arc(cx, cy, ((res - 1) / 2) * k, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    const step = pins > 256 ? 2 : 1;
    for (let i = 0; i < pins; i += step) {
      const px = at(P[2 * i]!, x), py = at(P[2 * i + 1]!, y), long = (i % 10 === 0 ? 7 : 3.5) * dpr;
      // outwards: along the radius of a circle, at right angles to the side of a rectangle
      let ox = px - cx, oy = py - cy;
      if (rect) {
        const gx = P[2 * i]!, gy = P[2 * i + 1]!, near = Math.min(gy - b.y0, b.x1 - gx, b.y1 - gy, gx - b.x0);
        [ox, oy] = near === gy - b.y0 ? [0, -1] : near === b.x1 - gx ? [1, 0] : near === b.y1 - gy ? [0, 1] : [-1, 0];
      }
      const length = Math.hypot(ox, oy) || 1;
      ctx.moveTo(px, py);
      ctx.lineTo(px + (long * ox) / length, py + (long * oy) / length);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** The pins inside the picture, as dots over it: where they would stand for this target, or do stand on the
   * piece already made from it (D-60; the controller's pinsFor says which). Fractions of the frame's span. */
  function dots(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, dpr: number, pins: readonly number[]): void {
    if (!pins.length) return;
    const res = Math.max(2, ctl.state.project.generator.res), k = (size * dpr) / res;
    ctx.save();
    ctx.fillStyle = themeColour("--ring");
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = dpr;
    for (let j = 0; j < pins.length; j += 2) {
      ctx.beginPath();
      ctx.arc(x * dpr + (pins[j]! * (res - 1) + 0.5) * k, y * dpr + (pins[j + 1]! * (res - 1) + 0.5) * k, 2.2 * dpr, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function requestTruth(s: AppState, px: number): void {
    const made = s.made;
    if (!made?.result) return;
    const sigma = s.view.distanceM > 0 ? viewingSigmaMm(s.view.distanceM) : 0;
    const key = `${made.result.key}|${made.result.lines.join(",")}|${px}|${sigma}`;
    if (truth?.key === key || truthAsked === key) return;
    truthAsked = key;
    void ctl.renderTrue("view", px, px, null, sigma).then((img) => {
      if (!img || truthAsked !== key) return;
      truth = { key, ...img };
      invalidate();
    });
  }

  function draw(): void {
    const s = ctl.state, [fx, fy, size] = frameBox(s);
    const height = size + 14;
    canvas.style.setProperty("height", `${height}px`);
    const dpr = fitCanvas(canvas, cssW, height), ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const running = s.run.status !== "idle";
    let message = "";
    if (s.view.tab === "target") {
      if (s.target) {
        drawImage(ctx, "target", s.target.rgba, s.target.res, s.target.res, fx, fy, size, dpr);
        // §6.3: the parts whose colour these threads cannot mix, hatched (not while painting importance)
        if (s.view.gamut && s.target.gamutRgba && s.project.mode === "colour" && !s.view.brush.on) drawImage(ctx, "gamut", s.target.gamutRgba, s.target.res, s.target.res, fx, fy, size, dpr);
        drawImage(ctx, "weights", s.target.weightRgba, s.target.res, s.target.res, fx, fy, size, dpr);
        trim(ctx, s.project.frame, s.target.res, fx, fy, size, dpr);
        ring(ctx, fx, fy, size, dpr, s.project.frame.pins);
        dots(ctx, fx, fy, size, dpr, ctl.pinsFor(s.project, true));
      } else message = s.pictureMissing ? t("picture.reopen") : t("run.preparing");
      if (live && live.length >= 2) {
        ctx.save();
        ctx.strokeStyle = s.view.brush.weight >= 1 ? "rgba(230,120,20,0.55)" : "rgba(40,90,200,0.55)";
        ctx.lineWidth = 2 * s.view.brush.radius * size * dpr;
        ctx.lineCap = ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(live[0]! * dpr, live[1]! * dpr);
        for (let i = 2; i < live.length; i += 2) ctx.lineTo(live[i]! * dpr, live[i + 1]! * dpr);
        if (live.length === 2) ctx.lineTo(live[0]! * dpr + 0.01, live[1]! * dpr);
        ctx.stroke();
        ctx.restore();
      }
    } else {
      const res = running ? s.run.res : (s.result?.res ?? 0);
      const fast = running ? s.run.rgba : (s.result?.rgba ?? null);
      const px = Math.round(size * dpr);
      const useTruth = !running && s.view.realistic && !!s.made?.result;
      if (useTruth) requestTruth(s, px);
      const shown = useTruth && truth && truth.key.startsWith(`${s.made!.result!.key}|${s.made!.result!.lines.join(",")}|`) ? truth : null;
      if (shown) drawImage(ctx, "truth", shown.rgba, shown.width, shown.height, fx, fy, size, dpr);
      else if (fast && res) drawImage(ctx, "result", fast, res, res, fx, fy, size, dpr);
      else message = running ? t("run.starting") : t("result.none");
      if (s.target && (fast || shown)) {
        if (s.view.compare === "side") {
          drawImage(ctx, "target", s.target.rgba, s.target.res, s.target.res, 0, 0, size, dpr);
        } else if (s.view.compare === "wipe") {
          // the target on the left of the divider, the result on the right
          ctx.save();
          ctx.beginPath();
          ctx.rect(fx * dpr, fy * dpr, wipe * size * dpr, size * dpr);
          ctx.clip();
          drawImage(ctx, "target", s.target.rgba, s.target.res, s.target.res, fx, fy, size, dpr);
          ctx.restore();
          ctx.fillStyle = themeColour("--text");
          ctx.fillRect((fx + wipe * size) * dpr - dpr, fy * dpr, 2 * dpr, size * dpr);
        }
      }
      // the piece shown is the made one, on the frame it was made for (the current one while it is being made)
      if (fast || shown) {
        const frame = running ? s.project.frame : (s.made?.frame ?? s.project.frame);
        trim(ctx, frame, shown ? shown.width : res, fx, fy, size, dpr);
        if (s.target && s.view.compare === "side") trim(ctx, s.project.frame, s.target.res, 0, 0, size, dpr);
      }
    }
    empty.textContent = message;
    empty.hidden = !message;
  }

  // ---------- pointer: crop (drag, wheel, pinch), brush, wipe divider, magnifier

  const pointers = new Map<number, [number, number]>();
  let pinch = 0, last: [number, number] | null = null, dragging: "pan" | "brush" | "wipe" | null = null;
  const local = (e: PointerEvent | WheelEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  /** Canvas position -> working-grid coordinates of the current frame square. */
  const toGrid = (s: AppState, x: number, y: number): [number, number] => {
    const [fx, fy, size] = frameBox(s), res = s.project.generator.res;
    return [((x - fx) / size) * res - 0.5, ((y - fy) / size) * res - 0.5];
  };
  const canCrop = (s: AppState) => s.view.tab === "target" && !!s.source && !s.source.sample && !s.view.brush.on;

  /** Moves the crop so that the picture point under grid position (gx, gy) stays there while the scale changes. */
  function zoomAbout(s: AppState, gx: number, gy: number, factor: number): void {
    const { crop, width, height, span } = sourceShape(s), res = s.project.generator.res;
    const scale = Math.min(20, Math.max(0.2, crop.scale * factor));
    const [px, py] = gridToPicture(crop, width, height, res, gx, gy, span);
    const [qx, qy] = gridToPicture({ ...crop, scale }, width, height, res, gx, gy, span);
    ctl.setCrop({ scale, cx: Math.min(1, Math.max(0, crop.cx + px - qx)), cy: Math.min(1, Math.max(0, crop.cy + py - qy)) });
  }

  canvas.addEventListener("pointerdown", (e) => {
    const s = ctl.state, [x, y] = local(e);
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [x, y]);
    last = [x, y];
    if (s.view.tab === "target" && s.view.brush.on && s.target) { dragging = "brush"; live = [x, y]; invalidate(); }
    else if (canCrop(s)) dragging = "pan";
    else if (s.view.tab === "result" && s.view.compare === "wipe") { dragging = "wipe"; moveWipe(s, x); }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = Math.hypot(a![0] - b![0], a![1] - b![1]);
    }
  });
  const moveWipe = (s: AppState, x: number) => {
    const [fx, , size] = frameBox(s);
    wipe = Math.min(1, Math.max(0, (x - fx) / size));
    invalidate();
  };
  canvas.addEventListener("pointermove", (e) => {
    const s = ctl.state, [x, y] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [x, y]);
    if (pointers.size === 2 && canCrop(s)) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a![0] - b![0], a![1] - b![1]);
      if (pinch > 0 && d > 0) zoomAbout(s, ...toGrid(s, (a![0] + b![0]) / 2, (a![1] + b![1]) / 2), d / pinch);
      pinch = d;
      return;
    }
    if (dragging === "brush" && live) {
      if (Math.hypot(x - live[live.length - 2]!, y - live[live.length - 1]!) >= 2) { live.push(x, y); invalidate(); }
    } else if (dragging === "pan" && last) {
      const { crop, width, height, span } = sourceShape(s), res = s.project.generator.res;
      const [ax, ay] = gridToPicture(crop, width, height, res, ...toGrid(s, last[0], last[1]), span);
      const [bx, by] = gridToPicture(crop, width, height, res, ...toGrid(s, x, y), span);
      ctl.setCrop({ cx: Math.min(1, Math.max(0, crop.cx + ax - bx)), cy: Math.min(1, Math.max(0, crop.cy + ay - by)) });
      last = [x, y];
    } else if (dragging === "wipe") moveWipe(s, x);
    if (s.view.tab === "result" && s.view.magnifier && !dragging) showLens(s, x, y);
  });
  const release = (e: PointerEvent) => {
    const s = ctl.state;
    pointers.delete(e.pointerId);
    pinch = 0;
    if (dragging === "brush" && live) {
      const { crop, width, height, span } = sourceShape(s), res = s.project.generator.res, pts: number[] = [];
      for (let i = 0; i < live.length; i += 2) {
        const [px, py] = gridToPicture(crop, width, height, res, ...toGrid(s, live[i]!, live[i + 1]!), span);
        pts.push(px, py);
      }
      // the brush size is a share of the frame on screen; a stroke stores it as a share of the picture's short
      // side, which is what a round frame spans at scale 1 (a rectangular one spans `span`)
      ctl.addStroke({ w: s.view.brush.weight, r: (s.view.brush.radius / crop.scale) * (span / Math.min(width, height)), pts });
      live = null;
      invalidate();
    }
    dragging = null;
    last = null;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => { lens.hidden = true; });
  canvas.addEventListener("wheel", (e) => {
    const s = ctl.state;
    if (!canCrop(s)) return;
    e.preventDefault();
    zoomAbout(s, ...toGrid(s, ...local(e)), Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  canvas.addEventListener("keydown", (e) => {
    const s = ctl.state;
    if (!canCrop(s)) return;
    const step = 0.02 / s.project.image.crop.scale, crop = s.project.image.crop;
    const move: Record<string, Partial<Crop>> = {
      ArrowLeft: { cx: Math.max(0, crop.cx - step) }, ArrowRight: { cx: Math.min(1, crop.cx + step) },
      ArrowUp: { cy: Math.max(0, crop.cy - step) }, ArrowDown: { cy: Math.min(1, crop.cy + step) },
      "+": { scale: Math.min(20, crop.scale * 1.1) }, "=": { scale: Math.min(20, crop.scale * 1.1) }, "-": { scale: Math.max(0.2, crop.scale / 1.1) },
    };
    const patch = move[e.key];
    if (patch) { e.preventDefault(); ctl.setCrop(patch); }
  });

  let lensAsked = 0;
  function showLens(s: AppState, x: number, y: number): void {
    const made = s.made;
    const [fx, fy, size] = frameBox(s);
    if (!made?.result || x < fx || x > fx + size || y < fy || y > fy + size) { lens.hidden = true; return; }
    const res = made.generator.res, pixelMm = made.frame.diameterMm / (res - 1), half = LENS_MM / pixelMm / 2;
    const gx = ((x - fx) / size) * res - 0.5, gy = ((y - fy) / size) * res - 0.5;
    const dpr = Math.min(2, window.devicePixelRatio || 1), px = Math.round(LENS * dpr), ask = ++lensAsked;
    lens.style.setProperty("left", `${Math.min(cssW - LENS - 4, Math.max(4, x + 18))}px`);
    lens.style.setProperty("top", `${Math.max(4, y - LENS - 18)}px`);
    void ctl.renderTrue("lens", px, px, { x0: gx - half, y0: gy - half, x1: gx + half, y1: gy + half }, 0).then((img) => {
      if (!img || ask !== lensAsked || !ctl.state.view.magnifier) return;
      if (lens.width !== px) lens.width = lens.height = px;
      lens.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
      lens.hidden = false;
    });
  }

  // ---------- state -> controls

  const card = (label: string, value: string, wide = false) => h("div", { class: wide ? "card wide" : "card" }, h("dt", { text: label }), h("dd", { text: value }));
  syncs.push((s) => {
    const result = s.view.tab === "result", running = s.run.status !== "idle";
    tabs.children[0]!.setAttribute("aria-selected", String(!result));
    tabs.children[1]!.setAttribute("aria-selected", String(result));
    tools.hidden = !result;
    realistic.set(s.view.realistic);
    realistic.input.disabled = running || !s.made;
    distance.set(s.view.distanceM);
    distance.el.hidden = !s.view.realistic;
    compare.set(s.view.compare);
    compare.select.disabled = !s.target;
    magnifier.set(s.view.magnifier);
    if (!s.view.magnifier || !result) lens.hidden = true;
    stale.hidden = !(result && !running && s.made && !s.project.result);
    canvas.classList.toggle("brush", s.view.tab === "target" && s.view.brush.on);
    canvas.classList.toggle("pan", canCrop(s));
    caption.textContent = !result
      ? (s.view.brush.on ? t("stage.brushHint") : hatched(s) ? t("stage.gamutHint") : s.source && !s.source.sample ? t("stage.cropHint") : t("stage.targetHint"))
      : s.view.compare === "side" ? t("stage.sideHint") : s.view.compare === "wipe" ? t("stage.wipeHint") : s.view.realistic ? t("stage.realisticHint") : t("stage.modelHint");

    const cards: HTMLElement[] = [];
    if (result && (running || s.made?.result)) {
      const lines = running ? s.run.lines : s.made!.result!.lines, threads = running ? s.project.threads : s.made!.threads;
      const dots = h("dd", { class: "line-counts" }, ...lines.map((n, k) => {
        const dot = h("span", { class: "dot" });
        dot.style.setProperty("background", threads[k]?.hex ?? "#888");
        return h("span", null, dot, String(n));
      }));
      cards.push(h("div", { class: "card wide" }, h("dt", { text: t("metric.lines") }), dots));
      const reduction = running ? (s.run.initialError ? 1 - s.run.error / s.run.initialError : 0) : s.made!.result!.errorReduction;
      cards.push(card(t("metric.reduction"), `${(100 * reduction).toFixed(1)}%`));
      if (!running && s.result) {
        if (s.result.deltaE) cards.push(card(t("metric.deltaE"), `${s.result.deltaE[0].toFixed(1)} → ${s.result.deltaE[1].toFixed(1)}`));
        if (s.result.trueReduction !== null) cards.push(card(t("metric.trueReduction"), `${(100 * s.result.trueReduction).toFixed(1)}%`));
        if (s.result.similarity !== null) cards.push(card(t("metric.similarity"), `${Math.round(100 * Math.min(1, Math.max(0, s.result.similarity)))}%`));
        if (s.result.ms > 0) cards.push(card(t("metric.time"), `${(s.result.ms / 1000).toFixed(1)} s`));
      }
    }
    metrics.replaceChildren(...cards);
    metrics.hidden = !cards.length;
    invalidate();
  });
}
