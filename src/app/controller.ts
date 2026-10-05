// Actions and effects of the page: the store and the workers are owned here; the panels only call methods and
// read state (after img2shadow's and img2fold's controllers).
import { autoAdjust, tuningOf, tuningProxy, withTuning, type TuneInput } from "../core/autoAdjust.ts";
import { replayModel } from "../core/greedy.ts";
import { hueName } from "../core/gamut.ts";
import { toRgba8 } from "../core/image.ts";
import { errorReduction, meanDeltaE, meanDeltaEFlat } from "../core/metrics.ts";
import {
  applyPreset, defaultOrder, freeCandidates, ORDER_SEARCH_MAX, ORDER_SEARCH_VERIFY, paletteWarnings, permutations, pickPalette, placeByLightness, presetById, proxyOptions, reorder, toHex,
} from "../core/palette.ts";
import {
  generationKey, LIMITS, modeDefaults, normalizeProject, serializeProject, targetKey, toOptions,
  type Crop, type Mode, type Project, type Result, type Stroke, type ThreadSpec,
} from "../core/project.ts";
import { circleMask, hexToLinear, type Options } from "../core/stringart.ts";
import type { SampleId } from "../core/targets.ts";
import type { Region } from "../core/truewidth.ts";
import type { BuiltFile, ExportKind } from "../export/build.ts";
import { FILE, stemOf } from "../export/names.ts";
import { encodePng } from "../export/png.ts";
import { getLang, t, type Vars } from "../i18n/translate.ts";
import { buildPlan, clampPosition, planKey, progressStorageKey } from "../player/player.ts";
import type { CropRequest, TargetRequest } from "../workers/protocol.ts";
import { createGenerateClient, GenerateError, generateWorker, type Finished } from "./generateClient.ts";
import { dataUrlToBlob, decodePicture, readAsDataUrl, sha256, SMALL_SIDE } from "./imageClient.ts";
import { defaultPoolSize, ScorePool, type ScoreJob } from "./orderPool.ts";
import { initialState, type AppState, type OrderScore, type ResultView, type TuneState } from "./state.ts";
import { createStore, type Path, type Store } from "./store.ts";
import { addToShelf, loadShelf, removeFromShelf, storeShelf } from "./threadShelf.ts";
import { createExportClient, createPreprocessClient, createRenderClient, type RenderedImage } from "./workerClients.ts";

export type Notify = (key: string, vars?: Vars, kind?: "error" | "") => void;

export class Controller {
  readonly store: Store<AppState> = createStore(initialState());
  notify: Notify = () => {};

  private readonly pre = createPreprocessClient();
  private readonly gen = createGenerateClient(generateWorker);
  private readonly renderer = createRenderClient();
  private readonly exporter = createExportClient();
  private pool: ScorePool | null = null;
  /** The opened file, for embedding it in the project. */
  private file: Blob | null = null;
  private targetInFlight = false;
  private targetDirty = false;
  private openTicket = 0;
  /** Counts the automatic adjustments: one that was stopped must not go on when the next has begun. */
  private tuneTicket = 0;

  get state(): AppState {
    return this.store.get();
  }

  // ---------- project edits

  /** Every change of the project goes through here: clamped, checked, and the target refreshed. */
  commit(next: Project): void {
    const { project, issues } = normalizeProject({ ...next, result: null });
    const made = this.state.made;
    project.result = made?.result && made.result.key === generationKey(project) ? made.result : null;
    this.store.update((s) => ({ ...s, project, issues: [...new Set([...issues, ...paletteWarnings(project)])] }));
    this.scheduleTarget();
  }

  set(path: Path, value: unknown): void {
    let next: unknown = this.state.project;
    const walk = (obj: unknown, i: number): unknown => {
      if (i === path.length) return value;
      const key = path[i]!;
      if (Array.isArray(obj)) { const copy = obj.slice(); copy[key as number] = walk(obj[key as number], i + 1); return copy; }
      return { ...(obj as object), [key]: walk((obj as Record<string | number, unknown>)[key], i + 1) };
    };
    next = walk(next, 0);
    this.commit(next as Project);
  }

  setCrop(patch: Partial<Crop>): void {
    const p = this.state.project;
    this.commit({ ...p, image: { ...p.image, crop: { ...p.image.crop, ...patch } } });
  }

