// The left column: step 1 (the picture) and step 2 (colours, frame and thread, adjustments, importance,
// generation). Every panel is built once; its "sync" closure pushes the state into the controls.
import type { Controller } from "../app/controller.ts";
import type { AppState } from "../app/state.ts";
import { ORDER_SEARCH_MAX, PRESETS, presetOf } from "../core/palette.ts";
import { IMPORTANCE_PRESETS, isHex, LIMITS, maxMinSkip, maxResolution, NEUTRAL_ADJUST, type Adjust, type ThreadSpec } from "../core/project.ts";
import { SAMPLE_IDS } from "../core/targets.ts";
import { t } from "../i18n/i18n.ts";
import { button, checkField, h, nextId, numberField, rangeField, refreshText, selectField, tx } from "./dom.ts";

export type Sync = (s: AppState) => void;

const percent = (v: number) => `${(100 * v).toFixed(1)}%`;

// ---------- step 1: the picture

export function mountPicturePanel(root: HTMLElement, ctl: Controller, syncs: Sync[], pickFile: () => void): void {
  const source = h("p", { class: "source" });
  const missing = h("p", { class: "advice", "data-i18n": "picture.reopen", text: t("picture.reopen") });
  const samples = h("div", { class: "row wrap" }, ...SAMPLE_IDS.map((id) => button(`sample.${id}`, () => void ctl.openSample(id))));
  const zoom = rangeField({
    label: "crop.zoom", min: -1, max: 2.3, step: 0.01, format: (v) => `${Math.exp(v).toFixed(2)}×`,
    onInput: (v) => ctl.setCrop({ scale: Math.exp(v) }), onCommit: (v) => ctl.setCrop({ scale: Math.exp(v) }),
  });
  const rotate = rangeField({
    label: "crop.rotate", min: -180, max: 180, step: 1, format: (v) => `${v.toFixed(0)}°`,
    onInput: (v) => ctl.setCrop({ rotateDeg: v }), onCommit: (v) => ctl.setCrop({ rotateDeg: v }),
  });
  const reset = button("crop.reset", () => ctl.setCrop({ cx: 0.5, cy: 0.5, scale: 1, rotateDeg: 0 }));
  const crop = h("div", { class: "crop-tools" }, zoom.el, rotate.el, h("div", { class: "row spread" }, tx("crop.hint", "hint"), reset));
  root.append(
    h("section", { class: "group" },
      h("h2", { class: "step" }, h("span", { class: "step-no", text: "1" }), tx("step.picture")),
      h("div", { class: "row wrap" }, button("picture.open", pickFile, "primary")),
      tx("picture.privacy", "hint"),
      h("h4", { "data-i18n": "picture.samples", text: t("picture.samples") }),
      samples,
      source,
      missing,
      crop,
    ),
  );
  syncs.push((s) => {
    const src = s.source;
    source.textContent = src ? (src.sample ? t(`sample.${src.sample}`) : `${src.name} · ${src.width} × ${src.height}`) : "";
    source.hidden = !src;
    missing.hidden = !s.pictureMissing;
    crop.hidden = !src || src.sample !== null; // samples are made at the working resolution and never cropped
    zoom.set(Math.log(s.project.image.crop.scale));
    rotate.set(s.project.image.crop.rotateDeg);
  });
}

// ---------- step 2: colours

interface ThreadRow {
  el: HTMLElement;
  colour: HTMLInputElement;
  hex: HTMLInputElement;
  name: HTMLInputElement;
  budget: HTMLInputElement;
  up: HTMLButtonElement;
  down: HTMLButtonElement;
  remove: HTMLButtonElement;
}

