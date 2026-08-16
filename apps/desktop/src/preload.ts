import { contextBridge, ipcRenderer } from "electron";

import type { DesktopFile, MusicDesktopApi } from "./electron-api.js";

const api: MusicDesktopApi = {
  isAvailable: true,
  selectFiles: () => ipcRenderer.invoke("select-files") as Promise<DesktopFile[]>,
  selectFolder: () => ipcRenderer.invoke("select-folder") as Promise<DesktopFile[]>,
  toggleDevTools: () => ipcRenderer.invoke("toggle-dev-tools") as Promise<void>
};

contextBridge.exposeInMainWorld("musicDesktop", api);
