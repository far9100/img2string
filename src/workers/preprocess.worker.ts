/// <reference lib="webworker" />
// The preprocess worker: it keeps the opened picture's pixels and turns a crop, the adjustments and the
// importance settings into the target and the weight map the generator uses (spec §6.2 to §6.5), plus pictures
// of both for the page and, in colour mode, the gamut check (§6.3). It also hands out the cropped picture as
// it is, for the automatic adjustment and the similarity number (DECISIONS D-54, D-55). Built-in samples are
// generated at the working resolution and never cropped, so they stay exact (DECISIONS D-29).
import { emphasizedWeights } from "../core/emphasis.ts";
import { GAMUT_CLUSTERS, GAMUT_SAMPLES, GAMUT_THRESHOLD, gamutCheck, gamutPicture, summarize, type GamutSummary } from "../core/gamut.ts";
import { toRgba8 } from "../core/image.ts";
import { frameMask } from "../core/frame.ts";
import { adjustTarget, blankShare, cropForFrame, importanceWeights, makeCropper, referencePicture, type Cropper } from "../core/preprocess.ts";
import { IDENTITY_CROP } from "../core/project.ts";
import { sampleTarget, type SampleId } from "../core/targets.ts";
import type { CropRequest, FromPre, TargetRequest, ToPre } from "./protocol.ts";

declare const self: DedicatedWorkerGlobalScope;

let picture: { width: number; height: number; crop: Cropper } | null = null;
let sample: SampleId | null = null;

const post = (msg: FromPre, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

/** The picture through the crop, and the weights as painted: the preset and the brush, before any automatic emphasis. */
function cropped(r: CropRequest): { picture: Float64Array; painted: Float64Array } {
  if (picture) {
    return {
      picture: cropForFrame(picture.crop, r.crop, r.res, r.board, picture.width, picture.height, r.frame),
      painted: importanceWeights(r.res, r.preset, r.strokes, r.crop, picture.width, picture.height, r.frame),
    };
  }
  // a sample is square and fills the grid: a rectangular frame around it is the whole of it
  return { picture: sampleTarget(sample ?? "face", r.res), painted: importanceWeights(r.res, r.preset, r.strokes, IDENTITY_CROP, r.res, r.res, r.frame) };
}

/** The weight map as a picture, drawn over the target: only what differs from the default is shown. Less than
 * 1 is a blue veil, strongest where the weight is 0 (the part a preset or the brush tells the lines to ignore);
 * more than 1 is orange, up to 3. Outside the frame nothing is drawn. */
function weightPicture(weight: Float64Array, inside: Float64Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(4 * weight.length);
  for (let p = 0; p < weight.length; p++) {
    const w = weight[p]!, q = 4 * p;
    if (w === 1 || !inside[p]) continue;
    if (w < 1) { out[q] = 40; out[q + 1] = 90; out[q + 2] = 200; out[q + 3] = Math.round(150 * (1 - w)); }
    else { out[q] = 230; out[q + 1] = 120; out[q + 2] = 20; out[q + 3] = Math.min(170, Math.round(75 * (w - 1))); } // the picture stays visible under any weight
  }
  return out;
}

self.onmessage = (e: MessageEvent<ToPre>) => {
  const msg = e.data;
  try {
    if (msg.t === "picture") {
      picture = { width: msg.width, height: msg.height, crop: makeCropper({ width: msg.width, height: msg.height, rgba: msg.rgba }) };
      sample = null;
      post({ t: "ready", id: msg.id, width: msg.width, height: msg.height });
    } else if (msg.t === "sample") {
      picture = null;
      sample = msg.sample;
      post({ t: "ready", id: msg.id, width: 0, height: 0 });
    } else if (msg.t === "crop") {
      const made = cropped(msg.request);
      post({ t: "cropped", id: msg.id, ticket: msg.ticket, res: msg.request.res, picture: made.picture, painted: made.painted }, [made.picture.buffer, made.painted.buffer]);
    } else {
      const r: TargetRequest = msg.request, made = cropped(r), painted = made.painted, px = r.res * r.res, palette = { mode: r.mode, board: r.board, threads: r.threads };
      const target = adjustTarget(made.picture, r.res, r.adjust, palette);
      const blank = blankShare(referencePicture(made.picture, r.res, r.adjust.invert, palette), painted, r.board);
      const weight = emphasizedWeights(painted, target, r.res, r.edges, r.tone);
      let gamut: GamutSummary | null = null, gamutRgba: Uint8ClampedArray<ArrayBuffer> | null = null;
      if (r.gamut) {
        // what the brush set to 0 does not matter, so it is not checked either
        const report = gamutCheck(target, painted, r.board, r.threads, GAMUT_CLUSTERS, GAMUT_THRESHOLD, GAMUT_SAMPLES);
        gamut = summarize(report);
        gamutRgba = gamutPicture(report, r.res);
      }
      const rgba = toRgba8(target, px), weightRgba = weightPicture(weight, frameMask({ res: r.res, ...r.frame }));
      const transfer: Transferable[] = [target.buffer, weight.buffer, rgba.buffer, weightRgba.buffer];
      if (gamutRgba) transfer.push(gamutRgba.buffer);
      post({ t: "target", id: msg.id, ticket: msg.ticket, res: r.res, target, weight, rgba, weightRgba, gamut, gamutRgba, blank }, transfer);
    }
  } catch (err) {
    post({ t: "error", id: msg.id, code: "internal", detail: err instanceof Error ? err.message : String(err) });
  }
};