  setMode(mode: Mode): void {
    const p = this.state.project;
    if (p.mode === mode) return;
    const preset = presetById(mode === "mono" ? "mono-black" : "colour-cmyk")!;
    this.commit(applyPreset(p, preset, (key) => t(key)));
  }

  applyPreset(id: string): void {
    const preset = presetById(id);
    if (preset) this.commit(applyPreset(this.state.project, preset, (key) => t(key)));
  }

  setThread(index: number, patch: Partial<ThreadSpec>): void {
    const p = this.state.project;
    this.commit({ ...p, threads: p.threads.map((th, i) => (i === index ? { ...th, ...patch } : th)) });
  }

  addThread(): void {
    const p = this.state.project;
    if (p.threads.length >= LIMITS.threads) return;
    const taken = new Set(p.threads.map((th) => th.hex));
    const hex = ["#D7261E", "#1F4FD1", "#1E9E3E", "#FFE000", "#F2F2F2", "#111111"].find((h) => !taken.has(h)) ?? "#808080";
    const budget = p.threads[p.threads.length - 1]?.maxLines ?? modeDefaults(p.mode).maxLines;
    this.commit({ ...p, threads: [...p.threads, { name: t("thread.custom", { n: p.threads.length + 1 }), hex, maxLines: budget }] });
  }

  removeThread(index: number): void {
    const p = this.state.project;
    if (p.threads.length <= 1) return;
    this.commit({ ...p, threads: p.threads.filter((_, i) => i !== index) });
  }

  /** Moves a thread one place down (-1: wound earlier) or up (+1: wound later) in the winding order. */
  moveThread(index: number, by: -1 | 1): void {
    const p = this.state.project, j = index + by;
    if (j < 0 || j >= p.threads.length) return;
    const threads = p.threads.slice();
    [threads[index], threads[j]] = [threads[j]!, threads[index]!];
    this.commit({ ...p, threads });
  }

  placeThread(from: number, to: number): void {
    const p = this.state.project;
    if (from === to || from < 0 || to < 0 || from >= p.threads.length || to >= p.threads.length) return;
    const threads = p.threads.slice(), [moved] = threads.splice(from, 1);
    threads.splice(to, 0, moved!);
    this.commit({ ...p, threads });
  }

  // ---------- the user's own thread colours (§6.3)

  loadShelf(): void {
    this.store.update((s) => ({ ...s, shelf: loadShelf() }));
  }

  /** Keeps a thread of the palette (its colour and name) in the personal list. */
  shelveThread(index: number): void {
    const thread = this.state.project.threads[index];
    if (!thread) return;
    const shelf = addToShelf(this.state.shelf, { name: thread.name, hex: thread.hex });
    storeShelf(shelf);
    this.store.update((s) => ({ ...s, shelf }));
    this.notify("shelf.saved", { name: thread.name || thread.hex });
  }

  unshelve(index: number): void {
    const shelf = removeFromShelf(this.state.shelf, index);
    storeShelf(shelf);
    this.store.update((s) => ({ ...s, shelf }));
  }

  /** Adds a thread from the personal list to the palette, wound last. */
  useShelved(index: number): void {
    const entry = this.state.shelf[index], p = this.state.project;
    if (!entry) return;
    if (p.threads.length >= LIMITS.threads) { this.notify("issue.threads-count"); return; }
    const budget = p.threads[p.threads.length - 1]?.maxLines ?? modeDefaults(p.mode).maxLines;
    this.commit({ ...p, threads: [...p.threads, { name: entry.name || t("thread.custom", { n: p.threads.length + 1 }), hex: entry.hex, maxLines: budget }] });
  }

  /** §6.3's default order: lightest first, darkest last. */
  sortThreads(): void {
    const p = this.state.project;
    this.commit({ ...p, threads: defaultOrder(p.threads) });
  }

  // ---------- threads for the picture (§6.3, M2)

  /** The gamut check of the current settings, or null while it is not known (or in mono mode). */
  private gamut() {
    const s = this.state;
    return s.project.mode === "colour" && s.target && s.target.key === targetKey(s.project) ? s.target.gamut : null;
  }

