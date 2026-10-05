// Content-Security-Policy for the built page (not the dev server, whose hot reload needs inline code and a
// socket). The policy is the privacy promise of the spec (§8) in a form the browser enforces: the page may
// load its own files and nothing else, so even a bug cannot send a picture anywhere.
// Ported from img2shadow by way of img2fold.
import { createHash } from "node:crypto";
import type { Plugin } from "vite";

export const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' {hashes}",
  "style-src 'self'",
  "img-src 'self' blob: data:",
  "worker-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
];

/** SHA-256 source expressions for every inline <script> (the drop guard in index.html). */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    const body = match[1] ?? "";
    hashes.push(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  return hashes;
}

export function cspPlugin(): Plugin {
  return {
    name: "img2string-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const policy = CSP_DIRECTIVES.join("; ").replace("{hashes}", inlineScriptHashes(html).join(" ")).replace(/ +;/g, ";");
        const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
        if (!/<meta charset="utf-8">/i.test(html)) throw new Error("index.html needs <meta charset=\"utf-8\"> first");
        return html.replace(/<meta charset="utf-8">/i, (m) => `${m}\n${meta}`);
      },
    },
  };
}
