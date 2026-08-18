/// <reference types="vite/client" />

interface DesktopFileReference {
  name: string;
  path: string;
  size: number;
}

interface DesktopFileActionResult {
  error: string | null;
}

interface MusicDesktopBridge {
  isAvailable: true;
  openTrack: (trackId: string) => Promise<DesktopFileActionResult>;
  selectFiles: () => Promise<DesktopFileReference[]>;
  selectFolder: () => Promise<DesktopFileReference[]>;
  showTrackInFolder: (trackId: string) => Promise<DesktopFileActionResult>;
  toggleDevTools: () => Promise<void>;
}

interface Window {
  musicDesktop?: MusicDesktopBridge;
}
