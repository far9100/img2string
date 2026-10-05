// The whole flow in the built page: a sample, generate, stop and continue, the result views, every download,
// the project file, and the language switch; with no request leaving the page (§13.4).
import { expect, test, type Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { watchNetwork } from "./helpers.ts";

import { hooks, idle, open, quick, state } from "./helpers.ts";

async function save(download: Download): Promise<Buffer> {
  return readFile((await download.path())!);
}

test("generates the sample, shows it, and stays offline", async ({ page, context, baseURL }) => {
  const net = await watchNetwork(page, context, baseURL!);
  await open(page);
  await quick(page);
  await expect(page.getByRole("button", { name: "生成", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect.poll(() => state(page, (s) => s.made?.result?.lines[0] ?? 0), { timeout: 60_000 }).toBeGreaterThan(100);
  await idle(page);
  expect(await state(page, (s) => s.project.result?.reason)).toBe("converged");
  expect(await state(page, (s) => s.made!.result!.errorReduction)).toBeGreaterThan(0.6);
  await expect(page.locator(".metrics")).toContainText("誤差降低");
  // the measurement on the true-width render arrives a little later
  await expect.poll(() => state(page, (s) => s.result?.trueReduction ?? null), { timeout: 60_000 }).not.toBeNull();
  // the true-width view, the viewing distance, the comparison and the magnifier draw without errors
  await page.getByLabel("真實線寬").check();
  await page.getByLabel("觀看距離").fill("2");
  await page.getByLabel("和圖片比較").selectOption("wipe");
  await page.getByLabel("放大鏡").check();
  const canvas = page.locator(".stage-canvas");
  await canvas.hover({ position: { x: 300, y: 200 } });
  await expect(page.locator(".lens")).toBeVisible();
  await net.check();
});

test("stops, keeps what it has, and continues to the same result", async ({ page }) => {
  await open(page);
  await quick(page);
  // an uninterrupted run first
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await idle(page);
  await expect.poll(() => state(page, (s) => s.made?.result?.reason)).toBe("converged");
  const whole = await state(page, (s) => s.made!.result!.sequences);
  // then one whose Stop button is pressed the moment it first reports progress (a run this small is over in
  // well under a second, so the press is made from inside the page)
  await page.evaluate(() => {
    const { ctl } = (window as unknown as { __i2s: { ctl: { store: { watch(pick: (s: { run: { lines: number[] } }) => number, cb: (n: number) => void): () => void } } } }).__i2s;
    const off = ctl.store.watch((s) => s.run.lines[0] ?? 0, (n) => {
      if (n < 100) return;
      off();
      document.querySelector<HTMLButtonElement>('button[data-i18n="run.stop"]')!.click();
    });
  });
  await page.getByRole("button", { name: "重新生成" }).click();
  await expect.poll(() => state(page, (s) => s.run.status === "idle" && s.made?.result?.reason), { timeout: 60_000 }).toBe("stopped");
  const part = await state(page, (s) => s.made!.result!.sequences);
  expect(part[0]!.length).toBeGreaterThan(100);
  expect(part[0]!.length).toBeLessThan(whole[0]!.length);
  expect(whole[0]!.slice(0, part[0]!.length)).toEqual(part[0]);
  await expect(page.locator(".run .issues")).toContainText("提前停止");
  await page.getByRole("button", { name: "繼續", exact: true }).click();
  await expect.poll(() => state(page, (s) => s.run.status === "idle" && s.made?.result?.reason), { timeout: 60_000 }).toBe("converged");
  expect(await state(page, (s) => s.made!.result!.sequences)).toEqual(whole);
});

test("keeps an out-of-date result until it is replaced, and can go back to its settings", async ({ page }) => {
  await open(page);
  await quick(page);
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect.poll(() => state(page, (s) => s.project.result?.reason ?? ""), { timeout: 60_000 }).toBe("converged");
  await page.getByLabel("釘數").fill("120");
  await page.getByLabel("釘數").press("Enter");
  await expect.poll(() => state(page, (s) => [s.project.frame.pins, s.project.result === null, s.made?.frame.pins])).toEqual([120, true, 96]);
  await expect(page.locator(".banner")).toBeVisible();
  await page.getByRole("button", { name: "回到它的設定" }).click();
  await expect.poll(() => state(page, (s) => [s.project.frame.pins, s.project.result !== null])).toEqual([96, true]);
  await expect(page.locator(".banner")).toBeHidden();
});

test("downloads every output, and a saved project opens to the same piece", async ({ page }) => {
  await open(page);
  await quick(page);
  await page.getByRole("button", { name: "生成", exact: true }).click();
  await expect.poll(() => state(page, (s) => s.project.result?.reason ?? ""), { timeout: 60_000 }).toBe("converged");
  const magic: [string, RegExp, (b: Buffer) => boolean][] = [
    ["下載釘位模板（PDF）", /-template\.pdf$/, (b) => b.subarray(0, 5).toString() === "%PDF-"],
    ["模板 SVG", /-template\.svg$/, (b) => b.toString().includes("<svg")],
    ["模板 DXF", /-template\.dxf$/, (b) => b.toString().includes("ENTITIES")],
    ["下載繞線說明（PDF）", /-instructions\.pdf$/, (b) => b.subarray(0, 5).toString() === "%PDF-"],
    ["繞線順序 CSV", /-instructions\.csv$/, (b) => b.toString().split("\n").length > 100],
    ["繞線順序文字檔", /-instructions\.txt$/, (b) => b.length > 500],
    ["預覽圖（PNG）", /-preview\.png$/, (b) => b.subarray(1, 4).toString() === "PNG"],
    ["線條 SVG", /-lines\.svg$/, (b) => b.toString().includes("<line") || b.toString().includes("<path")],
  ];
  for (const [label, name, check] of magic) {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label }).click()]);
    expect(download.suggestedFilename(), label).toMatch(name);
    expect(check(await save(download)), label).toBe(true);
  }
  const before = await state(page, (s) => ({ sequences: s.made!.result!.sequences, pins: s.project.frame.pins }));
  const [project] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "儲存專案" }).click()]);
  expect(project.suggestedFilename()).toMatch(/\.img2string\.json$/);
  const text = (await save(project)).toString("utf8");
  expect(JSON.parse(text).result.sequences).toEqual(before.sequences);

  await page.reload();
  await hooks(page);
  await idle(page);
  await page.locator("#project-input").setInputFiles({ name: "piece.img2string.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect.poll(() => state(page, (s) => s.made?.result?.sequences ?? null), { timeout: 30_000 }).toEqual(before.sequences);
  expect(await state(page, (s) => [s.project.frame.pins, s.project.result !== null, s.pictureMissing])).toEqual([before.pins, true, false]);
  // with the picture regenerated (a built-in sample), the numbers are measured again
  await expect.poll(() => state(page, (s) => s.result?.deltaE?.[1] ?? null), { timeout: 30_000 }).not.toBeNull();
});

