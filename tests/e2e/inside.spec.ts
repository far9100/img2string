// Pins inside the picture, in the built page (DECISIONS D-60, D-61): a line drawing is offered them in one press;
// they are placed with the target and drawn on it; the piece, the nail template, the instructions and the
// player go by the piece's own pins; nothing that leaves the pins where they are moves them; and a project
// saved with such a piece opens to the same piece without its picture.
import { expect, test, type Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { TestHooks } from "../../src/app/testHooks.ts";
import { allowedPairs, isRound, pinOf } from "../../src/core/frame.ts";
import { generate, idle, open, quick, state } from "./helpers.ts";

const save = async (download: Download): Promise<Buffer> => readFile((await download.path())!);

/** A 480 x 480 line drawing made in the page: a few dark outlines, four pixels wide, on white. */
const drawing = (page: Parameters<typeof state>[0]) => page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 480;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 480, 480);
  g.strokeStyle = "#141414";
  g.lineWidth = 4;
  g.beginPath();
  g.arc(210, 230, 120, 0, 2 * Math.PI);
  g.moveTo(90, 120);
  g.bezierCurveTo(180, 60, 300, 180, 400, 100);
  g.moveTo(120, 380);
  g.lineTo(380, 400);
  g.stroke();
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
});

test("pins inside the picture: offered for a line drawing, placed with the target, and the whole piece goes by them", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  await quick(page);
  await page.locator("#file-input").setInputFiles({ name: "drawing.png", mimeType: "image/png", buffer: Buffer.from(await drawing(page)) });
  await expect.poll(() => state(page, (s) => s.source?.name ?? "")).toBe("drawing.png");
  await idle(page);

  // a picture that is mostly bare board is told about them, with the number that was measured one press away
  await expect(page.locator(".tune .sparse")).toBeVisible();
  await page.getByRole("button", { name: "在畫面裡加 300 根釘子" }).click();
  await expect.poll(() => state(page, (s) => s.project.frame.inside ?? 0)).toBe(300);
  await idle(page);
  await expect(page.locator(".tune .sparse")).toBeHidden();
  // this drawing has not room for 300 of them 6 mm apart: the page says how many stand
  const fit = await state(page, (s) => s.target!.inside.length / 2);
  expect(fit).toBeGreaterThan(60);
  expect(fit).toBeLessThan(300);
  await expect(page.locator(".inside-note")).toHaveText(`這張圖只放得下 ${fit} 根（要了 300 根），彼此和框線至少相距 6 mm。`);

  const field = page.getByLabel("畫面內的釘子");
  await field.fill("40");
  await field.press("Enter");
  await expect.poll(() => state(page, (s) => s.project.frame.inside ?? 0)).toBe(40);
  await idle(page);
  await expect(page.locator(".inside-note")).toHaveText("已放 40 根，彼此和框線至少相距 6 mm。圖上的小點就是它們。");
  const placed = await state(page, (s) => s.target!.inside);
  expect(placed).toHaveLength(80);
  for (const v of placed) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(1); }
  expect(await state(page, (s) => s.project.frame)).toEqual({ shape: "circle", diameterMm: 500, pins: 96, pinDiameterMm: 1.5, inside: 40 });
  // a pair of pins is drawn once on such a piece, so the repeat setting is out of use
  await expect(page.getByLabel("同一對釘子可以重複繞（最多 3 次）")).toBeDisabled();
  // the nails to buy count them before there is a piece
  await expect(page.locator(".materials")).toContainText("136 根，長約 25 mm");
  await expect(page.locator(".materials")).toContainText("框上 96 根、畫面內 40 根");
  // the nail template is the piece's own: there is none before there is a piece
  await expect(page.getByRole("button", { name: "模板 SVG" })).toBeDisabled();
  await expect(page.getByText("畫面裡有釘子時，模板是做好的那一件作品的")).toBeVisible();

  await generate(page);
  const made = await state(page, (s) => ({ frame: s.made!.frame, inside: s.made!.result!.inside ?? [], sequence: s.made!.result!.sequences[0]!, minSkip: s.made!.generator.minSkip }));
  expect(made.frame).toEqual({ shape: "circle", diameterMm: 500, pins: 96, pinDiameterMm: 1.5, inside: 40 });
  expect(made.inside).toEqual(placed);
  // every step is a line the pins allow, or a way round the frame between two of its pins
  const N = 96 + 40, ok = allowedPairs({ pins: 96, minSkip: made.minSkip, inside: made.inside });
  expect(made.sequence.length).toBeGreaterThan(40);
  for (let i = 1; i < made.sequence.length; i++) {
    const u = pinOf(made.sequence[i - 1]!), v = pinOf(made.sequence[i]!);
    expect(v).toBeLessThan(N);
    if (isRound(made.sequence[i]!)) expect(u < 96 && v < 96).toBe(true);
    else expect(ok[u * N + v], `the line ${u}-${v}`).toBe(1);
  }
  expect(made.sequence.some((entry) => pinOf(entry) >= 96)).toBe(true);
  await expect.poll(() => state(page, (s) => s.result?.similarity ?? null), { timeout: 60_000 }).not.toBeNull();
  await expect(page.locator(".materials")).toContainText("136 根，長約 25 mm");
  await expect(page.locator(".materials")).toContainText("框上 96 根、畫面內 40 根");
  await expect(page.getByText("畫面裡有釘子時，模板是做好的那一件作品的")).toBeHidden();

  // the files: every pin on the template, the pins' own hints and the way each is reached in the instructions
  const get = async (label: string) => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: label }).click()]);
    return save(download);
  };
  const svg = (await get("模板 SVG")).toString();
  expect(/<g id="pins">([\s\S]*?)<\/g>/.exec(svg)![1]!.match(/<circle/g)).toHaveLength(136);
  expect(svg).toContain(">136</text>");
  expect((await get("模板 DXF")).toString().split("CIRCLE\r\n8\r\nPINS")).toHaveLength(137);
  expect((await get("下載釘位模板（PDF）")).subarray(0, 5).toString()).toBe("%PDF-");
  const csv = (await get("繞線順序 CSV")).toString().replace(/^﻿/, "").split("\r\n");
  expect(csv[0]).toBe("thread,name,hex,step,pin,clock,move");
  expect(csv).toHaveLength(made.sequence.length + 2);
  expect(csv.some((line) => /,x\d+y\d+,line$/.test(line))).toBe(true);
  const txt = (await get("繞線順序文字檔")).toString();
  expect(txt).toContain("圓框 500 mm · 96 釘");
  expect(txt).toContain("· 畫面內 40 釘");
  expect(txt).toContain("編號接在框上的釘子後面，從 97 到 136");
  expect(txt).not.toMatch(/NaN|undefined/);
  expect((await get("下載繞線說明（PDF）")).subarray(0, 5).toString()).toBe("%PDF-");
  const lines = (await get("線條 SVG")).toString();
  expect(lines.match(/<line /g)).toHaveLength(made.sequence.length - 1 - made.sequence.filter(isRound).length);
  expect(lines).not.toMatch(/NaN|undefined/);
  const png = await get("預覽圖（PNG）");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2000, 2000]);

  // the player: a pin inside by its millimetres and a close-up of its neighbours; a step round the frame said as one
  await page.getByRole("button", { name: "開始繞線" }).click();
  const step = (position: number) => page.evaluate((at) => (window as unknown as { __i2s: TestHooks }).__i2s.ctl.setPlayerStep(at), position);
  const inner = made.sequence.findIndex((entry, i) => i > 0 && !isRound(entry) && entry >= 96);
  await step(inner - 1);
  await expect(page.locator(".player-pin")).toHaveText(String(made.sequence[inner]! + 1));
  await expect(page.locator(".player-clock")).toHaveText(/^在畫面裡：從框的最左邊往右 \d+ mm，從最上邊往下 \d+ mm$/);
  await expect(page.locator(".player-near")).toBeVisible();
  const walk = made.sequence.findIndex(isRound);
  if (walk > 0) {
    await step(walk - 1);
    await expect(page.locator(".player-pin")).toHaveText(String(pinOf(made.sequence[walk]!) + 1));
    await expect(page.locator(".player-note")).toHaveText(new RegExp(`^從第 ${pinOf(made.sequence[walk - 1]!) + 1} 號釘沿著框的外側[順逆]時針繞到（不穿過畫面）$`));
    await expect(page.locator(".player-clock")).toHaveText(/^約在鐘面 \d+:\d\d 的位置$/);
  }
  await page.keyboard.press("Escape");

  // Nothing that leaves the pins where they are moves them: another working resolution asks for a new target,
  // and the new piece stands on the same pins (the board may be full of nails by now).
  await page.evaluate(() => (window as unknown as { __i2s: TestHooks }).__i2s.ctl.set(["generator", "res"], 100));
  await idle(page);
  expect(await state(page, (s) => [s.project.result === null, s.target!.res])).toEqual([true, 100]);
  expect(await page.evaluate(() => (window as unknown as { __i2s: TestHooks }).__i2s.ctl.pinsFor())).toEqual(placed);
  expect(await state(page, (s) => s.target!.inside)).toEqual(placed);
  await generate(page);
  expect(await state(page, (s) => [s.made!.generator.res, s.made!.result!.inside])).toEqual([100, placed]);
  const again = await state(page, (s) => s.made!.result!.sequences);

  // saved with its piece, and opened without the picture: the same piece, its pins with it, its template still to be had
  const [project] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "儲存專案" }).click()]);
  const text = (await save(project)).toString("utf8"), file = JSON.parse(text) as { frame: { inside: number }; result: { inside: number[]; sequences: number[][] } };
  expect([file.frame.inside, file.result.inside, file.result.sequences]).toEqual([40, placed, again]);
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __i2s?: TestHooks }).__i2s);
  await idle(page);
  await page.locator("#project-input").setInputFiles({ name: "drawing.img2string.json", mimeType: "application/json", buffer: Buffer.from(text) });
  await expect.poll(() => state(page, (s) => s.made?.result?.sequences ?? null), { timeout: 30_000 }).toEqual(again);
  expect(await state(page, (s) => [s.pictureMissing, s.made!.result!.inside, s.project.frame.inside])).toEqual([true, placed, 40]);
  const reopened = (await get("模板 SVG")).toString();
  expect(/<g id="pins">([\s\S]*?)<\/g>/.exec(reopened)![1]!.match(/<circle/g)).toHaveLength(136);
  await expect(page.locator(".materials")).toContainText("框上 96 根、畫面內 40 根");
});