  canAddSuggested(): boolean {
    return !!this.gamut()?.suggestion && this.state.project.threads.length < LIMITS.threads;
  }

  /** Adds a thread of the colour the gamut check found missing most, where its lightness puts it in the
   * winding order. */
  addSuggestedThread(): void {
    const colour = this.gamut()?.suggestion, p = this.state.project;
    if (!colour || !this.canAddSuggested()) return;
    const hex = toHex(colour), threads = p.threads.slice();
    const budget = p.threads[p.threads.length - 1]?.maxLines ?? modeDefaults(p.mode).maxLines;
    threads.splice(placeByLightness(threads, hex), 0, { name: t(`hue.${hueName(colour)}`), hex, maxLines: budget });
    this.commit({ ...p, threads });
  }

  canAutoPalette(source: "free" | "shelf"): boolean {
    return !!this.gamut() && (source === "free" || this.state.shelf.length > 0);
  }

  /** §6.3 "auto palette": replaces the threads by up to `count` colours chosen for the picture, from the
   * user's own thread colours or freely. */
  autoPalette(count: number, source: "free" | "shelf"): void {
    const gamut = this.gamut(), s = this.state, p = s.project;
    if (!gamut || !this.canAutoPalette(source)) return;
    const picked = pickPalette(gamut, p.board, source === "shelf" ? s.shelf : freeCandidates(gamut), Math.min(LIMITS.threads, count));
    if (!picked.length) { this.notify("auto.none"); return; }
    const budget = p.threads[0]?.maxLines ?? modeDefaults(p.mode).maxLines;
    this.commit({ ...p, threads: picked.map((c) => ({ name: c.name || t(`hue.${hueName(hexToLinear(c.hex))}`), hex: c.hex, maxLines: budget })) });
    this.notify("auto.done", { n: picked.length });
  }

  addStroke(stroke: Stroke): void {
    const p = this.state.project;
    if (p.importance.strokes.length >= LIMITS.strokes) return;
    this.commit({ ...p, importance: { ...p.importance, strokes: [...p.importance.strokes, stroke] } });
  }

  undoStroke(): void {
    const p = this.state.project;
    this.commit({ ...p, importance: { ...p.importance, strokes: p.importance.strokes.slice(0, -1) } });
  }

  clearStrokes(): void {
    const p = this.state.project;
    this.commit({ ...p, importance: { ...p.importance, strokes: [] } });
  }

  setView(patch: Partial<AppState["view"]>): void {
    this.store.update((s) => ({ ...s, view: { ...s.view, ...patch } }));
  }

  /** Puts back the settings the shown result was generated with. */
  restoreMade(): void {
    const made = this.state.made;
    if (made) this.commit({ ...made, player: this.state.project.player, paper: this.state.project.paper });
  }

  // ---------- pictures

  private setSource(source: AppState["source"]): void {
    const old = this.state.source?.url;
    if (old && old !== source?.url) URL.revokeObjectURL(old);
    this.store.update((s) => ({ ...s, source, pictureMissing: false, target: null }));
  }

  async openSample(sample: SampleId): Promise<void> {
    const ticket = ++this.openTicket;
    await this.pre.setSample(sample);
    if (ticket !== this.openTicket) return;
    this.file = null;
    const p = this.state.project, res = p.generator.res;
    this.setSource({ name: `sample-${sample}`, width: res, height: res, sha256: `sample:${sample}`, sample, url: null });
    this.commit({
      ...p,
      image: { name: `sample-${sample}`, sha256: `sample:${sample}`, sample, width: res, height: res, crop: { cx: 0.5, cy: 0.5, scale: 1, rotateDeg: 0 }, embedded: null },
      importance: { ...p.importance, strokes: [] },
    });
  }

