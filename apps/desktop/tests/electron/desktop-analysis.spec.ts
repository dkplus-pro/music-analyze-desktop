import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  cp,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { _electron as electron, expect, test } from "@playwright/test";

const execFileAsync = promisify(execFile);

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
  const bundledToolBin = join(platformDirectory, bundleName, "Contents/Resources/tools/bin");
  const [ffmpegDependencies, ffprobeDependencies] = await Promise.all(
    ["ffmpeg", "ffprobe"].map(async (tool) =>
      execFileAsync("otool", ["-L", join(bundledToolBin, tool)]).then(({ stdout }) => stdout)
    )
  );
  expect(ffmpegDependencies).not.toMatch(/\/(?:opt\/homebrew|usr\/local\/(?:opt|Cellar))/);
  expect(ffprobeDependencies).not.toMatch(/\/(?:opt\/homebrew|usr\/local\/(?:opt|Cellar))/);
  const samplePath = join(repositoryRoot, "tests/sample/10 希望.mp3");
  const sourceBefore = await snapshot(samplePath);
  const userDataPath = await mkdtemp(join(tmpdir(), "analyze-music-electron-"));
  await seedStaleRuntime({ bundleName, platformDirectory, userDataPath });
  const electronApp = await electron.launch({
    args: [`--user-data-dir=${userDataPath}`],
    env: {
      ...process.env,
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin"
    },
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
    expect(
      await page.evaluate(() =>
        Boolean(
          (
            globalThis as unknown as {
              musicDesktop?: { openTrack?: unknown; showTrackInFolder?: unknown };
            }
          ).musicDesktop?.openTrack &&
          (
            globalThis as unknown as {
              musicDesktop?: { openTrack?: unknown; showTrackInFolder?: unknown };
            }
          ).musicDesktop?.showTrackInFolder
        )
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
    expect(importResponse.status()).toBe(201);
    const importRequest = importResponse.request().postDataJSON() as {
      sourcePath: string;
      storageMode: string;
    };
    expect(importRequest).toMatchObject({ sourcePath: samplePath, storageMode: "LINKED_SOURCE" });

    const importNotice = "已记录源文件并提交分析，源文件不会被复制或删除。";
    await expect(page.getByText(importNotice)).toBeVisible();
    await expect(page.getByLabel("音乐列表").getByText("已完成", { exact: true })).toBeVisible({
      timeout: 210_000
    });
    await electronApp.evaluate(({ shell }) => {
      const observedPaths: { opened: string | null; revealed: string | null } = {
        opened: null,
        revealed: null
      };
      (globalThis as unknown as { observedPaths?: typeof observedPaths }).observedPaths =
        observedPaths;
      shell.openPath = async (sourcePath) => {
        observedPaths.opened = sourcePath;
        return "";
      };
      shell.showItemInFolder = (sourcePath) => {
        observedPaths.revealed = sourcePath;
      };
    });
    await page.locator(".track-name").first().click();
    await page.getByRole("button", { name: "打开所在文件夹" }).click();
    await expect(page.locator(".notice")).toHaveText(importNotice);
    await expect
      .poll(() =>
        electronApp.evaluate(
          () => (globalThis as unknown as { observedPaths?: unknown }).observedPaths
        )
      )
      .toEqual({ opened: samplePath, revealed: samplePath });

    await page.close();
    const reopenedWindow = electronApp.waitForEvent("window");
    await electronApp.evaluate(({ app }) => app.emit("activate"));
    const reopenedPage = await reopenedWindow;
    await expect(reopenedPage.getByRole("heading", { name: "音乐管理" })).toBeVisible();
    await electronApp.evaluate(() => {
      const observedPaths = (
        globalThis as unknown as {
          observedPaths?: { opened: string | null; revealed: string | null };
        }
      ).observedPaths;
      if (!observedPaths) throw new Error("Electron shell mock is unavailable");
      observedPaths.opened = null;
      observedPaths.revealed = null;
    });
    await reopenedPage.locator(".track-name").first().click();
    await reopenedPage.getByRole("button", { name: "打开所在文件夹" }).click();
    await expect(reopenedPage.locator(".notice")).toHaveCount(0);
    await expect
      .poll(() =>
        electronApp.evaluate(
          () => (globalThis as unknown as { observedPaths?: unknown }).observedPaths
        )
      )
      .toEqual({ opened: samplePath, revealed: samplePath });

    const managedRoot = join(userDataPath, "managed-audio");
    const managedFiles = await listFilesIfPresent(managedRoot);
    expect(managedFiles).toEqual([]);
  } finally {
    await electronApp.close();
    expect(await snapshot(samplePath)).toEqual(sourceBefore);
    await rm(userDataPath, { force: true, recursive: true });
  }
});

test("keeps a matching packaged runtime between launches", async () => {
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
  const userDataPath = await mkdtemp(join(tmpdir(), "analyze-music-electron-runtime-"));
  const nodeServicePath = await seedRuntime({ bundleName, platformDirectory, userDataPath });
  const sentinelPath = join(nodeServicePath, ".runtime-sentinel");
  await writeFile(sentinelPath, "keep");
  const electronApp = await electron.launch({
    args: [`--user-data-dir=${userDataPath}`],
    executablePath
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByRole("heading", { name: "音乐管理" })).toBeVisible();
    await expect(readFile(sentinelPath, "utf8")).resolves.toBe("keep");
  } finally {
    await electronApp.close();
    await rm(userDataPath, { force: true, recursive: true });
  }
});

test("repairs an incomplete runtime even when its revision matches", async () => {
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
  const userDataPath = await mkdtemp(join(tmpdir(), "analyze-music-electron-runtime-repair-"));
  const nodeServicePath = await seedRuntime({ bundleName, platformDirectory, userDataPath });
  const entryPath = join(nodeServicePath, "dist/main.js");
  await rm(entryPath);
  const electronApp = await electron.launch({
    args: [`--user-data-dir=${userDataPath}`],
    executablePath
  });

  try {
    const page = await electronApp.firstWindow();
    await expect(page.getByRole("heading", { name: "音乐管理" })).toBeVisible();
    await expect(access(entryPath)).resolves.toBeUndefined();
  } finally {
    await electronApp.close();
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

async function seedStaleRuntime({
  bundleName,
  platformDirectory,
  userDataPath
}: {
  bundleName: string;
  platformDirectory: string;
  userDataPath: string;
}) {
  const nodeServicePath = await seedRuntime({ bundleName, platformDirectory, userDataPath });
  const metadataPath = join(nodeServicePath, "dist/services/audio-metadata.js");
  const metadata = await readFile(metadataPath, "utf8");
  const staleMetadata = metadata.replace(
    'process.env["MUSIC_FFPROBE_PATH"] || "ffprobe"',
    '"ffprobe"'
  );
  expect(staleMetadata).not.toContain("MUSIC_FFPROBE_PATH");
  await writeFile(metadataPath, staleMetadata);
  await writeFile(join(nodeServicePath, ".runtime-revision"), "outdated");
}

async function seedRuntime({
  bundleName,
  platformDirectory,
  userDataPath
}: {
  bundleName: string;
  platformDirectory: string;
  userDataPath: string;
}) {
  const resourcesPath = join(platformDirectory, bundleName, "Contents/Resources");
  const nodeServicePath = join(userDataPath, "runtime/node-service");
  await cp(join(resourcesPath, "node-service"), nodeServicePath, { recursive: true });
  await cp(join(resourcesPath, "dependencies"), join(nodeServicePath, "node_modules"), {
    recursive: true
  });
  return nodeServicePath;
}
