import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/playwright",
  testMatch: "music-admin.spec.ts",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:15173",
    trace: "on-first-retry"
  },
  webServer: [
    {
      command:
        "pnpm turbo run build --filter=@analyze-music/node-service && DATABASE_URL=file:data/e2e-music.db MUSIC_STORAGE_PATH=data/e2e-music PORT=13001 pnpm --filter @analyze-music/node-service start",
      timeout: 120_000,
      url: "http://127.0.0.1:13001/api/health"
    },
    {
      command:
        "VITE_API_PROXY_TARGET=http://127.0.0.1:13001 pnpm --filter @analyze-music/admin exec vite --host 127.0.0.1 --port 15173",
      timeout: 120_000,
      url: "http://127.0.0.1:15173"
    }
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