  async openFile(file: File): Promise<void> {
    const ticket = ++this.openTicket;
    let decoded, hash: string;
    try {
      decoded = await decodePicture(file);
      hash = await sha256(await file.arrayBuffer());
    } catch {
      this.notify("error.decode", { name: file.name }, "error");
      return;
    }
    if (ticket !== this.openTicket) return;
    const { width, height } = decoded;
    await this.pre.setPicture(width, height, decoded.rgba);
    if (ticket !== this.openTicket) return;
    this.file = file;
    const p = this.state.project;
    // the picture a project was saved with: its crop and brush strokes still apply
    const same = this.state.pictureMissing && p.image.sha256 === hash;
    if (this.state.pictureMissing && !same) this.notify("picture.different", { name: p.image.name });
    this.setSource({ name: file.name, width, height, sha256: hash, sample: null, url: URL.createObjectURL(file) });
    if (Math.min(width, height) < SMALL_SIDE) this.notify("picture.small", { w: width, h: height });
    this.commit({
      ...p,
      image: { name: file.name, sha256: hash, sample: null, width, height, crop: same ? p.image.crop : { cx: 0.5, cy: 0.5, scale: 1, rotateDeg: 0 }, embedded: null },
      importance: same ? p.importance : { ...p.importance, strokes: [] },
    });
    if (!same) this.setView({ tab: "target" });
  }

  /** Embeds the opened picture in the project file, or takes it out again (§11). */
  async embedPicture(on: boolean): Promise<void> {
    const embedded = on && this.file ? await readAsDataUrl(this.file) : null;
    const p = this.state.project;
    this.store.update((s) => ({ ...s, project: { ...p, image: { ...p.image, embedded } }, made: s.made && { ...s.made, image: { ...s.made.image, embedded } } }));
  }

  // ---------- the target and the importance map

  /** `gamut`: also check the colours (§6.3); only a colour picture has colours a palette can miss. */
  private request(p: Project, res: number, gamut = p.mode === "colour"): TargetRequest {
    return {
      res, crop: p.image.crop, adjust: p.adjust, mode: p.mode, board: hexToLinear(p.board), threads: p.threads.map((th) => hexToLinear(th.hex)),
      preset: p.importance.preset, strokes: p.importance.strokes, edges: p.importance.edges, tone: p.importance.tone, gamut,
    };
  }

  /** The picture as it is, at `res`: for the automatic adjustment and the similarity number. */
  private cropRequest(p: Project, res: number): CropRequest {
    return { res, crop: p.image.crop, board: hexToLinear(p.board), preset: p.importance.preset, strokes: p.importance.strokes };
  }

  private scheduleTarget(): void {
    const s = this.state;
    if (!s.source || s.pictureMissing) return;
    if (s.target?.key === targetKey(s.project)) {
      if (s.targetBusy) this.store.update((x) => ({ ...x, targetBusy: false }));
      return;
    }
    if (this.targetInFlight) { this.targetDirty = true; return; }
    this.targetInFlight = true;
    this.store.update((x) => ({ ...x, targetBusy: true }));
    const project = s.project, key = targetKey(project);
    void this.pre.target(this.request(project, project.generator.res)).then(
      (answer) => {
        this.targetInFlight = false;
        if (answer) this.store.update((x) => ({ ...x, target: { key, ...answer }, targetBusy: false }));
        if (this.targetDirty || targetKey(this.state.project) !== key) { this.targetDirty = false; this.scheduleTarget(); }
        else this.afterTarget();
      },
      () => {
        this.targetInFlight = false;
        this.store.update((x) => ({ ...x, targetBusy: false }));
        this.notify("error.internal", {}, "error");
      },
    );
  }

  /** With a fresh target: a result that was opened from a file gets its numbers (they need the picture). */
  private afterTarget(): void {
    const s = this.state;
    if (!s.made?.result || !s.target || s.target.key !== targetKey(s.made)) return;
    if (s.result?.deltaE) return;
    this.showMade(s.made, null);
    this.measure(s.made);
  }

  // ---------- generation

  canGenerate(): boolean {
    const s = this.state;
    return s.run.status === "idle" && !!s.target && s.target.key === targetKey(s.project);
  }

  /** A stopped result whose settings still hold can be continued (§14). */
  canContinue(): boolean {
    const s = this.state;
    return this.canGenerate() && s.project.result?.reason === "stopped";
  }

