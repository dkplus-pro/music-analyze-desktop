import { describe, expect, it } from "vitest";

import { installerArchitecture } from "../scripts/target-architecture.mjs";

describe("desktop packaging architecture", () => {
  it("uses the installer package's arm name for Electron armv7l builds", () => {
    expect(installerArchitecture("armv7l")).toBe("arm");
  });

  it("keeps other Electron architecture names unchanged", () => {
    expect(installerArchitecture("arm64")).toBe("arm64");
    expect(installerArchitecture("x64")).toBe("x64");
  });
});
