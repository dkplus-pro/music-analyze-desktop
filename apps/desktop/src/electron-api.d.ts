export interface DesktopFile {
  name: string;
  path: string;
  size: number;
}

export interface DesktopFileActionResult {
  error: string | null;
}

export interface MusicDesktopApi {
  isAvailable: true;
  openTrack: (trackId: string) => Promise<DesktopFileActionResult>;
  selectFiles: () => Promise<DesktopFile[]>;
  selectFolder: () => Promise<DesktopFile[]>;
  showTrackInFolder: (trackId: string) => Promise<DesktopFileActionResult>;
  toggleDevTools: () => Promise<void>;
}

declare global {
  interface Window {
    musicDesktop?: MusicDesktopApi;
  }
}

export {};
