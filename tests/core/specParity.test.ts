// The shipped core is the spec's code (§16.2: "the §12 reference may be used as is"). The spec file is not in
// the repository (DECISIONS D-02), so the files are pinned by the SHA-256 of the spec's two code blocks; when
// the spec is present, the hashes themselves are checked against it.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { specBlocks, specPresent } from "../helpers/spec.ts";

const SPEC_12 = "7ccf7adfc7be649d616bbe280f4cafc2390f72992b7dcc59756b51088cbfbe00";
const SPEC_13_2 = "7e4be4f8cdf5bfa967d9582c07b3f4f2a60c073f8771f6d079edffa89b1a895d";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function shippedTargets(): string {
  const source = read("../../src/core/targets.ts");
  const begin = "// --- spec 13.2: begin\n", end = "// --- spec 13.2: end";
  return source.slice(source.indexOf(begin) + begin.length, source.indexOf(end)).replace(/^export function /gm, "function ");
}

describe("the shipped core is the spec's code", () => {
  it("src/core/stringart.ts is §12, character for character", () => {
    expect(sha(read("../../src/core/stringart.ts"))).toBe(SPEC_12);
  });

  it("face() and colourWheel() in src/core/targets.ts are §13.2 with 'export' added", () => {
    expect(sha(shippedTargets())).toBe(SPEC_13_2);
  });

  it.skipIf(!specPresent)("the pinned hashes are those of the spec file", () => {
    const [core, targets] = specBlocks();
    expect(sha(core)).toBe(SPEC_12);
    expect(sha(targets)).toBe(SPEC_13_2);
  });
});
