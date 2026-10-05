// M2 in the built page (spec §13.5): the gamut check and choosing threads, automatic emphasis and repeats,
// thread calibration from a photograph, and the voice readout with on-device voices only.
import { expect, test, type Page } from "@playwright/test";
import { encodePng } from "../../src/export/png.ts";
import { generate, idle, open, quick, state, watchNetwork } from "./helpers.ts";

test("colour: says which colours the threads cannot mix, adds the missing thread, and lets the picture choose", async ({ page, context, baseURL }) => {
  const net = await watchNetwork(page, context, baseURL!);
  await open(page);
  // mono mode has no gamut tools
  await expect(page.locator(".gamut")).toBeHidden();
  await page.getByRole("button", { name: "色環" }).click();
  await page.getByRole("button", { name: "多色" }).click();
  await idle(page);
  // the colour wheel with cyan, magenta, yellow and black: the greens and blues are out of reach
  const before = await state(page, (s) => s.target!.gamut!.outShare);
  expect(before).toBeGreaterThan(0.3);
  await expect(page.locator(".gamut-status")).toContainText("混不出來");
  await expect(page.locator(".gamut-status")).toContainText("綠色");
  expect(await page.locator(".gamut-list li").count()).toBeGreaterThan(1);
  expect(await state(page, (s) => { let n = 0; const a = s.target!.gamutRgba!; for (let i = 3; i < a.length; i += 4) if (a[i]! > 0) n++; return n / (a.length / 4); })).toBeGreaterThan(0.2);
  await expect(page.locator(".legend")).toContainText("斜線");
  await page.getByLabel("在圖片上用斜線標出混不出來的地方").uncheck();
  expect(await state(page, (s) => s.view.gamut)).toBe(false);
  await expect(page.locator(".legend")).not.toContainText("斜線");
  // the suggested thread goes where its lightness belongs (after yellow) and brings a good part within reach
  await page.getByRole("button", { name: /^加一條綠色的線/ }).click();
  await idle(page);
  expect(await state(page, (s) => s.project.threads.length)).toBe(5);
  expect(await state(page, (s) => [s.project.threads[0]!.hex, s.project.threads[1]!.name])).toEqual(["#FFE000", "綠色"]);
  const after = await state(page, (s) => s.target!.gamut!.outShare);
  expect(after).toBeLessThan(0.7 * before);
  // the picture's own choice of three threads; "my thread colours" is not offered while there are none
  await expect(page.getByLabel("從哪裡選").locator("option[value=shelf]")).toBeDisabled();
  await page.getByLabel("選幾條線").fill("3");
  await page.getByLabel("選幾條線").press("Enter");
  await page.getByRole("button", { name: "選出線色" }).click();
  await expect(page.locator("#toast")).toContainText("已選出 3 條線");
  await idle(page);
  const three = await state(page, (s) => s.project.threads.map((t) => t.hex));
  expect(three).toHaveLength(3);
  expect(new Set(three).size).toBe(3);
  expect(await state(page, (s) => s.target!.gamut!.outShare)).toBeLessThan(before);
  // a colour kept in the personal list can be the source, and a list of one gives a palette of one
  await page.locator(".threads .thread").nth(0).getByRole("button", { name: "把這個顏色存到我的線色" }).click();
  await page.getByLabel("從哪裡選").selectOption("shelf");
  await page.getByRole("button", { name: "選出線色" }).click();
  await idle(page);
  expect(await state(page, (s) => s.project.threads.map((t) => t.hex))).toEqual([three[0]]);
  await net.check();
});

/** Presses a key on a slider `times` times; the value is committed when the key is released. */
async function nudge(page: Page, label: string, key: string, times: number): Promise<void> {
  const slider = page.getByLabel(label, { exact: true });
  await slider.focus();
  for (let i = 0; i < times; i++) await slider.press(key);
}

