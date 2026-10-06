// The rectangular frame and the two presets that favour the middle, in the built page (DECISIONS D-58, D-59):
// a picture that is not square is told what a round frame shows of it and offered the other frame in one
// press; the piece, the downloads and the player then follow the rectangle; and "centre only" ignores the
// outer part of the frame, visibly.
import { expect, test, type Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { TestHooks } from "../../src/app/testHooks.ts";
import { allowedPairs } from "../../src/core/frame.ts";
import { generate, idle, open, quick, state } from "./helpers.ts";

const save = async (download: Download): Promise<Buffer> => readFile((await download.path())!);

/** A 320 x 240 PNG made in the page: a light ground, a dark disc left of the middle and a bar across the top. */
const landscape = (page: Parameters<typeof state>[0]) => page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 240;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e8e8e8";
  g.fillRect(0, 0, 320, 240);
  g.fillStyle = "#181818";
  g.beginPath();
  g.arc(110, 130, 60, 0, 2 * Math.PI);
  g.fill();
  g.fillRect(20, 14, 280, 22);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
});

test("a picture that is not square is offered a rectangular frame, and the whole piece follows it", async ({ page }) => {
  await open(page);
  await quick(page);
  // the built-in sample is square: nothing to say
  await expect(page.locator(".frame-advice")).toBeHidden();
  await page.locator("#file-input").setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: Buffer.from(await landscape(page)) });
  await expect.poll(() => state(page, (s) => s.source?.name ?? "")).toBe("wide.png");
  await idle(page);
  // a circle on the short side of a 4:3 picture is pi / 4 x 3 / 4 = 59 % of it
  await expect(page.locator(".frame-advice .advice")).toContainText("這張圖是 320 × 240，不是正方形：圓框放滿時最多只看得到其中 59%");
  expect(await state(page, (s) => s.project.frame)).toEqual({ shape: "circle", diameterMm: 500, pins: 96, pinDiameterMm: 1.5 });
  await expect(page.getByLabel("直徑", { exact: true })).toHaveValue("500");

  await page.getByRole("button", { name: "改用長方框" }).click();
  await expect.poll(() => state(page, (s) => s.project.frame.shape)).toBe("rect");
  expect(await state(page, (s) => s.project.frame)).toEqual({ shape: "rect", diameterMm: 500, pins: 96, pinDiameterMm: 1.5, aspect: 320 / 240 });
  await expect(page.locator(".frame-advice")).toBeHidden();
  await expect(page.getByLabel("框形")).toHaveValue("rect");
  await expect(page.getByLabel("長邊")).toHaveValue("500");
  await expect(page.locator(".group .stats").first()).toContainText("框是 500 × 375 mm");
  await idle(page);
  // the target now shows the whole picture: the bar across its top is inside the frame, which the circle cut off
  const seen = await state(page, (s) => {
    const { target, weight, res } = s.target!;
    let inside = 0, dark = 0, barRow = -1;
    for (let p = 0; p < res * res; p++) if (weight[p]! > 0) { inside++; if (target[3 * p]! < 0.1) dark++; }
    for (let y = 0; y < res && barRow < 0; y++) if (weight[y * res + (res >> 1)]! > 0 && target[3 * (y * res + (res >> 1))]! < 0.1) barRow = y;
    return { res, inside: inside / (res * res), dark: dark / inside, barRow };
  });
  expect(seen.inside).toBeGreaterThan(0.7); // three quarters of the square grid
  expect(seen.inside).toBeLessThan(0.8);
  expect(seen.dark).toBeGreaterThan(0.15);
  expect(seen.barRow).toBeGreaterThan(seen.res / 8); // the frame begins an eighth of the grid down, the bar a little below
  expect(seen.barRow).toBeLessThan(seen.res / 4);

  await generate(page);
  const made = await state(page, (s) => ({ frame: s.made!.frame, sequence: s.made!.result!.sequences[0]!, minSkip: s.made!.generator.minSkip }));
  expect(made.frame).toEqual({ shape: "rect", diameterMm: 500, pins: 96, pinDiameterMm: 1.5, aspect: 320 / 240 });
  expect(made.sequence.length).toBeGreaterThan(50);
  const ok = allowedPairs({ pins: 96, minSkip: made.minSkip, shape: "rect", aspect: 320 / 240 });
  for (let i = 1; i < made.sequence.length; i++) expect(ok[made.sequence[i - 1]! * 96 + made.sequence[i]!]).toBe(1);
  await expect.poll(() => state(page, (s) => s.result?.similarity ?? null), { timeout: 60_000 }).not.toBeNull();
  // the materials: a board of the frame's two sides plus the margin
  await expect(page.locator(".materials")).toContainText("540 × 415 mm");

  // the downloads are the rectangle's
  const get = async (label: string) => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label }).click()]);
    return save(download);
  };
  expect((await get("下載釘位模板（PDF）")).subarray(0, 5).toString()).toBe("%PDF-");
  expect((await get("模板 SVG")).toString()).toContain('width="540mm" height="415mm"');
  const dxf = (await get("模板 DXF")).toString();
  expect(dxf).toContain("POLYLINE\r\n8\r\nFRAME");
  expect(dxf).not.toContain("CIRCLE\r\n8\r\nFRAME");
  const csv = (await get("繞線順序 CSV")).toString().replace(/^﻿/, "").split("\r\n");
  expect(csv[0]).toBe("thread,name,hex,step,pin,side");
  expect(csv[1]).toMatch(/,[TRBL]\d+$/);
  expect((await get("繞線順序文字檔")).toString()).toContain("長方框 500 × 375 mm · 96 釘");
  expect((await get("線條 SVG")).toString()).toContain('width="540mm" height="415mm"');
  expect((await get("下載繞線說明（PDF）")).subarray(0, 5).toString()).toBe("%PDF-");
  // the preview is the frame alone, half a working pixel beyond its outline all round: 120 x 90.25 of them at this
  // resolution, its longer side the 2,000 pixels a round piece gets across
  const png = await get("預覽圖（PNG）");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2000, 1504]);

  // the player says where the next pin is by its side
  await page.getByRole("button", { name: "開始繞線" }).click();
  await expect(page.locator(".player-clock")).toHaveText(/^在[上右下左]邊，從[左上右下]數第 \d+ 根（共 \d+ 根）$/);
  await page.keyboard.press("Escape");

  // turned a quarter, the frame turns with the picture; back to the round frame, the proportions are gone
  await page.evaluate(() => (window as unknown as { __i2s: TestHooks }).__i2s.ctl.setCrop({ rotateDeg: 90 }));
  await expect.poll(() => state(page, (s) => (s.project.frame.shape === "rect" ? s.project.frame.aspect : 0))).toBe(240 / 320);
  await page.getByLabel("框形").selectOption("circle");
  await expect.poll(() => state(page, (s) => s.project.frame)).toEqual({ shape: "circle", diameterMm: 500, pins: 96, pinDiameterMm: 1.5 });
  await expect(page.locator(".frame-advice")).toBeVisible();
  await expect(page.getByLabel("直徑", { exact: true })).toHaveValue("500");
});

