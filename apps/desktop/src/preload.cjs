const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("musicDesktop", {
  isAvailable: true,
  selectFiles: () => ipcRenderer.invoke("select-files"),
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  toggleDevTools: () => ipcRenderer.invoke("toggle-dev-tools")
});