test("emphasis taken from the picture changes the weights, and repeats stay within three", async ({ page }) => {
  await open(page);
  await quick(page);
  const max = () => state(page, (s) => s.target!.weight.reduce((a, b) => Math.max(a, b), 0));
  expect(await max()).toBe(1);
  await page.locator("details", { hasText: "哪裡比較重要" }).locator("summary").click();
  await nudge(page, "強調輪廓", "ArrowRight", 4);
  await expect.poll(() => state(page, (s) => s.project.importance.edges)).toBe(1);
  await idle(page);
  expect(await max()).toBe(2); // 1 + 100 % on the outlines of the face
  await nudge(page, "強調深色細節", "ArrowRight", 10);
  await expect.poll(() => state(page, (s) => s.project.importance.tone)).toBe(0.5);
  await idle(page);
  expect(await max()).toBeGreaterThan(2.5); // the dark outlines weigh most of all
  // the overlay on the picture never hides it: its alpha is capped
  expect(await state(page, (s) => { let m = 0; const a = s.target!.weightRgba; for (let i = 3; i < a.length; i += 4) m = Math.max(m, a[i]!); return m; })).toBeLessThanOrEqual(170);
  await nudge(page, "強調輪廓", "Home", 1);
  await nudge(page, "強調深色細節", "Home", 1);
  await expect.poll(() => state(page, (s) => [s.project.importance.edges, s.project.importance.tone])).toEqual([0, 0]);
  await idle(page);
  expect(await max()).toBe(1);

  // repeats: a dark picture, so that one thread wants the same pin pair again
  await page.locator("details", { hasText: "精細度" }).locator("summary").click();
  await page.locator("details", { hasText: "調整圖片" }).locator("summary").click();
  await page.getByLabel("同一對釘子可以重複繞（最多 3 次）").check();
  await nudge(page, "亮度", "ArrowLeft", 40);
  await expect.poll(() => state(page, (s) => [s.project.generator.allowRepeat, s.project.adjust.brightness])).toEqual([true, -0.4]);
  await idle(page);
  await generate(page);
  const uses = await state(page, (s) => {
    const count = new Map<number, number>(), q = s.made!.result!.sequences[0]!, pins = s.made!.frame.pins;
    for (let i = 1; i < q.length; i++) {
      const key = Math.min(q[i - 1]!, q[i]!) * pins + Math.max(q[i - 1]!, q[i]!);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    return Math.max(...count.values());
  });
  expect(uses).toBeGreaterThan(1);
  expect(uses).toBeLessThanOrEqual(3);
});

/** A photograph for the calibration: bare white board on the left; on the right the even grey that #111111
 * threads covering `coverage` of a white board average to (in linear light), so any part framed measures alike. */
function patchPhoto(coverage: number): Buffer {
  const w = 400, h = 300, px = new Uint8Array(3 * w * h).fill(255);
  const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), encoded = (l: number) => (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
  const grey = Math.round(255 * encoded(1 - coverage + coverage * linear(0x11 / 255)));
  for (let y = 0; y < h; y++) px.fill(grey, 3 * (y * w + 200), 3 * (y * w + w));
  return Buffer.from(encodePng(px, w, h, 3));
}

test("thread width: the presets, and the width measured from a photograph of a test patch", async ({ page, context, baseURL }) => {
  const net = await watchNetwork(page, context, baseURL!);
  await open(page);
  const kind = page.getByLabel("線的種類");
  await expect(kind).toHaveValue("standard");
  await kind.selectOption("floss");
  await expect.poll(() => state(page, (s) => s.project.thread.widthMm)).toBe(0.4);
  await page.getByLabel("線寬", { exact: true }).fill("0.3");
  await page.getByLabel("線寬", { exact: true }).press("Enter");
  await expect(kind).toHaveValue("custom");

  await page.getByRole("button", { name: "用照片量線寬…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "使用這個線寬" })).toBeDisabled();
  await dialog.locator("#calib-input").setInputFiles({ name: "patch.png", mimeType: "image/png", buffer: patchPhoto(0.25) });
  const canvas = dialog.locator(".calib-canvas");
  await expect(canvas).toBeVisible();
  await expect(dialog.locator(".calib-result")).toContainText("請框出板子和線各一塊");
  const box = (await canvas.boundingBox())!;
  const mark = async (x0: number, x1: number) => {
    await page.mouse.move(box.x + x0 * box.width, box.y + 0.1 * box.height);
    await page.mouse.down();
    await page.mouse.move(box.x + x1 * box.width, box.y + 0.9 * box.height, { steps: 4 });
    await page.mouse.up();
  };
  // the bare board first; the wizard then expects the threads
  await mark(0.05, 0.45);
  await expect(dialog.getByRole("button", { name: "線", exact: true })).toHaveAttribute("aria-pressed", "true");
  await mark(0.55, 0.95);
  // 20 threads over 40 mm covering a quarter of the board: 0.25 x 40 / 20 = 0.5 mm
  await dialog.getByLabel("排在多寬的範圍").fill("40");
  await dialog.getByLabel("排在多寬的範圍").press("Enter");
  await expect(dialog.locator(".calib-result")).toContainText("有效線寬約 0.50 mm（線蓋住 25% 的面積）");
  // the two frames swapped: the "threads" are lighter than the "board", which cannot be
  await dialog.getByRole("button", { name: "板子", exact: true }).click();
  await mark(0.55, 0.95);
  await dialog.getByRole("button", { name: "線", exact: true }).click();
  await mark(0.05, 0.45);
  await expect(dialog.locator(".calib-result")).toContainText("幾乎一樣亮");
  await expect(dialog.getByRole("button", { name: "使用這個線寬" })).toBeDisabled();
  // marked again the right way round (the wizard moves on to the threads by itself only the first time)
  await dialog.getByRole("button", { name: "板子", exact: true }).click();
  await mark(0.05, 0.45);
  await dialog.getByRole("button", { name: "線", exact: true }).click();
  await mark(0.55, 0.95);
  await expect(dialog.locator(".calib-result")).toContainText("0.50 mm");
  await dialog.getByRole("button", { name: "使用這個線寬" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => state(page, (s) => s.project.thread.widthMm)).toBe(0.5);
  await expect(page.locator("#toast")).toContainText("0.5 mm");
  // threads lying too close together are told apart from a wide thread
  await page.getByRole("button", { name: "用照片量線寬…" }).click();
  await dialog.locator("#calib-input").setInputFiles({ name: "dense.png", mimeType: "image/png", buffer: patchPhoto(0.9) });
  await mark(0.05, 0.45);
  await mark(0.55, 0.95);
  await expect(dialog.locator(".calib-result")).toContainText("線太密了");
  await net.check();
});

/** Replaces the browser's speech synthesis by one that records what it is asked to say. */
async function fakeVoices(page: Page, voices: { name: string; lang: string; localService: boolean }[]): Promise<void> {
  await page.addInitScript((list) => {
    const spoken: [string, string][] = [];
    (window as unknown as { __spoken: typeof spoken }).__spoken = spoken;
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { getVoices: () => list, speak: (u: { text: string; voice: { name: string } | null }) => spoken.push([u.text, u.voice?.name ?? ""]), cancel() {}, addEventListener() {} },
    });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = function (this: { text: string }, text: string) { this.text = text; };
  }, voices);
}
const spoken = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: [string, string][] }).__spoken);