  async generate(resume = false): Promise<void> {
    const s = this.state;
    if (!this.canGenerate() || !s.target) return;
    const project = s.project, options = toOptions(project), key = generationKey(project);
    const from = resume && this.canContinue() ? project.result!.sequences : null;
    this.store.update((x) => ({ ...x, run: { status: "running", lines: options.threads.map(() => 0), error: 0, initialError: 0, rgba: null, res: options.res }, view: { ...x.view, tab: "result", player: false } }));
    let finished: Finished;
    try {
      finished = await this.gen.start(options, s.target.target, s.target.weight, from, (p) => {
        this.store.update((x) => ({ ...x, run: { ...x.run, lines: p.lines, error: p.error, initialError: p.initialError, rgba: p.rgba ?? x.run.rgba } }));
      });
    } catch (err) {
      this.store.update((x) => ({ ...x, run: { ...x.run, status: "idle" } }));
      this.notify(err instanceof GenerateError && err.code === "settings" ? "error.settings" : "error.internal", {}, "error");
      return;
    }
    const lines = finished.sequences.map((q) => Math.max(0, q.length - 1));
    const result: Result = {
      key, sequences: finished.sequences, lines, errorReduction: errorReduction(finished.error, finished.initialError),
      meanDeltaEOk: finished.deltaE?.[1] ?? 0, reason: finished.reason,
    };
    const made: Project = { ...project, result, player: { ...project.player, step: 0 } };
    this.store.update((x) => ({ ...x, run: { ...x.run, status: "idle" }, made, result: null }));
    this.showMade(made, finished);
    this.commit(this.state.project); // attaches the result if the settings are still the ones it was made with
    if (finished.reason === "empty") this.notify("run.empty");
    this.measure(made);
  }

  stop(): void {
    if (this.state.run.status !== "running") return;
    this.store.update((s) => ({ ...s, run: { ...s.run, status: "stopping" } }));
    this.gen.stop();
  }

  /** The model's picture and numbers of a made piece: from the worker's last message, or by winding its
   * sequences into a fresh model (a result opened from a file, or a run whose worker had to be replaced). */
  private showMade(made: Project, finished: Finished | null): void {
    const result = made.result!, o = toOptions(made), s = this.state;
    const target = s.target && s.target.key === targetKey(made) ? s.target : null;
    let rgba = finished?.rgba ?? null, deltaE = finished?.deltaE ?? null;
    if (!rgba || (!deltaE && target)) {
      const px = o.res * o.res;
      const model = replayModel(o, target?.target ?? new Float64Array(3 * px), target?.weight ?? circleMask(o.res), result.sequences);
      rgba = toRgba8(model.C, px);
      if (target) {
        const mask = circleMask(o.res);
        deltaE = [meanDeltaEFlat(o.board, target.target, mask), meanDeltaE(model.C, target.target, mask)];
      }
    }
    const view: ResultView = {
      res: o.res, rgba, deltaE, reason: result.reason, unstarted: finished?.unstarted ?? [], budgetBlocked: finished?.budgetBlocked ?? [], ms: finished?.ms ?? 0,
      trueReduction: null, trueDeltaE: null, similarity: null,
    };
    // where the user left off winding this piece (§7.4)
    let step = made.player.step;
    try {
      const saved = Number(localStorage.getItem(progressStorageKey(planKey(result.sequences, made.frame.pins))));
      if (Number.isFinite(saved) && saved > 0) step = saved;
    } catch { /* storage may be blocked */ }
    const total = buildPlan(result.sequences, made.frame.pins);
    this.store.update((x) => ({ ...x, made: { ...made, player: { ...made.player, step: clampPosition(total, step) } }, result: view }));
  }

  /** The error numbers on the true-width render (DECISIONS D-10) and how close it is to the picture before
   * any adjustment (D-54); needs the target the piece was made from. */
  private measure(made: Project): void {
    const s = this.state, target = s.target, result = made.result;
    if (!target || target.key !== targetKey(made) || !result || !result.lines.some((n) => n > 0)) return;
    const o = toOptions(made);
    void this.pre.cropped(this.cropRequest(made, o.res), "measure").catch(() => null).then((cropped) => {
      // the unadjusted picture counts only if it is still the picture this piece was made from
      const original = cropped && this.state.target === target ? { picture: cropped.picture, painted: cropped.painted, mode: made.mode, invert: made.adjust.invert } : null;
      return this.renderer.measure(o, result.sequences, target.target, target.weight, original);
    }).then((m) => {
      if (!m || this.state.made?.result !== result) return;
      this.store.update((x) => (x.result ? { ...x, result: { ...x.result, trueReduction: m.errorReduction, trueDeltaE: m.deltaE, similarity: m.similarity } } : x));
    }, () => undefined);
  }

