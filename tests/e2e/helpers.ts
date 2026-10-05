import { expect, type BrowserContext, type Page } from "@playwright/test";

/** Records every request of the page's context and every CSP violation; check() asserts there were none
 * outside the site's own origin (§8 and §13.4: no network requests besides the site's static files). */
export async function watchNetwork(page: Page, context: BrowserContext, baseURL: string) {
  const origin = new URL(baseURL).origin;
  const foreign: string[] = [];
  const methods: string[] = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    // only what can leave the computer counts; data:, blob: and the browser's own pages (edge://, chrome://,
    // e.g. its downloads panel) cannot
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return;
    if (url.origin !== origin) foreign.push(request.url());
    if (request.method() !== "GET") methods.push(`${request.method()} ${request.url()}`);
  });
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return {
    async check() {
      expect(foreign, "requests to other origins").toEqual([]);
      expect(methods, "requests other than GET").toEqual([]);
      const csp = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
      expect(csp, "CSP violations").toEqual([]);
    },
  };
}