test("the player reads the pins aloud, with a voice of the device only", async ({ page }) => {
  await fakeVoices(page, [{ name: "Network zh", lang: "zh-TW", localService: false }, { name: "Device en", lang: "en-US", localService: true }, { name: "Device zh", lang: "zh-TW", localService: true }]);
  await open(page);
  await quick(page);
  await generate(page);
  const sequence = await state(page, (s) => s.made!.result!.sequences[0]!);
  await page.getByRole("button", { name: "開始繞線" }).click();
  const dialog = page.getByRole("dialog"), voice = dialog.getByLabel("唸出釘號");
  await expect(voice).toBeEnabled();
  await expect(voice).not.toBeChecked(); // off until asked for
  expect(await spoken(page)).toEqual([]);
  await voice.check();
  await expect.poll(() => spoken(page)).toEqual([[`綁在 ${sequence[0]! + 1} 號，繞到 ${sequence[1]! + 1} 號`, "Device zh"]]);
  await dialog.getByRole("button", { name: "下一步" }).click();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => spoken(page)).toEqual([
    [`綁在 ${sequence[0]! + 1} 號，繞到 ${sequence[1]! + 1} 號`, "Device zh"], [String(sequence[2]! + 1), "Device zh"], [String(sequence[3]! + 1), "Device zh"],
  ]);
  // the choice is remembered on this device, and the page's language chooses the voice
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("button", { name: /^Continue winding/ }).click();
  await expect(dialog.getByLabel("Read the pin numbers aloud")).toBeChecked();
  await expect.poll(async () => (await spoken(page)).at(-1)).toEqual([String(sequence[3]! + 1), "Device en"]);
  await dialog.getByLabel("Read the pin numbers aloud").uncheck();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  expect(await spoken(page)).toHaveLength(4);
});

test("without a voice of the device the readout is not offered", async ({ page }) => {
  await fakeVoices(page, [{ name: "Network zh", lang: "zh-TW", localService: false }, { name: "Device ja", lang: "ja-JP", localService: true }]);
  await open(page);
  await quick(page);
  await generate(page);
  await page.getByRole("button", { name: "開始繞線" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("唸出釘號")).toBeDisabled();
  await expect(dialog.locator(".player-voice")).toContainText("沒有可離線使用的語音");
  await dialog.getByRole("button", { name: "下一步" }).click();
  expect(await spoken(page)).toEqual([]);
});
