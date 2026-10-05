/// <reference lib="webworker" />
// The render worker: the piece at true thread width (spec §7.1), rasterised with typed arrays and averaged in
// linear light rather than drawn on a canvas (DECISIONS D-19), optionally blurred for a viewing distance, and
// the error numbers measured on that render (DECISIONS D-10) with its similarity to the picture (D-54). The
// work itself is in core/realistic.ts.
import { toRgba8 } from "../core/image.ts";
import { referencePicture } from "../core/preprocess.ts";
import { measureTrueWidth, viewedRender } from "../core/realistic.ts";
import type { FromRender, ToRender } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: FromRender, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<ToRender>) => {
  const msg = e.data;
  try {
    if (msg.t === "render") {
      const width = Math.floor(msg.width), height = Math.floor(msg.height);
      const rgba = toRgba8(viewedRender(msg.options, msg.sequences, width, height, msg.region, msg.sigmaMm), width * height);
      post({ t: "image", id: msg.id, ticket: msg.ticket, width, height, rgba }, [rgba.buffer]);
    } else {
      const o = msg.options, from = msg.original;
      const original = from && { reference: referencePicture(from.picture, o.res, from.invert, { mode: from.mode, board: o.board, threads: o.threads }), painted: from.painted };
      const m = measureTrueWidth(o, msg.sequences, msg.target, msg.weight, original);
      post({ t: "measured", id: msg.id, ticket: msg.ticket, errorReduction: m.errorReduction, deltaE: m.deltaE, similarity: m.similarity });
    }
  } catch (err) {
    post({ t: "error", id: msg.id, ticket: msg.ticket, code: "internal", detail: err instanceof Error ? err.message : String(err) });
  }
};
