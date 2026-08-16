import { describe, expect, it } from "vitest";

import { desktopRuntimePaths, isDevToolsShortcut } from "../src/runtime.js";

describe("desktop runtime", () => {
  it("resolves development assets from the monorepo", () => {
    expect(
      desktopRuntimePaths({
        appPath: "/repo/apps/desktop/dist",
        isPackaged: false,
        resourcesPath: "/unused/resources",
        userDataPath: "/Users/test/Library/Application Support/Analyze Music"
      })
    ).toEqual({
      adminDist: "/repo/apps/analyze-music/dist",
      envPath: "/repo/.env",
      nodeServiceRoot: "/repo/apps/node-service",
      userDataRoot: "/Users/test/Library/Application Support/Analyze Music"
    });
  });

  it("uses bundled service assets and user data for packaged apps", () => {
    expect(
      desktopRuntimePaths({
        appPath: "/Applications/Analyze Music.app/Contents/Resources/app.asar/dist",
        isPackaged: true,
        resourcesPath: "/Applications/Analyze Music.app/Contents/Resources",
        userDataPath: "/Users/test/Library/Application Support/Analyze Music"
      })
    ).toEqual({
      adminDist: "/Applications/Analyze Music.app/Contents/Resources/admin",
      envPath: "/Users/test/Library/Application Support/Analyze Music/.env",
      nodeServiceRoot: "/Users/test/Library/Application Support/Analyze Music/runtime/node-service",
      userDataRoot: "/Users/test/Library/Application Support/Analyze Music"
    });
  });

  it("recognizes F12 without intercepting other keys", () => {
    expect(isDevToolsShortcut({ key: "F12" })).toBe(true);
    expect(isDevToolsShortcut({ key: "F11" })).toBe(false);
    expect(isDevToolsShortcut({ key: "f12" })).toBe(false);
  });
});
