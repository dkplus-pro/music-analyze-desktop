import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const samplePath = fileURLToPath(new URL("../sample/10%20%E5%B8%8C%E6%9C%9B.mp3", import.meta.url));

test("imports a browser-selected file and reports a duplicate from the live API", async ({
  page,
  request
}) => {
  const imported = await request.post("http://127.0.0.1:13001/api/import", {
    data: { originalFilename: "10 希望.mp3", sourcePath: samplePath }
  });
  expect([200, 201]).toContain(imported.status());

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "音乐管理" })).toBeVisible();
  await expect(page.getByText("10 希望")).toBeVisible();

  await page.getByRole("button", { name: "导入音乐" }).click();
  await expect(page.getByRole("button", { name: "选择文件夹" })).toBeVisible();
  await page.getByLabel("导入音频", { exact: true }).setInputFiles(samplePath);
  await expect(page.getByRole("status")).toHaveText("已存在：该音乐的内容哈希已在资料库中。");
});

test("opens a two-column detail dialog without browser overflow", async ({ page, request }) => {
  const imported = await request.post("http://127.0.0.1:13001/api/import", {
    data: { originalFilename: "10 希望.mp3", sourcePath: samplePath }
  });
  expect([200, 201]).toContain(imported.status());

  await page.goto("/");
  await page.getByRole("button", { name: /10 希望/ }).click();

  const dialog = page.getByRole("dialog", { name: "音轨详情" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(dialog.getByText(/分析摘要：这是一首以/)).toBeVisible();
  await expect
    .poll(() =>
      dialog
        .locator("dl")
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)
    )
    .toBe(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);

  await dialog.getByRole("button", { name: "关闭详情" }).click();
  await expect(page.locator("body")).toHaveCSS("overflow", "visible");
});
