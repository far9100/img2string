// UI text in Traditional Chinese (default, §8) and English: zh-TW.json and en.json.
// Ported from img2fold (originally line2func's viewer/i18n.js). Static text: elements carry data-i18n
// (text), data-i18n-title (tooltip), data-i18n-aria-label or data-i18n-placeholder; applyI18n() fills them
// in. Dynamic text: t(key, vars). A translation may be {one, other}, chosen by vars.n.
import { getLang, isLang, setCurrentLang, t, type Lang } from "./translate.ts";

export { getLang, LANGS, strings, t, type Entry, type Lang, type Vars } from "./translate.ts";

const STORAGE_KEY = "img2string.lang";
const listeners = new Set<(lang: Lang) => void>();

/** The language to start with: the saved choice, else Traditional Chinese (§8, DECISIONS D-20). */
export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch {
    /* storage may be blocked */
  }
  return "zh-TW";
}

export function setLang(next: Lang, remember = false): void {
  setCurrentLang(next);
  const lang = getLang();
  document.documentElement.lang = lang;
  applyI18n(document);
  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage may be blocked */
    }
  }
  for (const listener of listeners) listener(lang);
}

export function onLangChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyI18n(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) el.textContent = t(el.dataset.i18n!);
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle!);
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-aria-label]")) el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel!));
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]")) el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder!));
}
