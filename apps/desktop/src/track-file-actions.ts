import type { DesktopFileActionResult } from "./file-actions.js";

interface DesktopTrackFileActionsDependencies {
  apiBaseUrl: string;
  desktopFileActionToken: string;
  fetchImplementation: typeof fetch;
  fileActions: {
    openFile: (sourcePath: unknown) => Promise<DesktopFileActionResult>;
    showItemInFolder: (sourcePath: unknown) => Promise<DesktopFileActionResult>;
  };
}

export function createDesktopTrackFileActions({
  apiBaseUrl,
  desktopFileActionToken,
  fetchImplementation,
  fileActions
}: DesktopTrackFileActionsDependencies) {
  const sourcePathForTrack = async (trackId: unknown) => {
    if (!isTrackId(trackId)) return { error: "音乐记录不存在或无法读取。", sourcePath: null };
    try {
      const response = await fetchImplementation(
        `${apiBaseUrl}/desktop/music/${encodeURIComponent(trackId)}/source-path`,
        { headers: { "x-music-desktop-file-action-token": desktopFileActionToken } }
      );
      if (!response.ok) return { error: "音乐记录不存在或无法读取。", sourcePath: null };
      const payload = (await response.json()) as { sourcePath?: unknown };
      if (typeof payload.sourcePath !== "string" || !payload.sourcePath.trim()) {
        return { error: "音乐记录不存在或无法读取。", sourcePath: null };
      }
      return { error: null, sourcePath: payload.sourcePath };
    } catch {
      return { error: "音乐记录不存在或无法读取。", sourcePath: null };
    }
  };

  return {
    openTrack: async (trackId: unknown): Promise<DesktopFileActionResult> => {
      const track = await sourcePathForTrack(trackId);
      return track.error === null ? fileActions.openFile(track.sourcePath) : { error: track.error };
    },
    showTrackInFolder: async (trackId: unknown): Promise<DesktopFileActionResult> => {
      const track = await sourcePathForTrack(trackId);
      return track.error === null
        ? fileActions.showItemInFolder(track.sourcePath)
        : { error: track.error };
    }
  };
}

function isTrackId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/[\\/]/.test(value);
}
