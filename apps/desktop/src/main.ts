import { spawn, type ChildProcess } from "node:child_process";
import { access, copyFile, cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";

import { desktopRuntimePaths, isDevToolsShortcut } from "./runtime.js";

const supportedExtensions = new Set([".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"]);
const audioFilters = [{ name: "Audio", extensions: ["mp3", "wav", "flac", "m4a", "aac", "ogg"] }];
let serviceProcess: ChildProcess | undefined;
let servicePort: number | undefined;

void app.whenReady().then(async () => {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const paths = desktopRuntimePaths({
    appPath: moduleDirectory,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath("userData")
  });
  await ensureEnvFile(paths);
  await ensurePackagedRuntime(paths);
  const apiBaseUrl = await startLocalService(paths);
  const window = createMainWindow(paths.adminDist, apiBaseUrl);

  ipcMain.handle("select-files", () =>
    selectFiles(window, { properties: ["openFile", "multiSelections"] })
  );
  ipcMain.handle("select-folder", () => selectFiles(window, { properties: ["openDirectory"] }));
  ipcMain.handle("toggle-dev-tools", () => window.webContents.toggleDevTools());

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(paths.adminDist, apiBaseUrl);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serviceProcess && !serviceProcess.killed) serviceProcess.kill();
});

function createMainWindow(adminDist: string, apiBaseUrl: string) {
  const window = new BrowserWindow({
    height: 900,
    minHeight: 640,
    minWidth: 980,
    show: false,
    title: "Analyze Music",
    webPreferences: {
      contextIsolation: true,
      devTools: true,
      nodeIntegration: false,
      preload: join(dirname(fileURLToPath(import.meta.url)), "preload.cjs")
    },
    width: 1440
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && isDevToolsShortcut(input)) {
      event.preventDefault();
      window.webContents.toggleDevTools();
    }
  });
  void window
    .loadFile(join(adminDist, "index.html"), { query: { api: apiBaseUrl } })
    .then(() => window.show());
  return window;
}

async function startLocalService(paths: ReturnType<typeof desktopRuntimePaths>) {
  const port = await findFreePort();
  servicePort = port;
  const envPath = paths.envPath;
  const databasePath = join(paths.userDataRoot, "data", "analyze-music.db");
  const storageRoot = join(paths.userDataRoot, "managed-audio");
  const entry = join(paths.nodeServiceRoot, "dist/main.js");
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `file:${databasePath}`,
    ELECTRON_RUN_AS_NODE: "1",
    MUSIC_ENV_PATH: envPath,
    MUSIC_STORAGE_PATH: storageRoot,
    PORT: String(port)
  };
  if (app.isPackaged && !environment["MUSIC_ANALYZER_SCRIPT"]) {
    environment["MUSIC_ANALYZER_SCRIPT"] = join(
      process.resourcesPath,
      "tools/music-analyzer/main.py"
    );
  }
  await access(entry);
  serviceProcess = spawn(process.execPath, [`--env-file-if-exists=${envPath}`, entry], {
    cwd: paths.userDataRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"]
  });
  serviceProcess.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  serviceProcess.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  await waitForHealth(`http://127.0.0.1:${port}/api/health`);
  return `http://127.0.0.1:${port}/api`;
}

async function ensureEnvFile(paths: ReturnType<typeof desktopRuntimePaths>) {
  try {
    await access(paths.envPath);
    return;
  } catch {
    // The packaged app gets a user-editable copy on first launch when one was bundled.
  }
  if (!app.isPackaged) return;

  const bundledEnvPath = join(process.resourcesPath, "default.env");
  try {
    await access(bundledEnvPath);
    await mkdir(paths.userDataRoot, { recursive: true });
    await copyFile(bundledEnvPath, paths.envPath);
  } catch {
    // Settings can still be configured from the desktop UI after launch.
  }
}

async function ensurePackagedRuntime(paths: ReturnType<typeof desktopRuntimePaths>) {
  if (!app.isPackaged) return;
  try {
    await access(join(paths.nodeServiceRoot, "dist/main.js"));
    await access(join(paths.nodeServiceRoot, "node_modules/@analyze-music/database/package.json"));
    return;
  } catch {
    // Rebuild the user-data runtime when it is missing or incomplete.
  }
  const bundledServiceRoot = join(process.resourcesPath, "node-service");
  const bundledDependenciesRoot = join(process.resourcesPath, "dependencies");
  const runtimeRoot = dirname(paths.nodeServiceRoot);
  await rm(runtimeRoot, { force: true, recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  await cp(bundledServiceRoot, paths.nodeServiceRoot, { recursive: true });
  await cp(bundledDependenciesRoot, join(paths.nodeServiceRoot, "node_modules"), {
    recursive: true
  });
}

async function waitForHealth(url: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The child process can take a moment to initialize SQLite and Fastify.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Local music service did not become healthy: ${url}`);
}

async function selectFiles(window: BrowserWindow, options: OpenDialogOptions) {
  const result = await dialog.showOpenDialog(window, { ...options, filters: audioFilters });
  if (result.canceled || result.filePaths.length === 0) return [];
  const paths = options.properties?.includes("openDirectory")
    ? await collectAudioFiles(result.filePaths[0]!)
    : result.filePaths;
  return Promise.all(
    paths.map(async (path) => ({
      name: path.split(/[\\/]/).pop() ?? path,
      path,
      size: (await stat(path)).size
    }))
  );
}

async function collectAudioFiles(root: string) {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (
        supportedExtensions.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase())
      ) {
        files.push(path);
      }
    }
  };
  await visit(root);
  return files.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
}

async function findFreePort() {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  if (!address || typeof address === "string")
    throw new Error("Unable to allocate local service port");
  return address.port;
}

export function getServicePortForTests() {
  return servicePort;
}
