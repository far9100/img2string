// One message at a time at the bottom of the page (aria-live), as in line2func and img2shadow: errors stay 7 s, others 3.5 s.
import { t, type Vars } from "../i18n/i18n.ts";

let timer = 0;

export function toast(key: string, vars: Vars = {}, kind: "error" | "" = "", sticky = false): void {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = t(key, vars);
  el.className = kind;
  el.hidden = false;
  clearTimeout(timer);
  if (!sticky) timer = window.setTimeout(() => (el.hidden = true), kind === "error" ? 7000 : 3500);
}

export function hideToast(): void {
  const el = document.getElementById("toast");
  if (el) el.hidden = true;
}