test("a project saved with a rectangular frame opens to the same piece", async ({ page }) => {
  await open(page);
  await quick(page);
  await page.locator("#file-input").setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: Buffer.from(await landscape(page)) });
  await expect.poll(() => state(page, (s) => s.source?.name ?? "")).toBe("wide.png");
  await page.getByLabel("框形").selectOption("rect");
  await idle(page);
  await generate(page);
  const before = await state(page, (s) => ({ sequences: s.made!.result!.sequences, frame: s.project.frame }));
  const [project] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "儲存專案" }).click()]);
  const text = (await save(project)).toString("utf8");
  expect(JSON.parse(text).frame).toEqual({ shape: "rect", diameterMm: 500, pins: 96, pinDiameterMm: 1.5, aspect: 1.333333 });

  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __i2s?: TestHooks }).__i2s);
  await idle(page);
  await page.locator("#project-input").setInputFiles({ name: "wide.img2string.json", mimeType: "application/json", buffer: Buffer.from(text) });
  // the picture is not in the file: the piece is shown from its sequences, on the frame the file describes
  await expect.poll(() => state(page, (s) => s.made?.result?.sequences ?? null), { timeout: 30_000 }).toEqual(before.sequences);
  expect(await state(page, (s) => [s.project.frame, s.project.result !== null, s.pictureMissing])).toEqual([before.frame, true, true]);
});

test("centre only: the outer part of the frame is ignored, and the page shows which part that is", async ({ page }) => {
  await open(page);
  await quick(page);
  await generate(page);
  await expect.poll(() => state(page, (s) => s.result?.similarity ?? null), { timeout: 60_000 }).not.toBeNull();
  const whole = await state(page, (s) => ({ lines: s.made!.result!.lines[0]!, similarity: s.result!.similarity! }));

  await page.getByText("哪裡比較重要").click();
  await page.locator("details", { hasText: "哪裡比較重要" }).getByLabel("預設").selectOption("centreOnly");
  await expect.poll(() => state(page, (s) => s.project.importance.preset)).toBe("centreOnly");
  await idle(page);
  // inside the pin circle, beyond two thirds of its radius: no weight, and the veil that says so
  const zone = await state(page, (s) => {
    const { weight, weightRgba, res } = s.target!, c = (res - 1) / 2;
    let middle = 0, ignored = 0, veiled = 0, outside = 0;
    for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) {
      const p = y * res + x, d = Math.hypot(x - c, y - c);
      if (d > c + 1) { if (weightRgba[4 * p + 3]! > 0) outside++; continue; }
      if (d < (2 / 3) * c - 1) { if (weight[p] === 1 && weightRgba[4 * p + 3] === 0) middle++; } else if (d > (2 / 3) * c + 1 && d < c - 1) { if (weight[p] === 0) ignored++; if (weightRgba[4 * p + 3]! > 100) veiled++; }
    }
    return { middle, ignored, veiled, outside };
  });
  expect(zone.middle).toBeGreaterThan(1000);
  expect(zone.ignored).toBeGreaterThan(1000);
  expect(zone.veiled).toBe(zone.ignored);
  expect(zone.outside).toBe(0);

  await generate(page);
  await expect.poll(() => state(page, (s) => (s.made?.importance.preset === "centreOnly" ? (s.result?.similarity ?? null) : null)), { timeout: 60_000 }).not.toBeNull();
  const centre = await state(page, (s) => ({ lines: s.made!.result!.lines[0]!, similarity: s.result!.similarity! }));
  // far fewer lines: only the middle is drawn; and the number now says how close the middle is, which is closer
  expect(centre.lines).toBeLessThan(whole.lines);
  expect(centre.similarity).toBeGreaterThan(whole.similarity);
  await expect(page.locator(".metrics")).toContainText("和原圖的相似度");
});
