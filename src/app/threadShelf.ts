// The user's own thread colours (spec §6.3: "users can save their real thread colours as a personal list"),
// kept in this browser's localStorage. The list functions are pure; only load and store touch the storage.
import { isHex, LIMITS, normalHex } from "../core/project.ts";

export interface ShelfThread {
  name: string;
  hex: string;
}

export const SHELF_KEY = "img2string.threads";
export const SHELF_MAX = 48;

/** Anything read from storage, as a valid list. */
export function normalizeShelf(raw: unknown): ShelfThread[] {
  if (!Array.isArray(raw)) return [];
  const out: ShelfThread[] = [];
  for (const item of raw) {
    const r = item as { name?: unknown; hex?: unknown } | null;
    if (!r || !isHex(r.hex)) continue;
    const entry = { name: typeof r.name === "string" ? r.name.slice(0, LIMITS.nameLength) : "", hex: normalHex(r.hex) };
    if (!out.some((t) => t.hex === entry.hex && t.name === entry.name)) out.push(entry);
    if (out.length >= SHELF_MAX) break;
  }
  return out;
}

/** The list with the thread added at the front (a thread already there moves to the front). */
export function addToShelf(list: readonly ShelfThread[], thread: ShelfThread): ShelfThread[] {
  const entry = { name: thread.name.slice(0, LIMITS.nameLength), hex: normalHex(thread.hex) };
  return [entry, ...list.filter((t) => !(t.hex === entry.hex && t.name === entry.name))].slice(0, SHELF_MAX);
}

export const removeFromShelf = (list: readonly ShelfThread[], index: number): ShelfThread[] => list.filter((_, i) => i !== index);

export function loadShelf(): ShelfThread[] {
  try {
    return normalizeShelf(JSON.parse(localStorage.getItem(SHELF_KEY) ?? "[]"));
  } catch {
    return []; // storage may be blocked, or hold something else
  }
}

export function storeShelf(list: readonly ShelfThread[]): void {
  try {
    localStorage.setItem(SHELF_KEY, JSON.stringify(list));
  } catch {
    /* storage may be blocked: the list then lasts for this visit */
  }
}