export function mountPalettePanel(root: HTMLElement, ctl: Controller, syncs: Sync[]): void {
  const mode = h("div", { class: "segmented", role: "group", "data-i18n-aria-label": "palette.mode" },
    h("button", { type: "button", "data-i18n": "mode.mono", text: t("mode.mono"), onclick: () => ctl.setMode("mono") }),
    h("button", { type: "button", "data-i18n": "mode.colour", text: t("mode.colour"), onclick: () => ctl.setMode("colour") }),
  );
  const preset = selectField({
    label: "palette.preset",
    options: [...PRESETS.map((p) => ({ value: p.id, label: `preset.${p.id}` })), { value: "custom", label: "preset.custom" }],
    onChange: (id) => ctl.applyPreset(id),
  });
  const presetNote = h("p", { class: "hint" });
  const boardId = nextId("board");
  const boardColour = h("input", { id: boardId, type: "color" });
  const boardHex = h("input", { type: "text", class: "hex", maxlength: 7, spellcheck: "false", "data-i18n-aria-label": "palette.boardHex" });
  boardColour.addEventListener("input", () => ctl.set(["board"], boardColour.value.toUpperCase()));
  boardHex.addEventListener("change", () => { if (isHex(boardHex.value.trim())) ctl.set(["board"], boardHex.value.trim().toUpperCase()); });
  const board = h("div", { class: "field" }, h("label", { for: boardId, "data-i18n": "palette.board", text: t("palette.board") }), h("span", { class: "control" }, boardColour, boardHex));

  const list = h("ol", { class: "threads" });
  const rows: ThreadRow[] = [];
  let dragFrom = -1;
  const makeRow = (index: number): ThreadRow => {
    const id = nextId("thread");
    const colour = h("input", { type: "color", "data-i18n-aria-label": "thread.colour" });
    const hex = h("input", { type: "text", class: "hex", maxlength: 7, spellcheck: "false", "data-i18n-aria-label": "thread.hex" });
    const name = h("input", { id, type: "text", class: "thread-name", maxlength: LIMITS.nameLength, "data-i18n-aria-label": "thread.name" });
    const budget = h("input", { type: "number", class: "num budget", min: LIMITS.maxLines[0], max: LIMITS.maxLines[1], step: 100, "data-i18n-aria-label": "thread.budget", "data-i18n-title": "thread.budget" });
    const up = h("button", { type: "button", class: "icon", text: "↑", "data-i18n-aria-label": "thread.earlier", "data-i18n-title": "thread.earlier", onclick: () => ctl.moveThread(index, -1) });
    const down = h("button", { type: "button", class: "icon", text: "↓", "data-i18n-aria-label": "thread.later", "data-i18n-title": "thread.later", onclick: () => ctl.moveThread(index, 1) });
    const remove = h("button", { type: "button", class: "icon", text: "×", "data-i18n-aria-label": "thread.remove", "data-i18n-title": "thread.remove", onclick: () => ctl.removeThread(index) });
    const keep = h("button", { type: "button", class: "icon", text: "☆", "data-i18n-aria-label": "shelf.keep", "data-i18n-title": "shelf.keep", onclick: () => ctl.shelveThread(index) });
    const grip = h("span", { class: "grip", draggable: "true", text: "⠿", "data-i18n-title": "thread.drag", "aria-hidden": "true" });
    colour.addEventListener("input", () => ctl.setThread(index, { hex: colour.value.toUpperCase() }));
    hex.addEventListener("change", () => { if (isHex(hex.value.trim())) ctl.setThread(index, { hex: hex.value.trim().toUpperCase() }); });
    name.addEventListener("change", () => ctl.setThread(index, { name: name.value }));
    budget.addEventListener("change", () => { if (Number.isFinite(budget.valueAsNumber)) ctl.setThread(index, { maxLines: budget.valueAsNumber }); });
    const el = h("li", { class: "thread" }, grip, colour, hex, name, budget, up, down, remove, keep);
    grip.addEventListener("dragstart", (e) => {
      dragFrom = index;
      e.dataTransfer?.setData("text/plain", String(index));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragover", (e) => { if (dragFrom >= 0) { e.preventDefault(); e.stopPropagation(); } });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragFrom >= 0) ctl.placeThread(dragFrom, index);
      dragFrom = -1;
    });
    grip.addEventListener("dragend", () => (dragFrom = -1));
    refreshText(el); // a row made after the page was labelled: fill its aria-labels and tooltips now
    return { el, colour, hex, name, budget, up, down, remove };
  };
  const setIfIdle = (input: HTMLInputElement, value: string) => { if (document.activeElement !== input && input.value !== value) input.value = value; };
  const syncRows = (threads: readonly ThreadSpec[]) => {
    while (rows.length < threads.length) { const row = makeRow(rows.length); rows.push(row); list.append(row.el); }
    while (rows.length > threads.length) rows.pop()!.el.remove();
    threads.forEach((th, i) => {
      const row = rows[i]!;
      setIfIdle(row.colour, th.hex.toLowerCase());
      setIfIdle(row.hex, th.hex);
      setIfIdle(row.name, th.name);
      setIfIdle(row.budget, String(th.maxLines));
      row.up.disabled = i === 0;
      row.down.disabled = i === threads.length - 1;
      row.remove.disabled = threads.length <= 1;
    });
  };

  // the user's own thread colours (§6.3): a chip adds that thread to the palette
  const shelf = h("div", { class: "shelf" });
  const shelfBox = h("div", { class: "shelf-box" }, h("h4", { "data-i18n": "shelf.title", text: t("shelf.title") }), shelf);
  let shelfShown: unknown = null;
  const syncShelf = (s: AppState) => {
    shelfBox.hidden = !s.shelf.length;
    if (shelfShown === s.shelf) return;
    shelfShown = s.shelf;
    shelf.replaceChildren(...s.shelf.map((entry, i) => {
      const dot = h("span", { class: "dot" });
      dot.style.setProperty("background", entry.hex);
      return h("span", { class: "chip" },
        h("button", { type: "button", class: "chip-use", "data-i18n-title": "shelf.use", title: t("shelf.use"), onclick: () => ctl.useShelved(i) }, dot, entry.name || entry.hex),
        h("button", { type: "button", class: "chip-remove", text: "×", "data-i18n-aria-label": "shelf.remove", "aria-label": t("shelf.remove"), "data-i18n-title": "shelf.remove", title: t("shelf.remove"), onclick: () => ctl.unshelve(i) }),
      );
    }));
  };

  const add = button("thread.add", () => ctl.addThread());
  const sort = button("thread.sort", () => ctl.sortThreads());
  const search = button("order.search", () => void ctl.searchOrder());
  const cancel = button("order.stop", () => ctl.stopOrderSearch());
  const orderStatus = h("p", { class: "status" });
  const orderScores = h("ol", { class: "order-scores" });
  const warnings = h("ul", { class: "issues" });

  root.append(
    h("section", { class: "group" },
      h("h2", { class: "step" }, h("span", { class: "step-no", text: "2" }), tx("step.settings")),
      h("h3", { "data-i18n": "group.palette", text: t("group.palette") }),
      mode, preset.el, presetNote, board,
      h("h4", { "data-i18n": "thread.list", text: t("thread.list") }),
      tx("thread.listHint", "hint"),
      list,
      h("div", { class: "row wrap" }, add, sort),
      shelfBox,
      h("div", { class: "row wrap order-tools" }, search, cancel),
      tx("order.hint", "hint"),
      orderStatus, orderScores, warnings,
    ),
  );

  syncs.push((s) => {
    const p = s.project;
    mode.children[0]!.setAttribute("aria-pressed", String(p.mode === "mono"));
    mode.children[1]!.setAttribute("aria-pressed", String(p.mode === "colour"));
    const current = presetOf(p);
    preset.set(current);
    for (const option of preset.select.options) option.hidden = option.value !== "custom" && PRESETS.find((x) => x.id === option.value)?.mode !== p.mode;
    presetNote.textContent = current === "mono-black-white" ? t("preset.blackWhiteNote") : "";
    presetNote.hidden = !presetNote.textContent;
    setIfIdle(boardColour, p.board.toLowerCase());
    setIfIdle(boardHex, p.board);
    syncRows(p.threads);
    syncShelf(s);
    add.disabled = p.threads.length >= LIMITS.threads;
    sort.hidden = p.threads.length < 2;
    const searching = s.order.status === "running";
    search.hidden = searching || p.threads.length < 2 || p.threads.length > ORDER_SEARCH_MAX;
    search.disabled = !ctl.canSearchOrder();
    cancel.hidden = !searching;
    orderStatus.textContent = searching ? t("order.progress", { done: s.order.done, total: s.order.total }) : "";
    orderStatus.hidden = !searching;
    orderScores.replaceChildren(...(s.order.scores ?? []).slice(0, 6).map((score) => {
      const dots = score.order.map((i) => {
        const dot = h("span", { class: "dot" });
        dot.style.setProperty("background", s.order.hexes[i] ?? "#888");
        return dot;
      });
      return h("li", null, h("span", { class: "dots" }, ...dots), h("span", { text: score.full !== null ? percent(score.full) : `≈ ${percent(score.proxy)}` }));
    }));
    orderScores.hidden = searching || !s.order.scores;
    const codes = s.issues.filter((c) => c === "thread-equals-board" || c === "duplicate-thread" || c === "thread-colour" || c === "threads-count");
    warnings.replaceChildren(...codes.map((c) => h("li", { text: t(`issue.${c}`) })));
    warnings.hidden = !codes.length;
  });
}