  /** The made piece at true thread width, for the view and the magnifier. */
  renderTrue(slot: string, width: number, height: number, region: Region | null, sigmaMm: number): Promise<RenderedImage | null> {
    const made = this.state.made;
    if (!made?.result) return Promise.resolve(null);
    return this.renderer.render(slot, toOptions(made), made.result.sequences, width, height, region, sigmaMm).catch(() => null);
  }

  // ---------- the winding-order search (§6.3)

  canSearchOrder(): boolean {
    const n = this.state.project.threads.length;
    return this.canGenerate() && this.state.order.status === "idle" && this.state.tune.status === "idle" && n >= 2 && n <= ORDER_SEARCH_MAX;
  }

  async searchOrder(): Promise<void> {
    const s = this.state;
    if (!this.canSearchOrder() || !s.target) return;
    const project = s.project, o = toOptions(project), proxy = proxyOptions(o), orders = permutations(o.threads.length);
    const hexes = project.threads.map((th) => th.hex);
    const total = orders.length + Math.min(ORDER_SEARCH_VERIFY, orders.length);
    this.store.update((x) => ({ ...x, order: { status: "running", done: 0, total, scores: null, hexes } }));
    const finish = (scores: OrderScore[] | null) => this.store.update((x) => ({ ...x, order: { status: "idle", done: 0, total: 0, scores, hexes } }));
    try {
      const small = await this.pre.target(this.request(project, proxy.res, false), "order");
      if (!small || this.state.order.status !== "running") return finish(null);
      this.pool ??= new ScorePool(generateWorker, defaultPoolSize(navigator.hardwareConcurrency));
      const tick = () => this.store.update((x) => (x.order.status === "running" ? { ...x, order: { ...x.order, done: x.order.done + 1 } } : x));
      const reduction = (score: { error: number; initialError: number } | null) => (score ? errorReduction(score.error, score.initialError) : -Infinity);
      const quick = await this.pool.run(orders.map((order): ScoreJob => ({ options: reorder(proxy, order), target: small.target, weight: small.weight })), tick);
      if (this.state.order.status !== "running") return finish(null);
      const scores: OrderScore[] = orders.map((order, i) => ({ order, proxy: reduction(quick[i]!), full: null }));
      const best = scores.slice().sort((a, b) => b.proxy - a.proxy).slice(0, ORDER_SEARCH_VERIFY);
      const full = await this.pool.run(best.map((b): ScoreJob => ({ options: reorder(o, b.order), target: s.target!.target, weight: s.target!.weight })), tick);
      if (this.state.order.status !== "running") return finish(null);
      best.forEach((b, i) => { b.full = reduction(full[i]!); });
      const winner = best.reduce((a, b) => ((b.full ?? -Infinity) > (a.full ?? -Infinity) ? b : a));
      scores.sort((a, b) => (b.full ?? -1) - (a.full ?? -1) || b.proxy - a.proxy);
      finish(scores);
      const now = this.state.project;
      if (generationKey(now) !== generationKey(project)) return; // the settings changed meanwhile: only show the scores
      if (winner.order.some((v, i) => v !== i)) {
        this.commit({ ...now, threads: winner.order.map((i) => now.threads[i]!) });
        this.notify("order.changed", { percent: Number((100 * (winner.full ?? 0)).toFixed(1)) });
      } else this.notify("order.kept", { percent: Number((100 * (winner.full ?? 0)).toFixed(1)) });
    } catch {
      finish(null);
      this.notify("error.internal", {}, "error");
    }
  }

  stopOrderSearch(): void {
    if (this.state.order.status !== "running") return;
    this.store.update((x) => ({ ...x, order: { ...x.order, status: "idle" } }));
    this.pool?.stop();
  }

  // ---------- the automatic adjustment (DECISIONS D-55)

  canAutoAdjust(): boolean {
    return this.canGenerate() && this.state.order.status === "idle" && this.state.tune.status === "idle";
  }

