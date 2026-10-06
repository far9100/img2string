// The two languages: complete, consistent, and every text on the page goes through them
// (the rules of line2func's tests/test_i18n.py, ported from img2fold).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMPORTANCE_PRESETS } from "../src/core/project.ts";
import zh from "../src/i18n/zh-TW.json";
import en from "../src/i18n/en.json";

type Entry = string | { one?: string; other: string };
const ZH = zh as Record<string, Entry>;
const EN = en as Record<string, Entry>;
const ROOT = join(__dirname, "..");
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");
const CJK = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/g;
// keys built at run time from codes, e.g. t("issue." + code)
const DYNAMIC: string[] = ["sample.", "preset.", "issue.", "importance.", "adjust.", "thread.", "compare.", "paper.", "hue.", "calib.problem."];

function sources(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) Object.assign(out, sources(path));
    else if (name.endsWith(".ts")) out[path] = readFileSync(path, "utf8");
  }
  return out;
}
const SRC = sources(join(ROOT, "src"));

const placeholders = (text: Entry): Set<string> =>
  typeof text === "string" ? new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)) : new Set([...Object.values(text).flatMap((v) => [...placeholders(v!)])]);

function usedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const m of HTML.matchAll(/data-i18n(?:-title|-aria-label|-placeholder)?="([^"]+)"/g)) keys.add(m[1]!);
  for (const source of Object.values(SRC)) {
    for (const m of source.matchAll(/\bt\(\s*"([^"]+)"/g)) keys.add(m[1]!);
    for (const m of source.matchAll(/data-i18n(?:-title|-aria-label|-placeholder)?="([^"]+)"/g)) keys.add(m[1]!);
    // keys chosen in an expression, e.g. t(ok ? "a.b" : "a.c") or i18n: "a.b" in a table
    for (const m of source.matchAll(/"([\w-]+(?:\.[\w-]+)+)"/g)) if (m[1]! in EN) keys.add(m[1]!);
  }
  return keys;
}

describe("i18n", () => {
  it("both languages have the same keys and placeholders; plurals have 'other'", () => {
    expect(Object.keys(ZH).sort()).toEqual(Object.keys(EN).sort());
    for (const key of Object.keys(EN)) {
      expect([...placeholders(ZH[key]!)].sort(), key).toEqual([...placeholders(EN[key]!)].sort());
      for (const text of [ZH[key]!, EN[key]!]) if (typeof text === "object") expect(text.other, key).toBeTypeOf("string");
    }
  });

  it("every key the page uses exists", () => {
    const missing = [...usedKeys()].filter((k) => !(k in EN) && !DYNAMIC.some((p) => k === p));
    expect(missing).toEqual([]);
  });

  it("every importance preset has a name (the names are looked up by the preset's code)", () => {
    for (const id of IMPORTANCE_PRESETS) for (const texts of [ZH, EN]) expect(texts[`importance.${id}`], id).toBeTypeOf("string");
  });

  it("every key is used or built from a code", () => {
    const used = usedKeys();
    const unused = Object.keys(EN).filter((k) => !used.has(k) && !DYNAMIC.some((p) => k.startsWith(p)));
    expect(unused).toEqual([]);
  });

  it("Chinese text lives only in the translations", () => {
    expect(HTML.replace(">中文<", "><").match(CJK)).toBeNull();
    for (const [path, source] of Object.entries(SRC)) {
      const stray = source.match(CJK);
      expect(stray, path).toBeNull();
    }
  });

  it("the English side is in English", () => {
    for (const [key, text] of Object.entries(EN)) {
      const all = typeof text === "string" ? text : Object.values(text).join(" ");
      expect(all.match(CJK), key).toBeNull();
    }
  });
});
