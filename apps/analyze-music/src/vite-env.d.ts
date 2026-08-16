/// <reference types="vite/client" />

interface DesktopFileReference {
  name: string;
  path: string;
  size: number;
}

interface MusicDesktopBridge {
  isAvailable: true;
  selectFiles: () => Promise<DesktopFileReference[]>;
  selectFolder: () => Promise<DesktopFileReference[]>;
  toggleDevTools: () => Promise<void>;
}

interface Window {
  musicDesktop?: MusicDesktopBridge;
}