  /**
   * Sets the adjustment sliders and the automatic emphasis to the values whose piece comes closest to the
   * picture: a search on a quick set-up, then its best few and the current values at the real settings. The
   * result is only generated when the user asks for it, like after every other change (D-31).
   */
  async autoAdjust(): Promise<void> {
    const s = this.state;
    if (!this.canAutoAdjust()) return;
    const project = s.project, o = toOptions(project), small = tuningProxy(o), quick = small !== o, key = generationKey(project);
    const ticket = ++this.tuneTicket, alive = () => this.tuneTicket === ticket;
    const end = (last: TuneState["last"]) => { if (alive()) this.store.update((x) => ({ ...x, tune: { status: "idle", done: 0, total: 0, last } })); };
    const percent = (v: number) => Math.round(100 * Math.min(1, Math.max(0, v)));
    this.store.update((x) => ({ ...x, tune: { status: "running", done: 0, total: 0, last: null } }));
    try {
      const [real, proxy] = await Promise.all([this.pre.cropped(this.cropRequest(project, o.res), "tune"), quick ? this.pre.cropped(this.cropRequest(project, small.res), "tune-quick") : null]);
      if (!real || (quick && !proxy) || !alive()) return end(null);
      const pool = (this.pool ??= new ScorePool(generateWorker, defaultPoolSize(navigator.hardwareConcurrency)));
      let base = 0;
      const found = await autoAdjust(project.mode, tuningOf(project), quick, async (jobs) => {
        if (!alive()) return null;
        const inputs = jobs.map((job): TuneInput => {
          const from = job.real ? real : proxy!;
          return { options: job.real ? o : small, mode: project.mode, picture: from.picture, painted: from.painted, invert: project.adjust.invert, tuning: job.tuning };
        });
        const tuned = await pool.tune(inputs, (_index, _tuned, n) => { if (alive()) this.store.update((x) => ({ ...x, tune: { ...x.tune, done: Math.min(x.tune.total, base + n) } })); });
        return alive() ? tuned.map((t) => (t ? t.similarity : null)) : null;
      }, (done, total) => {
        base = done;
        if (alive()) this.store.update((x) => ({ ...x, tune: { ...x.tune, done, total } }));
      });
      if (!found || !alive()) return;
      const now = this.state.project;
      if (generationKey(now) !== key) { // the settings changed meanwhile: what was found belongs to the old ones
        end(null);
        this.notify("tune.moved");
        return;
      }
      if (found.changed) this.commit(withTuning(now, found.tuning));
      end({ key: targetKey(this.state.project), before: percent(found.before), after: percent(found.after), changed: found.changed });
      if (found.changed) this.notify("tune.changed", { before: percent(found.before), after: percent(found.after) });
      else this.notify("tune.kept", { percent: percent(found.after) });
    } catch {
      if (!alive()) return;
      end(null);
      this.notify("error.internal", {}, "error");
    }
  }

  stopAutoAdjust(): void {
    if (this.state.tune.status !== "running") return;
    this.tuneTicket++;
    this.store.update((x) => ({ ...x, tune: { status: "idle", done: 0, total: 0, last: null } }));
    this.pool?.stop();
  }

  // ---------- files

  /** The project as text. An out-of-date piece is saved with the settings it was made from, so the file is
   * always one consistent piece (DECISIONS D-31); `stale` tells the caller to say so. */
  projectText(): { text: string; name: string; stale: boolean } {
    const s = this.state, stale = !!s.made && !s.project.result;
    const project = stale ? { ...s.made!, paper: s.project.paper } : { ...s.project, player: s.made?.player ?? s.project.player };
    return { text: serializeProject(project), name: FILE.project(stemOf(project.image.name)), stale };
  }

