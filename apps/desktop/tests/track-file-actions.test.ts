import { describe, expect, it, vi } from "vitest";

interface DesktopTrackFileActionsModule {
  createDesktopTrackFileActions: (dependencies: {
    apiBaseUrl: string;
    desktopFileActionToken: string;
    fetchImplementation: typeof fetch;
    fileActions: {
      openFile: (sourcePath: unknown) => Promise<{ error: string | null }>;
      showItemInFolder: (sourcePath: unknown) => Promise<{ error: string | null }>;
    };
  }) => {
    openTrack: (trackId: unknown) => Promise<{ error: string | null }>;
    showTrackInFolder: (trackId: unknown) => Promise<{ error: string | null }>;
  };
}

async function loadTrackFileActions() {
  try {
    return (await import(
      ["../src", "track-file-actions.js"].join("/")
    )) as DesktopTrackFileActionsModule;
  } catch {
    return undefined;
  }
}

describe("desktop track file actions", () => {
  it("resolves a library track before opening its linked audio source", async () => {
    const trackFileActions = await loadTrackFileActions();
    expect(trackFileActions).toBeDefined();
    if (!trackFileActions) return;

    const openFile = vi.fn().mockResolvedValue({ error: null });
    let request: Request | undefined;
    const actions = trackFileActions.createDesktopTrackFileActions({
      apiBaseUrl: "http://127.0.0.1:51188/api",
      desktopFileActionToken: "desktop-file-action-token",
      fetchImplementation: async (input, init) => {
        request = new Request(input, init);
        return new Response(JSON.stringify({ sourcePath: "/music/remember-me.mp3" }));
      },
      fileActions: { openFile, showItemInFolder: vi.fn() }
    });

    await expect(actions.openTrack("track-1")).resolves.toEqual({ error: null });
    expect(request?.url).toBe("http://127.0.0.1:51188/api/desktop/music/track-1/source-path");
    expect(request?.headers.get("x-music-desktop-file-action-token")).toBe(
      "desktop-file-action-token"
    );
    expect(openFile).toHaveBeenCalledWith("/music/remember-me.mp3");
  });

  it("does not pass a renderer-provided path to the file action", async () => {
    const trackFileActions = await loadTrackFileActions();
    expect(trackFileActions).toBeDefined();
    if (!trackFileActions) return;

    const fileActions = {
      openFile: vi.fn().mockResolvedValue({ error: null }),
      showItemInFolder: vi.fn().mockResolvedValue({ error: null })
    };
    const fetchImplementation = vi.fn<typeof fetch>();
    const actions = trackFileActions.createDesktopTrackFileActions({
      apiBaseUrl: "http://127.0.0.1:51188/api",
      desktopFileActionToken: "desktop-file-action-token",
      fetchImplementation,
      fileActions
    });

    await expect(actions.showTrackInFolder("/music/attacker.app")).resolves.toEqual({
      error: "音乐记录不存在或无法读取。"
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(fileActions.showItemInFolder).not.toHaveBeenCalled();
  });

  it("reports a missing source path without invoking the operating system action", async () => {
    const trackFileActions = await loadTrackFileActions();
    expect(trackFileActions).toBeDefined();
    if (!trackFileActions) return;

    const fileActions = {
      openFile: vi.fn().mockResolvedValue({ error: null }),
      showItemInFolder: vi.fn().mockResolvedValue({ error: null })
    };
    const actions = trackFileActions.createDesktopTrackFileActions({
      apiBaseUrl: "http://127.0.0.1:51188/api",
      desktopFileActionToken: "desktop-file-action-token",
      fetchImplementation: async () => new Response(JSON.stringify({ sourcePath: null })),
      fileActions
    });

    await expect(actions.showTrackInFolder("track-1")).resolves.toEqual({
      error: "音乐记录不存在或无法读取。"
    });
    expect(fileActions.showItemInFolder).not.toHaveBeenCalled();
  });
});
