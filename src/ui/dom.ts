// Small DOM helpers (ported from img2shadow): element builders and labelled form fields whose text comes from the i18n files
// (data-i18n attributes, so switching language re-labels everything).
import { applyI18n, t } from "../i18n/i18n.ts";

type Child = Node | string | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined | EventListener;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, AttrValue> | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (key === "class") el.className = String(value);
      else if (key === "style") {
        // through the CSSOM: the page's CSP blocks style attributes, not style properties set from script
        for (const decl of String(value).split(";")) {
          const at = decl.indexOf(":");
          if (at > 0) el.style.setProperty(decl.slice(0, at).trim(), decl.slice(at + 1).trim());
        }
      }
      else if (key === "text") el.textContent = String(value);
      else if (value === true) el.setAttribute(key, "");
      else el.setAttribute(key, String(value));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** Text that follows the language: <span data-i18n=key>. */
export const tx = (key: string, cls?: string): HTMLSpanElement => h("span", { "data-i18n": key, class: cls, text: t(key) });

let uid = 0;
export const nextId = (prefix: string): string => `${prefix}-${++uid}`;

export interface NumberFieldOptions {
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number | "any";
  hint?: string;
  onCommit: (value: number) => void;
}

/** A labelled number input that commits on change (Enter or leaving the field), never on every keystroke. */
export function numberField(o: NumberFieldOptions): { el: HTMLElement; input: HTMLInputElement; set: (v: number | null) => void } {
  const id = nextId("num");
  const input = h("input", {
    id,
    type: "number",
    inputmode: "decimal",
    min: o.min,
    max: o.max,
    step: o.step ?? "any",
    class: "num",
  });
  input.addEventListener("change", () => {
    const v = input.valueAsNumber;
    if (Number.isFinite(v)) o.onCommit(v);
  });
  const el = h(
    "div",
    { class: "field" },
    h("label", { for: id, "data-i18n": o.label, text: t(o.label) }),
    h("span", { class: "control" }, input, o.unit ? h("span", { class: "unit", text: o.unit }) : null),
    o.hint ? h("small", { class: "hint", "data-i18n": o.hint, text: t(o.hint) }) : null,
  );
  return {
    el,
    input,
    set(v) {
      if (document.activeElement === input) return; // do not fight the user's typing
      input.value = v === null || !Number.isFinite(v) ? "" : String(Math.round(v * 1000) / 1000);
    },
  };
}

export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

export function selectField(o: { label: string; options: Option[]; onChange: (v: string) => void }): { el: HTMLElement; select: HTMLSelectElement; set: (v: string) => void } {
  const id = nextId("sel");
  const select = h("select", { id });
  for (const opt of o.options) select.append(h("option", { value: opt.value, disabled: opt.disabled, "data-i18n": opt.label, text: t(opt.label) }));
  select.addEventListener("change", () => o.onChange(select.value));
  const el = h("div", { class: "field" }, h("label", { for: id, "data-i18n": o.label, text: t(o.label) }), h("span", { class: "control" }, select));
  return { el, select, set: (v) => (select.value = v) };
}

export function rangeField(o: { label: string; min: number; max: number; step: number; format: (v: number) => string; onInput?: (v: number) => void; onCommit: (v: number) => void }) {
  const id = nextId("rng");
  const input = h("input", { id, type: "range", min: o.min, max: o.max, step: o.step });
  const out = h("output", { for: id, class: "num-out" });
  input.addEventListener("input", () => {
    out.textContent = o.format(input.valueAsNumber);
    o.onInput?.(input.valueAsNumber);
  });
  input.addEventListener("change", () => o.onCommit(input.valueAsNumber));
  const el = h("div", { class: "field" }, h("label", { for: id, "data-i18n": o.label, text: t(o.label) }), h("span", { class: "control" }, input, out));
  return {
    el,
    input,
    set(v: number) {
      if (document.activeElement !== input) input.value = String(v);
      out.textContent = o.format(v);
    },
  };
}

export function checkField(o: { label: string; onChange: (v: boolean) => void }) {
  const id = nextId("chk");
  const input = h("input", { id, type: "checkbox" });
  input.addEventListener("change", () => o.onChange(input.checked));
  const el = h("div", { class: "field check" }, input, h("label", { for: id, "data-i18n": o.label, text: t(o.label) }));
  return { el, input, set: (v: boolean) => (input.checked = v) };
}

/** A titled group of controls. */
export function group(titleKey: string, ...children: Child[]): HTMLElement {
  return h("section", { class: "group" }, h("h3", { "data-i18n": titleKey, text: t(titleKey) }), ...children);
}

export function button(labelKey: string, onClick: () => void, cls = ""): HTMLButtonElement {
  return h("button", { type: "button", class: cls, "data-i18n": labelKey, text: t(labelKey), onclick: () => onClick() });
}

export function refreshText(root: ParentNode): void {
  applyI18n(root);
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