test("opens an uploaded picture, crops it, and paints importance", async ({ page }) => {
  await open(page);
  // a 320 x 240 PNG made in the page: dark left half, light right half
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 240;
    const g = c.getContext("2d")!;
    g.fillStyle = "#e8e8e8";
    g.fillRect(0, 0, 320, 240);
    g.fillStyle = "#202020";
    g.fillRect(0, 0, 160, 240);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.locator("#file-input").setInputFiles({ name: "halves.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await expect.poll(() => state(page, (s) => s.source?.name ?? "")).toBe("halves.png");
  await idle(page);
  expect(await state(page, (s) => [s.source!.width, s.source!.height, s.project.image.sha256.length])).toEqual([320, 240, 64]);
  const mean = () => state(page, (s) => { const t = s.target!.target, res = s.target!.res; let l = 0, r = 0; for (let y = 40; y < res - 40; y++) { l += t[3 * (y * res + 60)]!; r += t[3 * (y * res + res - 60)]!; } return [l, r]; });
  const [left, right] = await mean();
  expect(left).toBeLessThan(right! / 5);
  // zooming keeps a picture, and dragging moves it
  const canvas = page.locator(".stage-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.wheel(0, -400);
  await expect.poll(() => state(page, (s) => s.project.image.crop.scale)).toBeGreaterThan(1.2);
  const cx = await state(page, (s) => s.project.image.crop.cx);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 200, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => state(page, (s) => s.project.image.crop.cx)).toBeLessThan(cx);
  // one brush stroke becomes one stroke in picture coordinates, and the weights change
  await page.getByText("哪裡比較重要").click();
  await page.getByLabel("在圖片上塗出重要程度").check();
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 180, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => state(page, (s) => s.project.importance.strokes.length)).toBe(1);
  await idle(page);
  expect(await state(page, (s) => { let m = 0; for (const w of s.target!.weight) m = Math.max(m, w); return m; })).toBe(2);
});

test("builds a palette: presets, an own colour kept for later, the winding order", async ({ page }) => {
  await open(page);
  // the black + white preset: two threads, white wound last, and its note about the cost
  await page.getByLabel("調色盤").selectOption("mono-black-white");
  await expect.poll(() => state(page, (s) => s.project.threads.map((t) => t.hex))).toEqual(["#111111", "#F2F2F2"]);
  await expect(page.locator(".params")).toContainText("約為三倍");
  // several colours: the spec's order, lightest first
  await page.getByRole("button", { name: "多色" }).click();
  await expect.poll(() => state(page, (s) => [s.project.mode, s.project.frame.pins, s.project.generator.res, ...s.project.threads.map((t) => t.hex)])).toEqual(["colour", 200, 240, "#FFE000", "#00A0E0", "#E0007A", "#111111"]);
  // move black to the bottom with the keyboard-reachable buttons, then back with "lightest first"
  const rows = page.locator(".threads .thread");
  for (let i = 3; i > 0; i--) await rows.nth(i).getByRole("button", { name: "提前繞" }).click();
  await expect.poll(() => state(page, (s) => s.project.threads.map((t) => t.hex))).toEqual(["#111111", "#FFE000", "#00A0E0", "#E0007A"]);
  await page.getByRole("button", { name: "由淺到深排列" }).click();
  await expect.poll(() => state(page, (s) => s.project.threads[0]!.hex)).toBe("#FFE000");
  // an own colour: typed as hex, named, kept, and still there after a reload
  await page.getByRole("button", { name: "加一條線" }).click();
  await rows.nth(4).getByLabel("線的色碼").fill("#7a4b2a");
  await rows.nth(4).getByLabel("線的色碼").press("Enter");
  await rows.nth(4).getByLabel("線的名稱").fill("walnut");
  await rows.nth(4).getByLabel("線的名稱").press("Enter");
  await expect.poll(() => state(page, (s) => s.project.threads[4])).toMatchObject({ name: "walnut", hex: "#7A4B2A" });
  await rows.nth(4).getByRole("button", { name: "把這個顏色存到我的線色" }).click();
  await expect(page.locator(".shelf .chip")).toHaveCount(1);
  await page.reload();
  await hooks(page);
  await idle(page);
  await expect(page.locator(".shelf .chip")).toContainText("walnut");
  await page.locator(".shelf .chip-use").click();
  await expect.poll(() => state(page, (s) => s.project.threads.map((t) => t.hex))).toEqual(["#111111", "#7A4B2A"]);
  await page.locator(".shelf .chip-remove").click();
  await expect(page.locator(".shelf .chip")).toHaveCount(0);
  // a first thread of the board's colour is pointed out (§14)
  await rows.nth(0).getByLabel("線的色碼").fill("#FFFFFF");
  await rows.nth(0).getByLabel("線的色碼").press("Enter");
  await expect(page.locator(".params .issues").first()).toContainText("和板子同色");
});

test("works in English", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.getByRole("button", { name: "Generate", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload picture" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download nail template (PDF)" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
