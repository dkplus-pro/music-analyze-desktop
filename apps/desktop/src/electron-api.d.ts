export interface DesktopFile {
  name: string;
  path: string;
  size: number;
}

export interface MusicDesktopApi {
  isAvailable: true;
  selectFiles: () => Promise<DesktopFile[]>;
  selectFolder: () => Promise<DesktopFile[]>;
  toggleDevTools: () => Promise<void>;
}

declare global {
  interface Window {
    musicDesktop?: MusicDesktopApi;
  }
}

export {};
