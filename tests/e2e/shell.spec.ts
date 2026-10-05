import { expect, test } from "@playwright/test";
import { watchNetwork } from "./helpers.ts";

test("the page loads only its own files and obeys its CSP", async ({ page, context, baseURL }) => {
  const net = await watchNetwork(page, context, baseURL!);
  await page.goto("./");
  await expect(page).toHaveTitle(/img2string/);
  await expect(page.locator("#app")).not.toHaveAttribute("aria-busy", "true");
  await net.check();
});

test("switches language and remembers the choice", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-TW");
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("img2string: string art from a picture");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("button", { name: "EN", exact: true })).toHaveAttribute("aria-pressed", "true");
});
