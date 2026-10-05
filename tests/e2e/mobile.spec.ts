// A phone (§8 "Mobile: stacked"): one column, the canvas first, nothing wider than the screen, and the player
// usable by touch.
import { expect, test } from "@playwright/test";
import { generate, open, quick } from "./helpers.ts";

test("stacks into one column without sideways scrolling", async ({ page }) => {
  await open(page);
  const boxes = await page.evaluate(() => ["views", "params", "export"].map((c) => {
    const r = document.querySelector(`.col.${c}`)!.getBoundingClientRect();
    return { top: Math.round(r.top + scrollY), left: Math.round(r.left), width: Math.round(r.width) };
  }));
  const width = page.viewportSize()!.width;
  expect(boxes[0]!.top).toBeLessThan(boxes[1]!.top); // the canvas comes first
  expect(boxes[1]!.top).toBeLessThan(boxes[2]!.top);
  for (const b of boxes) {
    expect(b.left).toBe(0);
    expect(b.width).toBe(width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test("the player works by touch", async ({ page }) => {
  await open(page);
  await quick(page);
  await generate(page);
  await page.getByRole("button", { name: "開始繞線" }).tap();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const pin = dialog.locator(".player-pin");
  const first = await pin.textContent();
  await dialog.getByRole("button", { name: "下一步" }).tap();
  await expect(pin).not.toHaveText(first!);
  await dialog.getByRole("button", { name: "上一步" }).tap();
  await expect(pin).toHaveText(first!);
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
