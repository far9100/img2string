// The left column: step 1 (the picture) and step 2 (colours, frame and thread, adjustments, importance,
// generation). Every panel is built once; its "sync" closure pushes the state into the controls.
import type { Controller } from "../app/controller.ts";
import type { AppState } from "../app/state.ts";
import { SLIDER, type Tuning } from "../core/autoAdjust.ts";
import { THREAD_PRESETS } from "../core/calibration.ts";
import { frameSizeMm, pinSpacingMm, tooDenseForInside } from "../core/frame.ts";
import { hueName, type GamutSummary } from "../core/gamut.ts";
import { insideGapMm } from "../core/inside.ts";
import { ORDER_SEARCH_MAX, PRESETS, presetOf, toHex } from "../core/palette.ts";
import { MOSTLY_BLANK } from "../core/preprocess.ts";
import { IMPORTANCE_PRESETS, isHex, LIMITS, maxMinSkip, maxResolution, NEUTRAL_ADJUST, targetKey, type ThreadSpec } from "../core/project.ts";
import { SAMPLE_IDS } from "../core/targets.ts";
import { getLang, t } from "../i18n/i18n.ts";
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

  // §6.3, colour mode: what the threads cannot mix, the thread that would help most, and choosing threads
  const gamutStatus = h("p", { class: "gamut-status" });
  const gamutList = h("ul", { class: "gamut-list" });
  const addSuggested = button("gamut.add", () => ctl.addSuggestedThread());
  const showGamut = checkField({ label: "gamut.show", onChange: (v) => ctl.setView({ gamut: v }) });
  let autoThreads = 4;
  const autoCount = numberField({ label: "auto.count", min: 1, max: LIMITS.threads, step: 1, onCommit: (v) => { autoThreads = Math.min(LIMITS.threads, Math.max(1, Math.round(v))); autoCount.input.value = String(autoThreads); } });
  autoCount.set(autoThreads);
  const autoSource = selectField({ label: "auto.source", options: [{ value: "free", label: "auto.free" }, { value: "shelf", label: "auto.shelf" }], onChange: () => syncGamut(ctl.state) });
  const autoGo = button("auto.go", () => ctl.autoPalette(autoThreads, autoSource.select.value as "free" | "shelf"));
  const gamutBox = h("div", { class: "gamut" },
    h("h4", { "data-i18n": "gamut.title", text: t("gamut.title") }),
    gamutStatus, gamutList, h("div", { class: "row wrap" }, addSuggested), showGamut.el,
    h("h4", { "data-i18n": "auto.title", text: t("auto.title") }),
    h("div", { class: "pair" }, autoCount.el, autoSource.el),
    h("div", { class: "row wrap" }, autoGo),
    tx("auto.hint", "hint"),
  );
  let gamutShown: GamutSummary | null | undefined, gamutLang = "";
  const swatch = (hex: string) => {
    const el = h("span", { class: "swatch", title: hex });
    el.style.setProperty("background", hex);
    return el;
  };
  const syncGamut = (s: AppState) => {
    const colour = s.project.mode === "colour", g = colour ? (s.target?.gamut ?? null) : null;
    gamutBox.hidden = !colour;
    if (!colour) return;
    addSuggested.hidden = !g?.suggestion;
    addSuggested.disabled = !ctl.canAddSuggested();
    showGamut.set(s.view.gamut);
    showGamut.el.hidden = !g || g.outShare <= 0;
    autoGo.disabled = !ctl.canAutoPalette(autoSource.select.value as "free" | "shelf");
    for (const option of autoSource.select.options) if (option.value === "shelf") option.disabled = !s.shelf.length;
    if (!s.shelf.length && autoSource.select.value === "shelf") autoSource.set("free");
    if (gamutShown === g && gamutLang === getLang()) return; // what follows changes only with the check or the language
    gamutShown = g;
    gamutLang = getLang();
    if (!g) { gamutStatus.textContent = t("gamut.wait"); gamutList.replaceChildren(); return; }
    const hue = g.suggestion ? t(`hue.${hueName(g.suggestion)}`) : "";
    gamutStatus.textContent = g.suggestion ? t("gamut.out", { percent: Math.round(100 * g.outShare), hue }) : t("gamut.fine");
    gamutStatus.classList.toggle("warn", !!g.suggestion);
    if (g.suggestion) addSuggested.textContent = t("gamut.add", { hue, hex: toHex(g.suggestion) });
    // the largest groups out of reach: the colour wanted, and the nearest one these threads can make
    gamutList.replaceChildren(...g.clusters.filter((c) => c.out).slice(0, 4).map((c) =>
      h("li", null, swatch(toHex(c.colour)), h("span", { class: "arrow", "aria-hidden": "true", text: "→" }), swatch(toHex(c.nearest)), h("span", { text: t("gamut.share", { percent: Math.max(1, Math.round(100 * c.share)) }) }))));
  };

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
      gamutBox,
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
    syncGamut(s);
  });
}

