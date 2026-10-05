import { expect, type BrowserContext, type Page } from "@playwright/test";
import type { TestHooks } from "../../src/app/testHooks.ts";

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

type State = ReturnType<TestHooks["state"]>;

/** Waits for the test hooks the page installs when its address has ?test. */
export const hooks = (page: Page) => page.waitForFunction(() => !!(window as unknown as { __i2s?: TestHooks }).__i2s);

/** Reads from the page's state. `pick` runs in the page, so it must not use anything from outside itself; it
 * is passed as source text through the debugger, which the page's CSP does not restrict. */
export const state = <T>(page: Page, pick: (s: State) => T): Promise<T> => page.evaluate(`(${pick.toString()})(window.__i2s.state())`) as Promise<T>;

/** Nothing is being computed: the target is ready and no run is going. */
export const idle = (page: Page) => expect.poll(() => state(page, (s) => s.run.status === "idle" && !!s.target && !s.targetBusy), { timeout: 60_000 }).toBe(true);

export async function open(page: Page): Promise<void> {
  await page.goto("./?test");
  await hooks(page);
  await idle(page);
}

/** Small settings, so that a run takes a second or two. */
export async function quick(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { ctl } = (window as unknown as { __i2s: TestHooks }).__i2s;
    ctl.commit({ ...ctl.state.project, frame: { ...ctl.state.project.frame, pins: 96 }, generator: { ...ctl.state.project.generator, res: 120, minSkip: 8 } });
  });
  await idle(page);
}

/** Generates with the current settings and waits for the result. */
export async function generate(page: Page): Promise<void> {
  await page.evaluate(() => void (window as unknown as { __i2s: TestHooks }).__i2s.ctl.generate(false));
  await expect.poll(() => state(page, (s) => s.run.status === "idle" && !!s.project.result), { timeout: 120_000 }).toBe(true);
}
