// Decoding pictures on the page (spec §6.1: PNG, JPG, WebP), after img2fold's imageClient. The browser applies
// the EXIF orientation; pictures larger than 4096 px on the long side are shrunk while decoding (§14).
export interface Decoded {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export const MAX_SIDE = 4096;
/** Below this the picture is too small to carry detail to the working grid; the page warns (§14). */
export const SMALL_SIDE = 200;

export async function decodePicture(file: Blob, maxSide = MAX_SIDE): Promise<Decoded> {
  const bmp = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "from-image" });
  try {
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const width = Math.max(1, Math.round(bmp.width * k)), height = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, width, height);
    return { width, height, rgba: ctx.getImageData(0, 0, width, height).data };
  } finally {
    bmp.close();
  }
}

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** A data: URL as a Blob. The page's CSP has connect-src 'self', so fetch("data:...") is not allowed; the
 * bytes are decoded by hand (after img2shadow's controller). */
export function dataUrlToBlob(url: string): Blob | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const type = m[1]!, body = m[3]!;
  if (!m[2]) return new Blob([decodeURIComponent(body)], { type });
  const bin = atob(body), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
