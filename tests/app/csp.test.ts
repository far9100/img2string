import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cspPlugin, inlineScriptHashes } from "../../scripts/csp-plugin.ts";

describe("CSP", () => {
  it("hashes exactly the inline scripts of index.html", () => {
    const html = readFileSync(join(__dirname, "../../index.html"), "utf8");
    const hashes = inlineScriptHashes(html);
    expect(hashes).toHaveLength(1);
    const body = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    expect(hashes[0]).toBe(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  });

  it("puts a self-only policy right after the charset", () => {
    const plugin = cspPlugin();
    const hook = plugin.transformIndexHtml as { handler: (html: string) => string };
    const out = hook.handler('<head><meta charset="utf-8"><script>x()</script><script type="module" src="/a.js"></script></head>');
    expect(out).toMatch(/<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-[^']+';/);
    expect(out).toContain("connect-src 'self'");
    expect(out).toContain("object-src 'none'");
  });
});
