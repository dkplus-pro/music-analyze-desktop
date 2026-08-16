import { describe, expect, it } from "vitest";

import { configuredValue } from "../src/services/runtime-config.js";

describe("runtime configuration", () => {
  it("falls back to the persisted Feishu value when an environment value is empty", () => {
    expect(configuredValue("", "persisted-bitable-token")).toBe("persisted-bitable-token");
  });

  it("uses a non-empty environment value as the explicit override", () => {
    expect(configuredValue("env-bitable-token", "persisted-bitable-token")).toBe(
      "env-bitable-token"
    );
  });
});
