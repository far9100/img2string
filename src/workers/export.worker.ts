// Builds the downloads (spec §7.6) off the main thread. pdf-lib, fontkit and the PDF font are loaded only by
// this worker, and only the first time a PDF is asked for: the font is one of the app's own files, fetched
// from the same origin (the build's CSP allows nothing else, DECISIONS D-23), and then kept.
import { buildFile, needsFont, needsResult } from "../export/build.ts";
import type { FromExport, ToExport } from "./exportProtocol.ts";

const post = (m: FromExport, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
const FONT_URL = new URL("../assets/fonts/NotoSansTC-Regular-subset.ttf", import.meta.url);
let font: Promise<Uint8Array> | null = null;

function loadFont(): Promise<Uint8Array> {
  font ??= fetch(FONT_URL)
    .then(async (r) => {
      if (!r.ok) throw new Error("no-font");
      return new Uint8Array(await r.arrayBuffer());
    })
    .catch(() => {
      font = null; // a later download tries again
      throw new Error("no-font");
    });
  return font;
}

self.onmessage = async (e: MessageEvent<ToExport>) => {
  const { id, input, kind } = e.data;
  try {
    // no font is fetched for a file that cannot be built anyway: buildFile then answers "no-result"
    const buildable = input.project.result !== null || !needsResult(kind);
    const file = await buildFile(needsFont(kind) && buildable ? await loadFont() : null, input, kind);
    post({ t: "file", id, name: file.name, mime: file.mime, bytes: file.bytes }, [file.bytes.buffer as ArrayBuffer]);
  } catch (err) {
    post({ t: "error", id, detail: err instanceof Error ? err.message : String(err) });
  }
};
