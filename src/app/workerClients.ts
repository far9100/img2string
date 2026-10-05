// The page's side of the preprocess, render and export workers: promises matched by id; where only the latest
// answer matters (the target while a slider moves, the render while the view changes), a ticket per slot makes
// older answers resolve to null.
import type { GamutSummary } from "../core/gamut.ts";
import type { Mode } from "../core/project.ts";
import type { Options } from "../core/stringart.ts";
import type { SampleId } from "../core/targets.ts";
import type { Region } from "../core/truewidth.ts";
import type { BuiltFile, ExportInput, ExportKind } from "../export/build.ts";
import type { FromExport, ToExport } from "../workers/exportProtocol.ts";
import type { CropRequest, FromPre, FromRender, TargetRequest, ToPre, ToRender } from "../workers/protocol.ts";

type Pending<T> = { resolve: (v: T) => void; reject: (e: Error) => void };

// ---------- preprocess

export interface TargetAnswer {
  res: number;
  target: Float64Array;
  weight: Float64Array;
  rgba: Uint8ClampedArray;
  weightRgba: Uint8ClampedArray;
  gamut: GamutSummary | null;
  gamutRgba: Uint8ClampedArray | null;
  /** How much of the unadjusted picture is like the bare board, 0..1. */
  blank: number;
}

/** The picture through a crop before any adjustment, and the importance map as painted. */
export interface CroppedPicture {
  res: number;
  picture: Float64Array;
  painted: Float64Array;
}

export interface PreprocessClient {
  setPicture(width: number, height: number, rgba: Uint8ClampedArray): Promise<void>;
  setSample(sample: SampleId): Promise<void>;
  /** Resolves to null when a newer request of the same slot has been made meanwhile. */
  target(request: TargetRequest, slot?: string): Promise<TargetAnswer | null>;
  /** The same for the unadjusted picture; its slots are apart from target()'s. */
  cropped(request: CropRequest, slot: string): Promise<CroppedPicture | null>;
}

export function createPreprocessClient(): PreprocessClient {
  const worker = new Worker(new URL("../workers/preprocess.worker.ts", import.meta.url), { type: "module", name: "preprocess" });
  const pending = new Map<number, Pending<FromPre>>();
  const tickets = new Map<string, number>();
  let nextId = 1;
  worker.onmessage = (e: MessageEvent<FromPre>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.t === "error") p.reject(new Error(`${e.data.code}: ${e.data.detail ?? ""}`));
    else p.resolve(e.data);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message));
    pending.clear();
  };
  const call = (msg: ToPre, transfer: Transferable[] = []) => new Promise<FromPre>((resolve, reject) => {
    pending.set(msg.id, { resolve, reject });
    worker.postMessage(msg, transfer);
  });
  return {
    async setPicture(width, height, rgba) {
      await call({ t: "picture", id: nextId++, width, height, rgba }, [rgba.buffer]);
    },
    async setSample(sample) {
      await call({ t: "sample", id: nextId++, sample });
    },
    async target(request, slot = "main") {
      const ticket = (tickets.get(slot) ?? 0) + 1;
      tickets.set(slot, ticket);
      const m = await call({ t: "target", id: nextId++, ticket, request });
      if (m.t !== "target" || tickets.get(slot) !== ticket) return null;
      return { res: m.res, target: m.target, weight: m.weight, rgba: m.rgba, weightRgba: m.weightRgba, gamut: m.gamut, gamutRgba: m.gamutRgba, blank: m.blank };
    },
    async cropped(request, slot) {
      const name = `crop:${slot}`, ticket = (tickets.get(name) ?? 0) + 1;
      tickets.set(name, ticket);
      const m = await call({ t: "crop", id: nextId++, ticket, request });
      if (m.t !== "cropped" || tickets.get(name) !== ticket) return null;
      return { res: m.res, picture: m.picture, painted: m.painted };
    },
  };
}

// ---------- render

export interface RenderedImage { width: number; height: number; rgba: Uint8ClampedArray }

