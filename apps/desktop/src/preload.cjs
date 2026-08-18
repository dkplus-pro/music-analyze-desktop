const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("musicDesktop", {
  isAvailable: true,
  openTrack: (trackId) => ipcRenderer.invoke("open-track", trackId),
  selectFiles: () => ipcRenderer.invoke("select-files"),
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  showTrackInFolder: (trackId) => ipcRenderer.invoke("show-track-in-folder", trackId),
  toggleDevTools: () => ipcRenderer.invoke("toggle-dev-tools")
});
