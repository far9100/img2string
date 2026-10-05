// The spec's reference code, read from img2string-spec-en.md itself (not a copy), so the tests can check the
// shipped core against exactly what the spec prints (after line2fourier's tests/helpers/spec11.ts). The spec
// is kept out of the repository (DECISIONS D-02): every user of this helper skips when the file is absent.
import { existsSync, readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import type * as StringArt from "../../src/core/stringart.ts";
import type * as Targets from "../../src/core/targets.ts";

const SPEC = new URL("../../img2string-spec-en.md", import.meta.url);

export const specPresent = existsSync(SPEC);

/** The two ```ts blocks of the spec: §12 (reference implementation) and §13.2 (benchmark targets). */
export function specBlocks(): [string, string] {
  const md = readFileSync(SPEC, "utf8").replace(/\r\n/g, "\n");
  const blocks = [...md.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]!);
  if (blocks.length !== 2) throw new Error(`expected 2 ts blocks in the spec, found ${blocks.length}`);
  return [blocks[0]!, blocks[1]!];
}

export type SpecReference = typeof StringArt & Pick<typeof Targets, "face" | "colourWheel">;

/** §12 and §13.2 evaluated straight from the spec's text. */
export function loadSpecReference(): SpecReference {
  const [core, targets] = specBlocks();
  const body = stripTypeScriptTypes(`${core}\n${targets}`).replace(/^export\s+/gm, "");
  const names = [...body.matchAll(/^(?:function|const|class)\s+(\w+)/gm)].map((m) => m[1]);
  return new Function(`${body}\nreturn { ${names.join(", ")} };`)() as SpecReference;
}