/** What a piece is compared with: the unadjusted picture, and how the reference picture is made from it. */
export interface MeasureOriginal {
  picture: Float64Array;
  painted: Float64Array;
  mode: Mode;
  invert: boolean;
}

export interface RenderClient {
  render(slot: string, options: Options, sequences: number[][], width: number, height: number, region: Region | null, sigmaMm: number): Promise<RenderedImage | null>;
  /** `similarity` is null when no `original` was given. */
  measure(options: Options, sequences: number[][], target: Float64Array, weight: Float64Array, original: MeasureOriginal | null): Promise<{ errorReduction: number; deltaE: number; similarity: number | null } | null>;
}

export function createRenderClient(): RenderClient {
  let worker: Worker | null = null;
  const pending = new Map<number, Pending<FromRender>>();
  const tickets = new Map<string, number>();
  let nextId = 1;
  const boot = () => {
    const w = new Worker(new URL("../workers/render.worker.ts", import.meta.url), { type: "module", name: "render" });
    w.onmessage = (e: MessageEvent<FromRender>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.t === "error") p.reject(new Error(`${e.data.code}: ${e.data.detail ?? ""}`));
      else p.resolve(e.data);
    };
    w.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message));
      pending.clear();
    };
    return w;
  };
  const call = (msg: ToRender, transfer: Transferable[] = []) => new Promise<FromRender>((resolve, reject) => {
    worker ??= boot();
    pending.set(msg.id, { resolve, reject });
    worker.postMessage(msg, transfer);
  });
  const ticketOf = (slot: string) => {
    const ticket = (tickets.get(slot) ?? 0) + 1;
    tickets.set(slot, ticket);
    return ticket;
  };
  return {
    async render(slot, options, sequences, width, height, region, sigmaMm) {
      const ticket = ticketOf(slot);
      const m = await call({ t: "render", id: nextId++, ticket, options, sequences, width, height, region, sigmaMm });
      if (m.t !== "image" || tickets.get(slot) !== ticket) return null;
      return { width: m.width, height: m.height, rgba: m.rgba };
    },
    async measure(options, sequences, target, weight, original) {
      const ticket = ticketOf("measure"), t = target.slice(), w = weight.slice();
      // the page keeps its own arrays: the worker gets copies
      const from = original && { ...original, picture: original.picture.slice(), painted: original.painted.slice() };
      const m = await call({ t: "measure", id: nextId++, ticket, options, sequences, target: t, weight: w, original: from }, from ? [t.buffer, w.buffer, from.picture.buffer, from.painted.buffer] : [t.buffer, w.buffer]);
      if (m.t !== "measured" || tickets.get("measure") !== ticket) return null;
      return { errorReduction: m.errorReduction, deltaE: m.deltaE, similarity: m.similarity };
    },
  };
}

// ---------- export (the worker, pdf-lib and the font load on the first download)

export interface ExportClient {
  build(kind: ExportKind, input: ExportInput): Promise<BuiltFile>;
}

export function createExportClient(): ExportClient {
  let worker: Worker | null = null;
  const pending = new Map<number, Pending<BuiltFile>>();
  let nextId = 1;
  return {
    build(kind, input) {
      if (!worker) {
        worker = new Worker(new URL("../workers/export.worker.ts", import.meta.url), { type: "module", name: "export" });
        worker.onmessage = (e: MessageEvent<FromExport>) => {
          const p = pending.get(e.data.id);
          if (!p) return;
          pending.delete(e.data.id);
          if (e.data.t === "file") p.resolve({ name: e.data.name, mime: e.data.mime, bytes: e.data.bytes });
          else p.reject(new Error(e.data.detail));
        };
        worker.onerror = (e) => {
          for (const p of pending.values()) p.reject(new Error(e.message));
          pending.clear();
        };
      }
      const id = nextId++;
      return new Promise<BuiltFile>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker!.postMessage({ t: "build", id, input, kind } satisfies ToExport);
      });
    },
  };
}
