// Canvas sizing and raster drawing for the views (after img2fold's canvasUtil).

/** Sizes the canvas backing store to its CSS size x devicePixelRatio (at most 2) and returns the scale. */
export function fitCanvas(canvas: HTMLCanvasElement, cssW: number, cssH = cssW): number {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return dpr;
}

const scratch = new Map<string, HTMLCanvasElement>();

/** An off-screen canvas holding the RGBA image (reused per `slot`, so repeated draws do not allocate). */
export function rgbaCanvas(slot: string, rgba: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  let c = scratch.get(slot);
  if (!c) scratch.set(slot, (c = document.createElement("canvas")));
  if (c.width !== width) c.width = width;
  if (c.height !== height) c.height = height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
  return c;
}

/** Calls `cb` with the element's content width whenever it changes. */
export function onResize(el: HTMLElement, cb: (width: number) => void): void {
  let last = -1;
  new ResizeObserver((entries) => {
    const w = Math.floor(entries[0]!.contentRect.width);
    if (w !== last && w > 0) {
      last = w;
      cb(w);
    }
  }).observe(el);
}

/** A colour of the page's theme (a CSS custom property of :root), as written in the stylesheet: fine for a
 * canvas, but not for arithmetic, because the build may shorten "#ffffff" to "#fff". */
export const themeColour = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let probe: HTMLElement | null = null;

/** A colour of the page's theme as "#RRGGBB", resolved by the browser whatever notation the stylesheet uses. */
export function themeHex(name: string, fallback = "#FFFFFF"): string {
  if (!probe) {
    probe = document.createElement("span");
    probe.hidden = true;
    document.body.append(probe);
  }
  probe.style.setProperty("color", `var(${name})`);
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(getComputedStyle(probe).color);
  return m ? `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("").toUpperCase()}` : fallback;
}
