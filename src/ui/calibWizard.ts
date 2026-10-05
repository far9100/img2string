// Photo calibration of the thread width (spec §6.6): the user photographs a patch of parallel threads lying on
// the board next to a bare part of it, marks both on the photograph, and says how many threads span how many
// millimetres; core/calibration.ts turns the two brightnesses into the effective width. The photograph is
// decoded on this page and goes nowhere else.
import type { Controller } from "../app/controller.ts";
import { decodePicture, type Decoded } from "../app/imageClient.ts";
import { calibrate, meanLuminance, type Calibration } from "../core/calibration.ts";
import { LIMITS } from "../core/project.ts";
import { t } from "../i18n/i18n.ts";
import { fitCanvas, rgbaCanvas } from "./canvasUtil.ts";
import { button, h, numberField, refreshText, selectField, tx } from "./dom.ts";

export interface CalibWizard {
  open(): void;
}

type Region = "board" | "patch";
/** A rectangle on the photograph, in fractions of its width and height. */
interface Rect { x0: number; y0: number; x1: number; y1: number }

const COLOURS: Record<Region, string> = { board: "#2a6fdb", patch: "#e07a14" };
/** The photograph is shown at most this wide and this high (CSS px), and kept at most this many pixels on its
 * long side: two mean brightnesses do not need more. */
const MAX_W = 620, MAX_H = 380, PHOTO_SIDE = 1600;

