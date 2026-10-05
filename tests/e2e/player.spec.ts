// The winding player (§7.4): the keyboard, the buttons, jumping to a step, and the position remembered across
// a reload.
import { expect, test } from "@playwright/test";
import { generate, hooks, idle, open, quick, state } from "./helpers.ts";

test("steps through a piece with the keyboard and remembers where it was", async ({ page }) => {
  await open(page);
  await quick(page);
  await generate(page);
  const sequence = await state(page, (s) => s.made!.result!.sequences[0]!);
  await page.getByRole("button", { name: "開始繞線" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const pin = dialog.locator(".player-pin");
  await expect(pin).toHaveText(String(sequence[1]! + 1)); // the thread is tied on at the first pin; the big number is the next one
  await expect(dialog.locator(".player-note")).toContainText(String(sequence[0]! + 1));
  await page.keyboard.press("Space");
  await expect(pin).toHaveText(String(sequence[2]! + 1));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(pin).toHaveText(String(sequence[4]! + 1));
  await page.keyboard.press("ArrowLeft");
  await expect(pin).toHaveText(String(sequence[3]! + 1));
  await dialog.getByRole("button", { name: "下一步" }).click();
  await expect(pin).toHaveText(String(sequence[4]! + 1));
  expect(await state(page, (s) => s.made!.player.step)).toBe(3);
  // steps are numbered as on the printed instructions: the pin tied to is step 1, so this pin is step 5
  await expect(dialog.locator(".player-count")).toHaveText(`第 5／${sequence.length} 步`);
  await expect(dialog.getByLabel("這條線的第幾步")).toHaveValue("5");
  // jump to a step: the big number becomes the 41st pin of the printed sequence, with 39 lines wound before it
  await dialog.getByLabel("這條線的第幾步").fill("41");
  await dialog.getByLabel("這條線的第幾步").press("Enter");
  await expect(pin).toHaveText(String(sequence[40]! + 1));
  await expect(dialog.locator(".player-note")).toContainText(String(sequence[39]! + 1));
  await expect(dialog.locator("progress")).toHaveJSProperty("value", 39 / (sequence.length - 1));
  // Space on a focused button presses that button, not Next as well
  await dialog.getByRole("button", { name: "上一步" }).focus();
  await page.keyboard.press("Space");
  await expect(pin).toHaveText(String(sequence[39]! + 1));
  await dialog.getByRole("button", { name: "下一步" }).focus();
  await page.keyboard.press("Enter");
  await expect(pin).toHaveText(String(sequence[40]! + 1));
  // one thread: no buttons for going to another thread
  await expect(dialog.getByRole("button", { name: "下一條線" })).toBeHidden();
  // the accent is the thread's colour (§9): black thread on a light page keeps its own colour
  const colours = await dialog.evaluate((el) => [getComputedStyle(el).getPropertyValue("--accent").trim(), matchMedia("(prefers-color-scheme: dark)").matches]);
  if (!colours[1]) expect(String(colours[0]).toUpperCase()).toBe("#111111");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "從第 41 步繼續繞" })).toBeVisible();

  // the same piece opened again from its project file starts where it was left
  const text = await page.evaluate(() => (window as unknown as { __i2s: { ctl: { projectText(): { text: string } } } }).__i2s.ctl.projectText().text);
  expect(JSON.parse(text).player.step).toBe(39);
  await page.reload();
  await hooks(page);
  await idle(page);
  await page.locator("#project-input").setInputFiles({ name: "piece.img2string.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect.poll(() => state(page, (s) => s.made?.player.step ?? -1), { timeout: 30_000 }).toBe(39);
  // the end of the piece: the last step is the last pin; one more press finishes
  await page.getByRole("button", { name: "從第 41 步繼續繞" }).click();
  await dialog.getByLabel("這條線的第幾步").fill(String(sequence.length));
  await dialog.getByRole("button", { name: "前往" }).click();
  await expect(pin).toHaveText(String(sequence[sequence.length - 1]! + 1));
  await dialog.getByRole("button", { name: "下一步" }).click();
  await expect(pin).toHaveText("完成了");
  await expect(dialog.getByRole("button", { name: "下一步" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "已繞完 · 再看一次" })).toBeVisible();
});

test("a piece of several threads: the thread and its step, and going from thread to thread", async ({ page }) => {
  await open(page);
  await page.getByLabel("調色盤").selectOption("mono-black-white");
  await quick(page);
  await generate(page);
  const sequences = await state(page, (s) => s.made!.result!.sequences);
  expect(sequences.length).toBe(2);
  expect(sequences[1]!.length).toBeGreaterThan(2);
  await page.getByRole("button", { name: "開始繞線" }).click();
  const dialog = page.getByRole("dialog"), pin = dialog.locator(".player-pin"), count = dialog.locator(".player-count");
  await expect(count).toHaveText(`第 1／2 條線 · 第 2／${sequences[0]!.length} 步`);
  await expect(dialog.getByRole("button", { name: "上一條線" })).toBeDisabled();
  await dialog.getByRole("button", { name: "下一條線" }).click();
  // the second thread is tied on at its first pin, after the first one is cut
  await expect(count).toHaveText(`第 2／2 條線 · 第 2／${sequences[1]!.length} 步`);
  await expect(pin).toHaveText(String(sequences[1]![1]! + 1));
  await expect(dialog.locator(".player-note")).toContainText("剪線");
  await expect(dialog.getByRole("button", { name: "下一條線" })).toBeDisabled();
  expect(await state(page, (s) => s.made!.player.step)).toBe(sequences[0]!.length - 1);
  // the step typed is a step of the thread shown
  await dialog.getByLabel("這條線的第幾步").fill("3");
  await dialog.getByLabel("這條線的第幾步").press("Enter");
  await expect(pin).toHaveText(String(sequences[1]![2]! + 1));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "從第 2 條線的第 3 步繼續繞" })).toBeVisible();
  await page.getByRole("button", { name: "從第 2 條線的第 3 步繼續繞" }).click();
  await dialog.getByRole("button", { name: "上一條線" }).click();
  await expect(count).toHaveText(`第 1／2 條線 · 第 2／${sequences[0]!.length} 步`);
  expect(await state(page, (s) => s.made!.player.step)).toBe(0);
});