test("several colours with pins inside: the budgets go with the pins, and a picture in greys is wound in black", async ({ page }) => {
  test.setTimeout(240_000);
  await open(page);
  // the face sample is all greys; yellow, cyan, magenta and black on a white board, at settings small enough for a test
  await page.getByRole("button", { name: "臉", exact: true }).click();
  await idle(page);
  await page.evaluate(() => {
    const { ctl } = (window as unknown as { __i2s: TestHooks }).__i2s;
    ctl.applyPreset("colour-cmyk");
    ctl.commit({ ...ctl.state.project, frame: { ...ctl.state.project.frame, pins: 96 }, generator: { ...ctl.state.project.generator, res: 120, minSkip: 8 } });
  });
  await idle(page);
  const budgets = () => state(page, (s) => s.project.threads.map((t) => t.maxLines));
  expect(await budgets()).toEqual([1500, 1500, 1500, 1500]);

  // a piece with pins inside takes about twice the steps: the budgets a project starts with go up with them
  const field = page.getByLabel("畫面內的釘子");
  await field.fill("60");
  await field.press("Enter");
  await expect.poll(() => state(page, (s) => s.project.frame.inside ?? 0)).toBe(60);
  await idle(page);
  expect(await budgets()).toEqual([4000, 4000, 4000, 4000]);
  await field.fill("0");
  await field.press("Enter");
  await expect.poll(() => state(page, (s) => s.project.frame.inside ?? 0)).toBe(0);
  expect(await budgets()).toEqual([1500, 1500, 1500, 1500]);
  // one the user has set stays
  await page.evaluate(() => (window as unknown as { __i2s: TestHooks }).__i2s.ctl.setThread(3, { maxLines: 700 }));
  await field.fill("60");
  await field.press("Enter");
  await expect.poll(() => state(page, (s) => s.project.frame.inside ?? 0)).toBe(60);
  await idle(page);
  expect(await budgets()).toEqual([4000, 4000, 4000, 700]);

  // The black thread runs out long before the face is done. No other colour draws what is left to it: the
  // piece is black on white, and the page says whose budget ran out.
  await generate(page);
  const lines = await state(page, (s) => s.made!.result!.lines);
  expect(lines[3]).toBe(700);
  expect(lines[0]! + lines[1]! + lines[2]!).toBeLessThan(140);
  await expect(page.getByText("線數上限用完了，但還有線能改善結果（黑）")).toBeVisible();
});
