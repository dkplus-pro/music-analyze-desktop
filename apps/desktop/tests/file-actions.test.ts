import { describe, expect, it, vi } from "vitest";

interface DesktopFileActionsModule {
  createDesktopFileActions: (dependencies: {
    shell: {
      openPath: (sourcePath: string) => Promise<string>;
      showItemInFolder: (sourcePath: string) => void;
    };
    access: (sourcePath: string) => Promise<void>;
    realpath: (sourcePath: string) => Promise<string>;
    stat: (sourcePath: string) => Promise<{ isFile: () => boolean }>;
  }) => {
    openFile: (sourcePath: unknown) => Promise<{ error: string | null }>;
    showItemInFolder: (sourcePath: unknown) => Promise<{ error: string | null }>;
  };
}

async function loadFileActions() {
  try {
    return (await import(["../src", "file-actions.js"].join("/"))) as DesktopFileActionsModule;
  } catch {
    return undefined;
  }
}

describe("desktop file actions", () => {
  it("opens an accessible source file with the default player", async () => {
    const fileActions = await loadFileActions();
    expect(fileActions).toBeDefined();
    if (!fileActions) return;

    const shell = {
      openPath: vi.fn().mockResolvedValue(""),
      showItemInFolder: vi.fn()
    };
    const actions = fileActions.createDesktopFileActions({
      access: vi.fn().mockResolvedValue(undefined),
      realpath: vi.fn().mockResolvedValue("/music/remember-me.mp3"),
      shell,
      stat: vi.fn().mockResolvedValue({ isFile: () => true })
    });

    await expect(actions.openFile("/music/remember-me.mp3")).resolves.toEqual({ error: null });
    expect(shell.openPath).toHaveBeenCalledWith("/music/remember-me.mp3");
  });

  it("reveals an accessible source file in its containing folder", async () => {
    const fileActions = await loadFileActions();
    expect(fileActions).toBeDefined();
    if (!fileActions) return;

    const shell = {
      openPath: vi.fn().mockResolvedValue(""),
      showItemInFolder: vi.fn()
    };
    const actions = fileActions.createDesktopFileActions({
      access: vi.fn().mockResolvedValue(undefined),
      realpath: vi.fn().mockResolvedValue("/music/remember-me.mp3"),
      shell,
      stat: vi.fn().mockResolvedValue({ isFile: () => true })
    });

    await expect(actions.showItemInFolder("/music/remember-me.mp3")).resolves.toEqual({
      error: null
    });
    expect(shell.showItemInFolder).toHaveBeenCalledWith("/music/remember-me.mp3");
  });

  it("does not invoke the operating system for a missing or directory source", async () => {
    const fileActions = await loadFileActions();
    expect(fileActions).toBeDefined();
    if (!fileActions) return;

    const shell = {
      openPath: vi.fn().mockResolvedValue(""),
      showItemInFolder: vi.fn()
    };
    const actions = fileActions.createDesktopFileActions({
      access: vi.fn().mockResolvedValue(undefined),
      realpath: vi.fn().mockResolvedValue("/music/archive.mp3"),
      shell,
      stat: vi.fn().mockResolvedValue({ isFile: () => false })
    });

    await expect(actions.openFile("/music")).resolves.toEqual({
      error: "源文件不存在或无法读取。"
    });
    expect(shell.openPath).not.toHaveBeenCalled();
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it("reports an invalid path without invoking the operating system", async () => {
    const fileActions = await loadFileActions();
    expect(fileActions).toBeDefined();
    if (!fileActions) return;

    const shell = {
      openPath: vi.fn().mockResolvedValue(""),
      showItemInFolder: vi.fn()
    };
    const actions = fileActions.createDesktopFileActions({
      access: vi.fn(),
      realpath: vi.fn(),
      shell,
      stat: vi.fn()
    });

    await expect(actions.openFile("  ")).resolves.toEqual({ error: "源文件路径无效。" });
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("returns the default player error", async () => {
    const fileActions = await loadFileActions();
    expect(fileActions).toBeDefined();
    if (!fileActions) return;

    const shell = {
      openPath: vi.fn().mockResolvedValue("No application is associated with this file."),
      showItemInFolder: vi.fn()
    };
    const actions = fileActions.createDesktopFileActions({
      access: vi.fn().mockResolvedValue(undefined),
      realpath: vi.fn().mockResolvedValue("/music/remember-me.mp3"),
      shell,
      stat: vi.fn().mockResolvedValue({ isFile: () => true })
    });

    await expect(actions.openFile("/music/remember-me.mp3")).resolves.toEqual({
      error: "No application is associated with this file."
    });
  });

  it("does not reveal an unreadable source file", async () => {
    const fileActions = await loadFileActions();
    expect(fileActions).toBeDefined();
    if (!fileActions) return;

    const shell = {
      openPath: vi.fn().mockResolvedValue(""),
      showItemInFolder: vi.fn()
    };
    const actions = fileActions.createDesktopFileActions({
      access: vi.fn().mockRejectedValue(new Error("EACCES")),
      realpath: vi.fn().mockResolvedValue("/music/remember-me.mp3"),
      shell,
      stat: vi.fn().mockResolvedValue({ isFile: () => true })
    });

    await expect(actions.showItemInFolder("/music/remember-me.mp3")).resolves.toEqual({
      error: "源文件不存在或无法读取。"
    });
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it("does not invoke the operating system for a non-audio file", async () => {
    const fileActions = await loadFileActions();
    expect(fileActions).toBeDefined();
    if (!fileActions) return;

    const shell = {
      openPath: vi.fn().mockResolvedValue(""),
      showItemInFolder: vi.fn()
    };
    const actions = fileActions.createDesktopFileActions({
      access: vi.fn().mockResolvedValue(undefined),
      realpath: vi.fn().mockResolvedValue("/music/launcher.app"),
      shell,
      stat: vi.fn().mockResolvedValue({ isFile: () => true })
    });

    await expect(actions.openFile("/music/launcher.app")).resolves.toEqual({
      error: "仅支持打开已导入的音频源文件。"
    });
    expect(shell.openPath).not.toHaveBeenCalled();
  });
});
