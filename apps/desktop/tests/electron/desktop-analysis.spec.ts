import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";

test("analyzes a sample file without copying or deleting the source", async () => {
  const repositoryRoot = resolve(dirname(new URL(import.meta.url).pathname), "../../../..");
  const releaseRoot = join(repositoryRoot, "apps/desktop/release");
  const platformName = process.platform === "darwin" ? "mac" : process.platform;
  const platformDirectory = join(releaseRoot, `${platformName}-${process.arch}`);
  const bundleName = (await readdir(platformDirectory)).find((entry) => entry.endsWith(".app"));
  if (!bundleName) throw new Error(`No Electron app bundle found in ${platformDirectory}`);

  const executablePath = join(
    platformDirectory,
    bundleName,
    "Contents/MacOS",
    bundleName.slice(0, -4)
  );
  const samplePath = join(repositoryRoot, "tests/sample/10 希望.mp3");
  const sourceBefore = await snapshot(samplePath);
  const userDataPath = await mkdtemp(join(tmpdir(), "analyze-music-electron-"));
  const electronApp = await electron.launch({
    args: [`--user-data-dir=${userDataPath}`],
    executablePath
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByRole("heading", { name: "音乐管理" })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (globalThis as unknown as { musicDesktop?: { isAvailable?: boolean } }).musicDesktop
            ?.isAvailable
      )
    ).toBe(true);
    expect(await realpath(await electronApp.evaluate(({ app }) => app.getPath("userData")))).toBe(
      await realpath(userDataPath)
    );

    await electronApp.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
    }, samplePath);

    await page.getByRole("button", { name: "导入音乐" }).click();
    const importButton = page.getByRole("button", { name: /选择本地音频文件/ });
    const importResponsePromise = page.waitForResponse(
      (response) => response.url().endsWith("/api/import") && response.request().method() === "POST"
    );
    await importButton.click();
    const importResponse = await importResponsePromise;
    const importRequest = importResponse.request().postDataJSON() as {
      sourcePath: string;
      storageMode: string;
    };
    expect(importRequest).toMatchObject({ sourcePath: samplePath, storageMode: "LINKED_SOURCE" });

    await expect(page.getByText("已记录源文件并提交分析，源文件不会被复制或删除。")).toBeVisible();
    await expect(page.getByLabel("音乐列表").getByText("已完成", { exact: true })).toBeVisible({
      timeout: 210_000
    });

    const managedRoot = join(userDataPath, "managed-audio");
    const managedFiles = await listFilesIfPresent(managedRoot);
    expect(managedFiles).toEqual([]);
  } finally {
    await electronApp.close();
    expect(await snapshot(samplePath)).toEqual(sourceBefore);
    await rm(userDataPath, { force: true, recursive: true });
  }
});

async function snapshot(filePath: string) {
  const [contents, info] = await Promise.all([readFile(filePath), stat(filePath)]);
  return {
    hash: createHash("sha256").update(contents).digest("hex"),
    mode: info.mode,
    size: info.size,
    mtimeMs: info.mtimeMs
  };
}

async function listFilesIfPresent(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}
