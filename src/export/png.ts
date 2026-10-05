// A small PNG encoder (8-bit gray, RGB or RGBA, filter 0 per row, zlib from fflate) with the physical pixel
// size in pHYs. Written here rather than through a canvas so the bytes are the same in every browser.
// Ported from img2shadow.
import { zlibSync } from "fflate";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** The running CRC-32 register over `bytes` (not yet complemented: the checksum is the result ^ 0xffffffff). */
export function crc32(bytes: Uint8Array, crc = 0xffffffff): number {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

export interface PngOptions {
  /** Size of one pixel in mm; written to pHYs so print and design programs know the physical size. */
  pixelMm?: number;
}

/** Encodes w x h pixels with `channels` (1 gray, 3 RGB, 4 RGBA) 8-bit samples, row 0 at the top. */
export function encodePng(pixels: Uint8Array, w: number, h: number, channels: 1 | 3 | 4, o: PngOptions = {}): Uint8Array {
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const raw = new Uint8Array((w * channels + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * channels + 1)] = 0;
    raw.set(pixels.subarray(y * w * channels, (y + 1) * w * channels), y * (w * channels + 1) + 1);
  }
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr)];
  if (o.pixelMm && o.pixelMm > 0) {
    const phys = new Uint8Array(9);
    const ppm = Math.round(1000 / o.pixelMm);
    const pv = new DataView(phys.buffer);
    pv.setUint32(0, ppm);
    pv.setUint32(4, ppm);
    phys[8] = 1; // unit: metre
    parts.push(chunk("pHYs", phys));
  }
  parts.push(chunk("IDAT", zlibSync(raw, { level: 6 })), chunk("IEND", new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