// ---------- step 2: frame, thread, adjustments, importance, generation settings

export function mountSettingsPanel(root: HTMLElement, ctl: Controller, syncs: Sync[]): void {
  const D = numberField({ label: "frame.diameter", unit: "mm", min: LIMITS.diameterMm[0], max: LIMITS.diameterMm[1], step: 10, onCommit: (v) => ctl.set(["frame", "diameterMm"], v) });
  const pins = numberField({ label: "frame.pins", min: LIMITS.pins[0], max: LIMITS.pins[1], step: 1, onCommit: (v) => ctl.set(["frame", "pins"], v) });
  const pinD = numberField({ label: "frame.pinDiameter", unit: "mm", min: LIMITS.pinDiameterMm[0], max: LIMITS.pinDiameterMm[1], step: 0.1, onCommit: (v) => ctl.set(["frame", "pinDiameterMm"], v) });
  const width = numberField({ label: "thread.width", unit: "mm", min: LIMITS.widthMm[0], max: LIMITS.widthMm[1], step: 0.01, hint: "thread.widthHint", onCommit: (v) => ctl.set(["thread", "widthMm"], v) });
  const spacing = h("p", { class: "stats" });

  const adjust = (key: keyof Adjust, min: number, max: number, step: number, format: (v: number) => string) =>
    rangeField({ label: `adjust.${key}`, min, max, step, format, onInput: (v) => ctl.set(["adjust", key], v), onCommit: (v) => ctl.set(["adjust", key], v) });
  const signed = (v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  const brightness = adjust("brightness", -0.5, 0.5, 0.01, signed);
  const contrast = adjust("contrast", -0.5, 1, 0.01, signed);
  const gamma = adjust("gamma", 0.4, 2.5, 0.01, (v) => v.toFixed(2));
  const saturation = adjust("saturation", 0, 2, 0.01, (v) => v.toFixed(2));
  const range = adjust("rangeCompression", 0.3, 1, 0.01, (v) => v.toFixed(2));
  const unsharp = adjust("unsharp", 0, 1.5, 0.01, (v) => v.toFixed(2));
  const invert = checkField({ label: "adjust.invert", onChange: (v) => ctl.set(["adjust", "invert"], v) });
  const resetAdjust = button("adjust.reset", () => ctl.set(["adjust"], { ...NEUTRAL_ADJUST }));

  const preset = selectField({ label: "importance.preset", options: IMPORTANCE_PRESETS.map((id) => ({ value: id, label: `importance.${id}` })), onChange: (v) => ctl.set(["importance", "preset"], v) });
  const brushOn = checkField({ label: "brush.on", onChange: (on) => ctl.setView({ brush: { ...ctl.state.view.brush, on }, tab: on ? "target" : ctl.state.view.tab }) });
  const brushWeight = rangeField({
    label: "brush.weight", min: 0, max: 3, step: 0.25, format: (v) => (v === 1 ? t("brush.normal") : `${v.toFixed(2)}×`),
    onCommit: (v) => ctl.setView({ brush: { ...ctl.state.view.brush, weight: v } }),
  });
  const brushSize = rangeField({
    label: "brush.size", min: 0.01, max: 0.25, step: 0.005, format: (v) => `${(100 * v).toFixed(1)}%`,
    onCommit: (v) => ctl.setView({ brush: { ...ctl.state.view.brush, radius: v } }),
  });
  const undo = button("brush.undo", () => ctl.undoStroke());
  const clear = button("brush.clear", () => ctl.clearStrokes());

  const res = numberField({ label: "gen.res", unit: "px", min: LIMITS.res[0], max: LIMITS.res[1], step: 10, hint: "gen.resHint", onCommit: (v) => ctl.set(["generator", "res"], v) });
  const skip = numberField({ label: "gen.minSkip", min: 1, max: 255, step: 1, hint: "gen.minSkipHint", onCommit: (v) => ctl.set(["generator", "minSkip"], v) });
  const notes = h("ul", { class: "issues" });

  root.append(
    h("section", { class: "group" },
      h("h3", { "data-i18n": "group.frame", text: t("group.frame") }),
      h("div", { class: "pair" }, D.el, pins.el), h("div", { class: "pair" }, width.el, pinD.el), spacing,
    ),
    h("details", { class: "group" },
      h("summary", { "data-i18n": "group.adjust", text: t("group.adjust") }),
      brightness.el, contrast.el, gamma.el, saturation.el, range.el, tx("adjust.rangeHint", "hint"), unsharp.el, invert.el, h("div", { class: "row end" }, resetAdjust),
    ),
    h("details", { class: "group" },
      h("summary", { "data-i18n": "group.importance", text: t("group.importance") }),
      preset.el, tx("importance.hint", "hint"), brushOn.el, brushWeight.el, brushSize.el, h("div", { class: "row wrap" }, undo, clear),
    ),
    h("details", { class: "group" },
      h("summary", { "data-i18n": "group.generator", text: t("group.generator") }),
      h("div", { class: "pair" }, res.el, skip.el), notes,
    ),
  );

  syncs.push((s) => {
    const p = s.project;
    D.set(p.frame.diameterMm);
    pins.set(p.frame.pins);
    pinD.set(p.frame.pinDiameterMm);
    width.set(p.thread.widthMm);
    const gap = (Math.PI * p.frame.diameterMm) / p.frame.pins;
    spacing.textContent = t("frame.spacing", { gap: Number(gap.toFixed(1)), place: Number((gap / 2).toFixed(1)) });
    brightness.set(p.adjust.brightness);
    contrast.set(p.adjust.contrast);
    gamma.set(p.adjust.gamma);
    saturation.set(p.adjust.saturation);
    saturation.el.hidden = p.mode !== "colour";
    range.set(p.adjust.rangeCompression);
    unsharp.set(p.adjust.unsharp);
    invert.set(p.adjust.invert);
    preset.set(p.importance.preset);
    brushOn.set(s.view.brush.on);
    brushWeight.set(s.view.brush.weight);
    brushSize.set(s.view.brush.radius);
    undo.disabled = clear.disabled = !p.importance.strokes.length;
    res.set(p.generator.res);
    res.input.max = String(Math.min(LIMITS.res[1], maxResolution(p.frame.diameterMm, p.thread.widthMm)));
    skip.set(p.generator.minSkip);
    skip.input.max = String(maxMinSkip(p.frame.pins));
    const alpha = (p.thread.widthMm * (p.generator.res - 1)) / p.frame.diameterMm;
    const codes = s.issues.filter((c) => c === "alpha" || c === "min-skip" || c === "frame" || c === "thread" || c === "generator" || c === "budget");
    notes.replaceChildren(h("li", { class: "plain", text: t("gen.alpha", { alpha: Number(alpha.toFixed(2)) }) }), ...codes.map((c) => h("li", { text: t(`issue.${c}`) })));
  });
}

// ---------- generate

export function mountGeneratePanel(root: HTMLElement, ctl: Controller, syncs: Sync[]): void {
  const go = button("run.generate", () => void ctl.generate(false), "primary big");
  const more = button("run.continue", () => void ctl.generate(true));
  const stop = button("run.stop", () => ctl.stop());
  const progress = h("progress", { max: 1, value: 0 });
  const status = h("p", { class: "status", role: "status" });
  const notes = h("ul", { class: "issues" });
  root.append(h("section", { class: "run" }, h("div", { class: "row wrap" }, go, more, stop, progress, status), notes));
  syncs.push((s) => {
    const running = s.run.status !== "idle", has = !!s.made;
    go.hidden = running;
    go.dataset.i18n = has ? "run.again" : "run.generate";
    go.textContent = t(go.dataset.i18n);
    go.disabled = !ctl.canGenerate();
    more.hidden = running || !ctl.canContinue();
    stop.hidden = !running;
    stop.disabled = s.run.status === "stopping";
    progress.hidden = !running;
    const lines = s.run.lines.reduce((a, b) => a + b, 0), budget = s.project.threads.reduce((a, th) => a + th.maxLines, 0);
    progress.value = budget ? Math.min(1, lines / budget) : 0;
    if (running) {
      status.textContent = s.run.status === "stopping" ? t("run.stopping") : t("run.progress", { n: lines, percent: s.run.initialError ? Number((100 * (1 - s.run.error / s.run.initialError)).toFixed(1)) : 0 });
    } else if (s.pictureMissing) status.textContent = t("run.needPicture");
    else if (s.targetBusy || !s.target) status.textContent = t("run.preparing");
    else status.textContent = "";
    // what §14 asks to be said about a finished run
    const items: string[] = [];
    if (!running && s.result && s.made?.result) {
      const r = s.result, names = (ks: number[]) => ks.map((k) => s.made!.threads[k]?.name ?? "").join(t("list.separator"));
      if (r.reason === "empty") items.push(t("run.empty"));
      if (r.reason === "stopped") items.push(t("run.stopped"));
      if (r.budgetBlocked.length) items.push(t("run.budget", { names: names(r.budgetBlocked) }));
      if (r.unstarted.length && r.reason !== "empty") items.push(t("run.unstarted", { names: names(r.unstarted) }));
    }
    notes.replaceChildren(...items.map((text) => h("li", { class: "plain", text })));
    notes.hidden = !items.length;
  });
}