  async loadProject(text: string): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      this.notify("error.project", {}, "error");
      return;
    }
    if (raw === null || typeof raw !== "object" || !("threads" in raw || "frame" in raw || "image" in raw)) {
      this.notify("error.project", {}, "error");
      return;
    }
    const ticket = ++this.openTicket;
    const { project, issues } = normalizeProject(raw);
    const made = project.result ? { ...project } : null;
    // a stored result is shown as stored even when its key no longer matches these settings
    if (made?.result) made.result = { ...made.result, key: generationKey(project) };
    if (project.result) project.result = made!.result;
    this.file = null;
    const old = this.state.source?.url;
    if (old) URL.revokeObjectURL(old);
    this.store.update((s) => ({ ...s, project, made, result: null, source: null, target: null, pictureMissing: true, issues: [...issues, ...paletteWarnings(project)], order: { ...s.order, scores: null }, view: { ...s.view, tab: made ? "result" : "target", player: false } }));
    for (const code of issues) if (code === "project-version" || code === "result" || code === "brush-png") this.notify(`issue.${code}`);

    const image = project.image;
    if (image.sample) {
      await this.pre.setSample(image.sample);
      if (ticket !== this.openTicket) return;
      this.store.update((s) => ({ ...s, pictureMissing: false, source: { name: image.name, width: image.width, height: image.height, sha256: image.sha256, sample: image.sample, url: null } }));
      this.scheduleTarget();
    } else if (image.embedded) {
      const blob = dataUrlToBlob(image.embedded);
      try {
        const decoded = await decodePicture(blob!);
        await this.pre.setPicture(decoded.width, decoded.height, decoded.rgba);
        if (ticket !== this.openTicket) return;
        this.file = blob;
        this.store.update((s) => ({ ...s, pictureMissing: false, source: { name: image.name, width: decoded.width, height: decoded.height, sha256: image.sha256, sample: null, url: URL.createObjectURL(blob!) } }));
        this.scheduleTarget();
      } catch {
        this.notify("picture.missing", { name: image.name });
      }
    } else if (made) {
      this.showMade(made, null);
      this.notify("picture.missing", { name: image.name });
    } else this.notify("picture.missing", { name: image.name });
    if (made && !this.state.result) this.showMade(made, null);
  }

  async exportFile(kind: ExportKind): Promise<BuiltFile | null> {
    const s = this.state;
    // the template belongs to the current frame; everything else to the made piece
    const project = kind.startsWith("template") ? s.project : s.made;
    if (!project) return null;
    this.store.update((x) => ({ ...x, busyExport: true }));
    try {
      return await this.exporter.build(kind, { project, lang: getLang(), stem: stemOf(project.image.name) });
    } catch {
      this.notify("error.export", {}, "error");
      return null;
    } finally {
      this.store.update((x) => ({ ...x, busyExport: false }));
    }
  }

  /** The made piece at true thread width as a PNG (§7.6), `size` pixels across. */
  async exportPreview(size = 2000): Promise<BuiltFile | null> {
    const made = this.state.made;
    if (!made?.result) return null;
    this.store.update((x) => ({ ...x, busyExport: true }));
    try {
      const img = await this.renderer.render("export", toOptions(made), made.result.sequences, size, size, null, 0);
      if (!img) return null;
      const mmPerPixel = (made.frame.diameterMm * made.generator.res) / (made.generator.res - 1) / size;
      return { name: FILE.preview(stemOf(made.image.name)), mime: "image/png", bytes: encodePng(new Uint8Array(img.rgba.buffer), size, size, 4, { pixelMm: mmPerPixel }) };
    } catch {
      this.notify("error.export", {}, "error");
      return null;
    } finally {
      this.store.update((x) => ({ ...x, busyExport: false }));
    }
  }

  // ---------- the winding player (§7.4)

  setPlayerStep(step: number): void {
    const made = this.state.made;
    if (!made?.result) return;
    const total = made.result.lines.reduce((a, n) => a + n, 0), next = Math.max(0, Math.min(total, Math.round(Number.isFinite(step) ? step : 0)));
    this.store.update((s) => ({ ...s, made: s.made && { ...s.made, player: { ...s.made.player, step: next } } }));
    try {
      localStorage.setItem(progressStorageKey(planKey(made.result.sequences, made.frame.pins)), String(next));
    } catch { /* storage may be blocked */ }
  }

  setSecondsPerLine(seconds: number): void {
    const v = Math.min(LIMITS.secondsPerLine[1], Math.max(LIMITS.secondsPerLine[0], seconds));
    this.store.update((s) => ({ ...s, project: { ...s.project, player: { ...s.project.player, secondsPerLine: v } }, made: s.made && { ...s.made, player: { ...s.made.player, secondsPerLine: v } } }));
  }

  /** The options of the made piece (for views that draw its lines). */
  madeOptions(): Options | null {
    const made = this.state.made;
    return made ? toOptions(made) : null;
  }
}