// ---------- step 2: frame, thread, adjustments, importance, generation settings

/** A picture whose long side is this many times its short side is told that a round frame cannot show all of
 * it (D-58): at 1.1 the circle shows 71 % of the picture, at 4:3 it shows 59 %. */
const NOT_SQUARE = 1.1;
/** How many pins inside the picture the advice for a line drawing offers: the number that was measured (D-60). */
const INSIDE_OFFER = 300;

export function mountSettingsPanel(root: HTMLElement, ctl: Controller, syncs: Sync[], calibrate: () => void): void {
  const D = numberField({ label: "frame.diameter", unit: "mm", min: LIMITS.diameterMm[0], max: LIMITS.diameterMm[1], step: 10, onCommit: (v) => ctl.set(["frame", "diameterMm"], v) });
  const pins = numberField({ label: "frame.pins", min: LIMITS.pins[0], max: LIMITS.pins[1], step: 1, onCommit: (v) => ctl.set(["frame", "pins"], v) });
  const pinD = numberField({ label: "frame.pinDiameter", unit: "mm", min: LIMITS.pinDiameterMm[0], max: LIMITS.pinDiameterMm[1], step: 0.1, onCommit: (v) => ctl.set(["frame", "pinDiameterMm"], v) });
  const width = numberField({ label: "thread.width", unit: "mm", min: LIMITS.widthMm[0], max: LIMITS.widthMm[1], step: 0.01, hint: "thread.widthHint", onCommit: (v) => ctl.set(["thread", "widthMm"], v) });
  const spacing = h("p", { class: "stats" });
  // D-58: round, or a rectangle with the picture's proportions; a picture that is not square is told so
  const shape = selectField({
    label: "frame.shape", options: [{ value: "circle", label: "frame.shapeCircle" }, { value: "rect", label: "frame.shapeRect" }],
    onChange: (v) => ctl.set(["frame", "shape"], v),
  });
  const shapeNote = h("p", { class: "advice" });
  const useRect = button("frame.useRect", () => ctl.set(["frame", "shape"], "rect"));
  const shapeAdvice = h("div", { class: "frame-advice" }, shapeNote, h("div", { class: "row wrap" }, useRect));
  // D-60: pins inside the picture as well, placed on its strokes; how many stand is said below the field
  const inside = numberField({ label: "frame.inside", min: LIMITS.inside[0], max: LIMITS.inside[1], step: 10, hint: "frame.insideHint", onCommit: (v) => ctl.set(["frame", "inside"], v) });
  const insideNote = h("p", { class: "hint inside-note", role: "status" });
  // §6.6: typical widths, or the width measured from a photograph of a test patch
  const kind = selectField({
    label: "thread.kind",
    options: [...THREAD_PRESETS.map((p) => ({ value: p.id, label: `thread.kind.${p.id}` })), { value: "custom", label: "thread.kind.custom" }],
    onChange: (id) => { const preset = THREAD_PRESETS.find((p) => p.id === id); if (preset) ctl.set(["thread", "widthMm"], preset.widthMm); },
  });
  const measure = button("calib.open", calibrate);

  // DECISIONS D-55: the sliders of the two groups below, set by trying them
  const tune = button("tune.go", () => void ctl.autoAdjust(), "primary");
  const tuneStop = button("tune.stop", () => ctl.stopAutoAdjust());
  const tuneStatus = h("p", { class: "status", role: "status" });
  // D-53: a picture that is mostly bare board (a line drawing) needs a thread that clears what the black one greys
  const blankNote = h("p", { class: "advice" });
  const addWhite = button("tune.addWhite", () => ctl.applyPreset("mono-black-white"));
  const blank = h("div", { class: "blank" }, blankNote, h("div", { class: "row wrap" }, addWhite));
  // D-60: such a picture is also where pins inside it help most; offered until there are some
  const addInside = button("tune.addInside", () => ctl.set(["frame", "inside"], INSIDE_OFFER));
  const sparse = h("div", { class: "sparse" }, tx("tune.insideNote", "advice"), h("div", { class: "row wrap" }, addInside));

  // the sliders the automatic adjustment sets take their ranges from it (SLIDER), so it can never leave them
  const adjust = (key: Exclude<keyof Tuning, "edges" | "tone">, format: (v: number) => string) =>
    rangeField({ label: `adjust.${key}`, ...SLIDER[key], format, onInput: (v) => ctl.set(["adjust", key], v), onCommit: (v) => ctl.set(["adjust", key], v) });
  const signed = (v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
  const brightness = adjust("brightness", signed);
  const contrast = adjust("contrast", signed);
  const gamma = adjust("gamma", (v) => v.toFixed(2));
  const saturation = adjust("saturation", (v) => v.toFixed(2));
  const range = adjust("rangeCompression", (v) => v.toFixed(2));
  const unsharp = adjust("unsharp", (v) => v.toFixed(2));
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
  // §6.5 M2 and §13.5: weight taken from the picture itself
  const edges = rangeField({
    label: "importance.edges", ...SLIDER.edges, format: (v) => (v === 0 ? t("importance.off") : `+${Math.round(100 * v)}%`),
    onCommit: (v) => ctl.set(["importance", "edges"], v),
  });
  const tone = rangeField({
    label: "importance.tone", ...SLIDER.tone, format: (v) => (v === 0 ? t("importance.off") : `${Math.round(100 * v)}%`),
    onCommit: (v) => ctl.set(["importance", "tone"], v),
  });

  const res = numberField({ label: "gen.res", unit: "px", min: LIMITS.res[0], max: LIMITS.res[1], step: 10, hint: "gen.resHint", onCommit: (v) => ctl.set(["generator", "res"], v) });
  const skip = numberField({ label: "gen.minSkip", min: 1, max: 255, step: 1, hint: "gen.minSkipHint", onCommit: (v) => ctl.set(["generator", "minSkip"], v) });
  const repeat = checkField({ label: "gen.repeat", onChange: (v) => ctl.set(["generator", "allowRepeat"], v) });
  const repeatInside = tx("gen.repeatInside", "hint");
  const notes = h("ul", { class: "issues" });

  root.append(
    h("section", { class: "group" },
      h("h3", { "data-i18n": "group.frame", text: t("group.frame") }),
      shape.el, h("div", { class: "pair" }, D.el, pins.el), h("div", { class: "pair" }, width.el, pinD.el), spacing, shapeAdvice,
      inside.el, insideNote,
      kind.el, h("div", { class: "row wrap" }, measure),
    ),
    h("section", { class: "group tune" },
      h("h3", { "data-i18n": "group.tune", text: t("group.tune") }),
      h("div", { class: "row wrap" }, tune, tuneStop),
      tuneStatus,
      tx("tune.hint", "hint"),
      blank,
      sparse,
    ),
    h("details", { class: "group" },
      h("summary", { "data-i18n": "group.adjust", text: t("group.adjust") }),
      brightness.el, contrast.el, gamma.el, saturation.el, range.el, tx("adjust.rangeHint", "hint"), unsharp.el, invert.el, h("div", { class: "row end" }, resetAdjust),
    ),
    h("details", { class: "group" },
      h("summary", { "data-i18n": "group.importance", text: t("group.importance") }),
      preset.el, tx("importance.hint", "hint"), brushOn.el, brushWeight.el, brushSize.el, h("div", { class: "row wrap" }, undo, clear),
      h("h4", { "data-i18n": "importance.auto", text: t("importance.auto") }),
      edges.el, tx("importance.edgesHint", "hint"), tone.el, tx("importance.toneHint", "hint"),
    ),
    h("details", { class: "group" },
      h("summary", { "data-i18n": "group.generator", text: t("group.generator") }),
      h("div", { class: "pair" }, res.el, skip.el), repeat.el, tx("gen.repeatHint", "hint"), repeatInside, notes,
    ),
  );

  syncs.push((s) => {
    const p = s.project;
    D.set(p.frame.diameterMm);
    pins.set(p.frame.pins);
    pinD.set(p.frame.pinDiameterMm);
    width.set(p.thread.widthMm);
    kind.set(THREAD_PRESETS.find((x) => x.widthMm === p.thread.widthMm)?.id ?? "custom");
    const rect = p.frame.shape === "rect", one = (v: number) => Number(v.toFixed(1));
    shape.set(p.frame.shape);
    // the same field is the diameter of a circle and the longer side of a rectangle
    const sizeLabel = D.el.querySelector("label");
    if (sizeLabel) { sizeLabel.dataset.i18n = rect ? "frame.longSide" : "frame.diameter"; sizeLabel.textContent = t(sizeLabel.dataset.i18n); }
    if (rect) {
      const size = frameSizeMm(p.frame), apart = pinSpacingMm(p.frame);
      spacing.textContent = t("frame.spacingRect", { w: Math.round(size.width), h: Math.round(size.height), gap: one(apart.along), nearest: one(apart.nearest) });
    } else {
      const gap = (Math.PI * p.frame.diameterMm) / p.frame.pins;
      spacing.textContent = t("frame.spacing", { gap: Number(gap.toFixed(1)), place: Number((gap / 2).toFixed(1)) });
    }
    // a picture that is not square loses its ends in a round frame: say how much is left, and offer the other frame
    const src = s.source, long = src ? Math.max(src.width, src.height) : 0, short = src ? Math.min(src.width, src.height) : 0;
    shapeAdvice.hidden = !(src && !src.sample && !rect && short > 0 && long / short >= NOT_SQUARE);
    if (!shapeAdvice.hidden) shapeNote.textContent = t("frame.notSquare", { w: src!.width, h: src!.height, percent: Math.round((100 * (Math.PI / 4) * short) / long) });
    // the pins inside the picture: how many were asked for, and how many stand (the worker places them with the
    // target, so until that has come there is nothing to say but that it is on its way)
    const asked = p.frame.inside ?? 0;
    inside.set(asked);
    insideNote.hidden = !asked;
    if (asked) {
      const placed = ctl.pinsFor(p).length / 2, gap = insideGapMm(p.frame.pinDiameterMm), ready = !!s.target && s.target.key === targetKey(p);
      insideNote.textContent = tooDenseForInside(p.frame, p.thread.widthMm) ? t("frame.insideDense", { gap: one(pinSpacingMm(p.frame).along) })
        : !ready && !placed ? t("run.preparing")
        : placed < asked ? t("frame.insideFewer", { n: placed, asked, gap })
        : t("frame.insidePlaced", { n: placed, gap });
    }
    const tuning = s.tune.status === "running", last = s.tune.last && s.tune.last.key === targetKey(p) ? s.tune.last : null;
    tune.hidden = tuning;
    tune.disabled = !ctl.canAutoAdjust();
    tuneStop.hidden = !tuning;
    tuneStatus.textContent = tuning ? (s.tune.total ? t("tune.progress", { done: s.tune.done, total: s.tune.total }) : t("run.preparing"))
      : last ? (last.changed ? t("tune.note", { before: last.before, after: last.after }) : t("tune.kept", { percent: last.after })) : "";
    tuneStatus.hidden = !tuneStatus.textContent;
    // of the picture before any adjustment, so the last target's is still right while a slider moves
    const share = s.target ? s.target.blank : 0;
    blank.hidden = !(share >= MOSTLY_BLANK && presetOf(p) === "mono-black");
    // with pins inside the picture a line no longer crosses the whole frame: the advice says what is left to gain
    if (!blank.hidden) blankNote.textContent = t(asked ? "tune.blankInside" : "tune.blank", { percent: Math.round(100 * share) });
    sparse.hidden = !(share >= MOSTLY_BLANK && !asked);
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
    edges.set(p.importance.edges);
    tone.set(p.importance.tone);
    // with pins inside the picture a pair of pins is drawn once whatever this says (D-60)
    repeat.set(p.generator.allowRepeat && !asked);
    repeat.input.disabled = !!asked;
    repeatInside.hidden = !asked;
    res.set(p.generator.res);
    res.input.max = String(Math.min(LIMITS.res[1], maxResolution(p.frame.diameterMm, p.thread.widthMm)));
    skip.set(p.generator.minSkip);
    skip.input.max = String(maxMinSkip(p.frame.pins, p.frame.shape));
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
