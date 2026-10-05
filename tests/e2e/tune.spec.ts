// The automatic adjustment in the built page (DECISIONS D-54, D-55): a line drawing, which the neutral settings
// leave almost empty, is brought closer to the picture; the page says how close, and it can be stopped.
import { expect, test } from "@playwright/test";
import type { TestHooks } from "../../src/app/testHooks.ts";
import { linearToSrgb8 } from "../../src/core/image.ts";
import { encodePng } from "../../src/export/png.ts";
import { lineDrawing } from "../helpers/pictures.ts";
import { generate, idle, open, state, watchNetwork } from "./helpers.ts";

/** Thin dark outlines on white, as a PNG file. */
function drawing(size = 360): Buffer {
  return Buffer.from(encodePng(Uint8Array.from(lineDrawing(size), linearToSrgb8), size, size, 3));
}

const similarity = (page: Parameters<typeof state>[0]) => expect.poll(() => state(page, (s) => s.result?.similarity ?? null), { timeout: 60_000 }).not.toBeNull();

test("finds the settings closest to the picture, and says how close the piece is", async ({ page, context, baseURL }) => {
  const net = await watchNetwork(page, context, baseURL!);
  await open(page);
  // a small frame, but a working resolution above 160 px, so the search runs on its quick set-up first
  await page.evaluate(() => {
    const { ctl } = (window as unknown as { __i2s: TestHooks }).__i2s;
    ctl.commit({ ...ctl.state.project, frame: { ...ctl.state.project.frame, pins: 96 }, thread: { widthMm: 0.6 }, generator: { ...ctl.state.project.generator, res: 200, minSkip: 8 } });
  });
  await page.locator("#file-input").setInputFiles({ name: "drawing.png", mimeType: "image/png", buffer: drawing() });
  await expect.poll(() => state(page, (s) => s.source?.name)).toBe("drawing.png");
  await idle(page);
  // a picture that is mostly bare board is told so, with the palette that suits it one press away
  const share = await state(page, (s) => s.target!.blank);
  expect(share).toBeGreaterThan(0.8);
  await expect(page.locator(".tune .blank")).toContainText(`這張圖有 ${Math.round(100 * share)}% 和板子一樣亮`);

  // as it comes: a handful of lines, far from the drawing
  await generate(page);
  await similarity(page);
  const before = await state(page, (s) => ({ lines: s.made!.result!.lines[0]!, similarity: s.result!.similarity! }));
  expect(before.lines).toBeLessThan(80);
  await expect(page.locator(".metrics")).toContainText("和原圖的相似度");

  const go = page.getByRole("button", { name: "找出最接近原圖的數值" });
  await expect(go).toBeEnabled();
  await go.click();
  await expect.poll(() => state(page, (s) => s.tune.status === "idle" && s.tune.last !== null), { timeout: 120_000 }).toBe(true);
  await expect(page.locator("#toast")).toContainText("已調整：和原圖的相似度");
  await expect(page.locator("#toast")).toContainText("按「生成」看結果");
  const last = await state(page, (s) => s.tune.last!);
  expect(last.changed).toBe(true);
  expect(last.before).toBe(Math.round(100 * before.similarity));
  expect(last.after).toBeGreaterThan(last.before + 10);
  await expect(page.locator(".tune .status")).toContainText(`這組數值是自動找到的：和原圖的相似度 ${last.before}% → ${last.after}%`);
  // the sliders moved; invert, the colours and the frame did not
  const found = await state(page, (s) => ({ adjust: s.project.adjust, edges: s.project.importance.edges, tone: s.project.importance.tone, pins: s.project.frame.pins, threads: s.project.threads.length, stale: s.project.result === null }));
  expect([found.adjust.invert, found.adjust.saturation, found.pins, found.threads]).toEqual([false, 1, 96, 1]);
  expect(found.adjust.unsharp + found.tone + found.edges + Math.abs(found.adjust.brightness) + Math.abs(found.adjust.contrast) + Math.abs(found.adjust.gamma - 1)).toBeGreaterThan(0.2);
  expect(found.stale).toBe(true); // the piece on screen was made with the old settings

  // generated with what was found: the piece is the one the search measured
  await idle(page);
  await generate(page);
  await similarity(page);
  const after = await state(page, (s) => ({ lines: s.made!.result!.lines[0]!, similarity: s.result!.similarity! }));
  expect(Math.round(100 * after.similarity)).toBe(last.after);
  expect(after.lines).toBeGreaterThan(3 * before.lines);
  await expect(page.locator(".metrics")).toContainText(`${last.after}%`);

  // changing a slider by hand takes the note away: it no longer describes these settings
  await page.locator("details", { hasText: "調整圖片" }).locator("summary").click();
  await page.getByRole("button", { name: "重設調整" }).click();
  await expect(page.locator(".tune .status")).toBeHidden();
  // the advice's own button adds the white thread, wound last; with it the advice has nothing left to say
  await page.getByRole("button", { name: "換成〔白板，先黑線再白線〕" }).click();
  await expect.poll(() => state(page, (s) => s.project.threads.map((t) => t.hex))).toEqual(["#111111", "#F2F2F2"]);
  await expect(page.locator(".tune .blank")).toBeHidden();
  await net.check();
});

test("the search can be stopped, and then nothing has changed", async ({ page }) => {
  await open(page);
  // the face sample at its real size: long enough to stop
  const go = page.getByRole("button", { name: "找出最接近原圖的數值" });
  await go.click();
  const stop = page.locator('button[data-i18n="tune.stop"]');
  await expect(stop).toBeVisible();
  await expect(go).toBeHidden();
  await expect(page.locator(".tune .status")).toContainText(/正在嘗試：\d+／\d+/);
  await stop.click();
  await expect.poll(() => state(page, (s) => [s.tune.status, s.tune.last])).toEqual(["idle", null]);
  await expect(go).toBeVisible();
  await expect(go).toBeEnabled();
  expect(await state(page, (s) => [s.project.adjust.brightness, s.project.adjust.unsharp, s.project.importance.tone, s.project.importance.edges])).toEqual([0, 0, 0, 0]);
  await expect(page.locator(".tune .status")).toBeHidden();
  // the face sample has tones all over: no advice about bare board
  expect(await state(page, (s) => s.target!.blank)).toBeLessThan(0.4);
  await expect(page.locator(".tune .blank")).toBeHidden();
});
