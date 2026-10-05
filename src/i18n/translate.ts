// The translations without any DOM: usable in workers (PDF text) and in Node tests. Ported from img2fold.
import zhTW from "./zh-TW.json";
import en from "./en.json";

export const LANGS = ["zh-TW", "en"] as const;
export type Lang = (typeof LANGS)[number];
export type Entry = string | { one?: string; other: string };
export type Vars = Record<string, string | number>;

const STRINGS: Record<Lang, Record<string, Entry>> = { "zh-TW": zhTW, en };
const pluralRules = new Map<Lang, Intl.PluralRules>();
let current: Lang = "zh-TW";

export const isLang = (v: unknown): v is Lang => (LANGS as readonly unknown[]).includes(v);

export function strings(which: Lang): Readonly<Record<string, Entry>> {
  return STRINGS[which];
}

export function getLang(): Lang {
  return current;
}

export function setCurrentLang(next: Lang): void {
  current = isLang(next) ? next : "zh-TW";
}

/** Numbers in messages: no thousands separators (lengths read "150 mm", as on a ruler). */
function format(value: string | number, which: Lang): string {
  return typeof value === "number" ? value.toLocaleString(which, { useGrouping: false, maximumFractionDigits: 3 }) : String(value);
}

/** Translates `key` into the current (or given) language, filling {name} placeholders from `vars`.
 * An unknown key returns `fallback` (or the key), so a missing translation never breaks the page. */
export function t(key: string, vars: Vars = {}, fallback?: string, which: Lang = current): string {
  let text = STRINGS[which][key] ?? STRINGS["zh-TW"][key];
  if (text === undefined) return fallback !== undefined ? fallback : key;
  if (typeof text === "object") {
    let rules = pluralRules.get(which);
    if (!rules) pluralRules.set(which, (rules = new Intl.PluralRules(which)));
    const form = rules.select(Number(vars.n ?? 0)) as "one" | "other";
    text = text[form] ?? text.other;
  }
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? format(vars[name]!, which) : match));
}