export function mountCalibWizard(ctl: Controller): CalibWizard {
  let photo: Decoded | null = null, picture: HTMLCanvasElement | null = null, active: Region = "board", count = 20, spanMm = 20;
  const rects: Record<Region, Rect | null> = { board: null, patch: null };
  let drag: { x: number; y: number } | null = null;

  const picker = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true, id: "calib-input" });
  const pick = button("calib.pick", () => picker.click(), "primary");
  const regionButtons: Record<Region, HTMLButtonElement> = {
    board: h("button", { type: "button", "data-i18n": "calib.board", text: t("calib.board"), onclick: () => setActive("board") }),
    patch: h("button", { type: "button", "data-i18n": "calib.patch", text: t("calib.patch"), onclick: () => setActive("patch") }),
  };
  const regions = h("div", { class: "segmented", role: "group", "data-i18n-aria-label": "calib.region" }, regionButtons.board, regionButtons.patch);
  const canvas = h("canvas", { class: "calib-canvas", "data-i18n-aria-label": "calib.canvas" });
  const empty = tx("calib.noPhoto", "empty");
  const threads = numberField({ label: "calib.threads", min: 2, max: 500, step: 1, onCommit: (v) => { count = Math.max(2, Math.round(v)); update(); } });
  const span = numberField({ label: "calib.span", unit: "mm", min: 1, max: 500, step: 1, onCommit: (v) => { spanMm = Math.max(1, v); update(); } });
  const which = selectField({ label: "calib.thread", options: [], onChange: () => update() });
  const result = h("p", { class: "calib-result", role: "status" });
  const apply = button("calib.apply", () => {
    const c = measured();
    if (!c || c.problem !== "none") return;
    const width = Math.min(LIMITS.widthMm[1], Math.max(LIMITS.widthMm[0], Math.round(100 * c.widthMm) / 100));
    ctl.set(["thread", "widthMm"], width);
    ctl.notify("calib.applied", { w: width });
    dialog.close();
  }, "primary");
  const dialog = h("dialog", { class: "sheet calib", "data-i18n-aria-label": "calib.title" },
    h("header", { class: "row spread" }, h("h2", { "data-i18n": "calib.title", text: t("calib.title") }), button("calib.close", () => dialog.close())),
    h("ol", { class: "calib-steps" }, h("li", { "data-i18n": "calib.step1", text: t("calib.step1") }), h("li", { "data-i18n": "calib.step2", text: t("calib.step2") }), h("li", { "data-i18n": "calib.step3", text: t("calib.step3") })),
    h("div", { class: "row wrap" }, pick, regions, picker),
    h("div", { class: "calib-photo" }, canvas, empty),
    h("div", { class: "pair" }, threads.el, span.el),
    which.el,
    result,
    tx("calib.note", "hint"),
    h("div", { class: "row end" }, apply),
  );
  document.body.append(dialog);
  threads.set(count);
  span.set(spanMm);

  function setActive(region: Region): void {
    active = region;
    for (const r of ["board", "patch"] as const) regionButtons[r].setAttribute("aria-pressed", String(r === active));
  }

  /** The effective width the two marked areas give, or null while something is missing. */
  function measured(): Calibration | null {
    const p = ctl.state.project, thread = p.threads[Number(which.select.value)] ?? p.threads[0];
    if (!photo || !rects.board || !rects.patch || !thread) return null;
    const { width, height, rgba } = photo;
    const lum = (r: Rect) => meanLuminance(rgba, width, height, r.x0 * width, r.y0 * height, r.x1 * width, r.y1 * height);
    return calibrate({ board: lum(rects.board), patch: lum(rects.patch), threads: count, spanMm, boardHex: p.board, threadHex: thread.hex });
  }

  /** Where the photograph sits on the canvas, in CSS px. */
  function shown(): { w: number; h: number } {
    if (!photo) return { w: MAX_W, h: 160 };
    const room = dialog.clientWidth > 80 ? Math.min(MAX_W, dialog.clientWidth - 40) : MAX_W;
    const k = Math.min(room / photo.width, MAX_H / photo.height);
    return { w: Math.max(1, Math.round(photo.width * k)), h: Math.max(1, Math.round(photo.height * k)) };
  }

  function draw(): void {
    const { w, h: hh } = shown();
    canvas.style.setProperty("width", `${w}px`);
    canvas.style.setProperty("height", `${hh}px`);
    const dpr = fitCanvas(canvas, w, hh), ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    empty.hidden = !!photo;
    canvas.hidden = !photo;
    if (!photo || !picture) return;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
    ctx.font = `${12 * dpr}px system-ui, sans-serif`;
    for (const region of ["board", "patch"] as const) {
      const r = rects[region];
      if (!r) continue;
      const x = r.x0 * canvas.width, y = r.y0 * canvas.height, rw = (r.x1 - r.x0) * canvas.width, rh = (r.y1 - r.y0) * canvas.height;
      // white under the colour, so the frame shows on any photograph
      ctx.lineWidth = 4 * dpr;
      ctx.strokeStyle = "#ffffff";
      ctx.strokeRect(x, y, rw, rh);
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = COLOURS[region];
      ctx.strokeRect(x, y, rw, rh);
      const label = t(`calib.${region}`), tw = ctx.measureText(label).width + 8 * dpr;
      ctx.fillStyle = COLOURS[region];
      ctx.fillRect(x, Math.max(0, y - 18 * dpr), tw, 18 * dpr);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x + 4 * dpr, Math.max(13 * dpr, y - 5 * dpr));
    }
  }

  function update(): void {
    const p = ctl.state.project;
    // the threads of the palette, by name; the one chosen stays chosen while it exists
    const chosen = Math.min(Number(which.select.value) || 0, p.threads.length - 1);
    which.select.replaceChildren(...p.threads.map((th, i) => h("option", { value: String(i), text: th.name ? `${th.name} (${th.hex})` : th.hex })));
    which.set(String(Math.max(0, chosen)));
    which.el.hidden = p.threads.length < 2;
    setActive(active);
    const c = measured();
    result.classList.toggle("warn", !!c && c.problem !== "none");
    result.textContent = !photo ? "" : !c ? t("calib.need")
      : c.problem === "none" ? t("calib.result", { w: c.widthMm.toFixed(2), percent: Math.round(100 * c.coverage) })
      : t(`calib.problem.${c.problem}`, { w: c.widthMm.toFixed(2), percent: Math.round(100 * c.coverage) });
    apply.disabled = !c || c.problem !== "none";
    draw();
  }

  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    picker.value = "";
    if (!file) return;
    void decodePicture(file, PHOTO_SIDE).then(
      (decoded) => {
        photo = decoded;
        picture = rgbaCanvas("calib", decoded.rgba, decoded.width, decoded.height); // once: dragging only redraws it
        rects.board = rects.patch = null;
        setActive("board");
        update();
      },
      () => ctl.notify("error.decode", { name: file.name }, "error"),
    );
  });

  // drag a rectangle for the active region
  const at = (e: PointerEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!photo) return;
    canvas.setPointerCapture(e.pointerId);
    drag = at(e);
    rects[active] = { x0: drag.x, y0: drag.y, x1: drag.x, y1: drag.y };
    draw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = at(e);
    rects[active] = { x0: Math.min(drag.x, p.x), y0: Math.min(drag.y, p.y), x1: Math.max(drag.x, p.x), y1: Math.max(drag.y, p.y) };
    draw();
  });
  const release = () => {
    if (!drag || !photo) return;
    drag = null;
    const r = rects[active];
    // a click without a drag marks nothing
    if (r && ((r.x1 - r.x0) * photo.width < 4 || (r.y1 - r.y0) * photo.height < 4)) rects[active] = null;
    else if (active === "board" && !rects.patch) setActive("patch"); // the other area is next
    update();
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  return {
    open() {
      if (!dialog.open) dialog.showModal();
      refreshText(dialog);
      update();
    },
  };
}
