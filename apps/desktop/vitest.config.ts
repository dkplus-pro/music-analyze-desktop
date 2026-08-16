import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["release/**", "runtime/**", "runtime.stale-*/**", "tests/electron/**"]
  }
});
