# Electron Desktop Music Analyze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a runnable Electron desktop app that reads selected audio files in place, never deletes source files, adds Music Analysis and System Settings navigation, supports `.env` AI/Feishu configuration, exposes F12 DevTools, and verifies a real sample analysis.

**Architecture:** Keep the existing React/Vite admin and Fastify service. Add a desktop Electron main/preload package that starts the local service and exposes file dialogs. Add an explicit `LINKED_SOURCE` import mode so the backend reuses the absolute source path instead of creating `managedPath`; retain `MANAGED_COPY` for browser uploads.

**Tech Stack:** Electron, electron-builder, React 19, Vite, Fastify, TypeScript, Vitest, Playwright, SQLite/Drizzle, existing Python/librosa and ffprobe analyzer.

## Global Constraints

- The source file selected in Electron is never copied and never deleted.
- The existing browser multipart upload path remains compatible.
- API keys are never returned in plaintext; UI shows only configured state and a masked suffix.
- Electron renderer uses `contextIsolation: true`, `nodeIntegration: false`, and a narrow preload API.
- Local service binds to `127.0.0.1` only.
- All new behavior follows test-first red/green/refactor cycles.
- `tests/sample` audio is the authoritative integration fixture.

## File Map

- Create `apps/desktop/`: Electron main process, preload bridge, package metadata, Vite dev/build config.
- Modify `apps/node-service/src/services/import-service.ts`: add linked-source import mode and preserve source paths.
- Modify `apps/node-service/src/services/analysis-queue.ts`: resolve the correct analysis path and only release managed copies.
- Modify `apps/node-service/src/app.ts`: linked source API, source availability checks, delete semantics, settings endpoints.
- Modify `packages/database/src/schema.ts` and `packages/database/src/index.ts` only where compatibility types/columns require it.
- Modify `apps/analyze-music/src/App.tsx`, `src/api.ts`, `src/store.ts`, `src/styles.css`: navigation, settings view, Electron import bridge, and linked import UX.
- Create/modify tests in `apps/node-service/tests`, `apps/analyze-music/tests`, `tests/playwright`, and `tests/electron`.
- Modify root `package.json`, `pnpm-workspace.yaml`, `playwright.music.config.ts`, `.env.example`, and README scripts/docs.

### Task 1: Add linked-source import behavior

**Files:**
- Modify: `apps/node-service/src/services/import-service.ts`
- Modify: `apps/node-service/src/services/analysis-queue.ts`
- Modify: `apps/node-service/src/app.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `apps/node-service/tests/import-service.test.ts`
- Test: `apps/node-service/tests/analysis-queue.test.ts`
- Test: `apps/node-service/tests/http-api.test.ts`

**Interfaces:**
- `createImportService.importFile(input)` accepts `storageMode?: "MANAGED_COPY" | "LINKED_SOURCE"`, defaulting to `MANAGED_COPY`.
- `ImportMusicRequestSchema` accepts the same optional `storageMode` but rejects any other value.
- `analysisFilePath(track)` returns `track.sourcePath` for linked records and `track.managedPath` for managed copies.

- [ ] Write a failing unit test proving linked import stores the selected source path, uses it as the analysis path, does not create a file under `storageRoot`, and leaves the source readable after import.
- [ ] Run `pnpm --filter @analyze-music/node-service test -- import-service.test.ts`; confirm the new test fails because every import currently copies.
- [ ] Implement mode-aware import with `managedPath = sourcePath` for linked imports and retain existing copy helper for managed imports.
- [ ] Write a failing queue/API regression test proving a successful linked analysis leaves the source file, while managed upload behavior still releases its copy.
- [ ] Update the queue `finally` cleanup, delete route, analyze route, batch route, and retry route to use the mode-aware path and a `canReleaseManagedPath` guard.
- [ ] Run the focused Node tests and confirm green.
- [ ] Commit with `feat: support linked audio sources`.

### Task 2: Add settings API and environment configuration

**Files:**
- Modify: `apps/node-service/src/app.ts`
- Create: `apps/node-service/src/services/settings-service.ts`
- Modify: `apps/node-service/src/main.ts`
- Modify: `.env.example`
- Test: `apps/node-service/tests/settings-service.test.ts`
- Test: `apps/node-service/tests/http-api.test.ts`

**Interfaces:**
- `GET /api/settings` returns `{ ai: { configured, apiKeySuffix, baseUrl, model }, feishu: { appIdConfigured, appSecretConfigured, appTokenConfigured, tableIdConfigured } }`.
- `PATCH /api/settings` accepts optional `ai` and `feishu` strings and returns the same masked view; empty secret values preserve the existing secret.
- `createSettingsService({ envPath, environment })` reads `.env` safely and writes only approved keys.

- [ ] Add settings-service tests for parsing `.env`, masking secrets, preserving blank secret fields, and writing only approved AI/Feishu keys.
- [ ] Run the focused test and confirm failure before implementation.
- [ ] Implement the settings service with atomic temp-file replacement and no plaintext secret in response objects.
- [ ] Add Fastify routes and make the analyzer configuration read the persisted/env values on service startup.
- [ ] Add `.env.example` entries for `BAILIAN_API_KEY`, `BAILIAN_BASE_URL`, `BAILIAN_MODEL`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_APP_TOKEN`, and `FEISHU_TABLE_ID` with comments.
- [ ] Run Node typecheck and settings/API tests.
- [ ] Commit with `feat: add local model and feishu settings`.

### Task 3: Add Electron shell and preload bridge

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/src/main.ts`
- Create: `apps/desktop/src/preload.ts`
- Create: `apps/desktop/src/electron-api.d.ts`
- Modify: root `package.json`, `pnpm-workspace.yaml`
- Test: `apps/desktop/tests/main.test.ts`

**Interfaces:**
- `window.musicDesktop.selectFiles()` returns `Array<{ path: string; name: string; size: number }>`.
- `window.musicDesktop.selectFolder()` returns the same metadata for supported descendant files.
- `window.musicDesktop.toggleDevTools()` toggles the current window’s DevTools.
- `window.musicDesktop.isAvailable` is `true` only in Electron.

- [ ] Add a main-process test fixture for dialog, service child-process, health polling, and F12 handlers; run it red before implementation.
- [ ] Implement `BrowserWindow` with secure webPreferences, dev/prod URL loading, local service startup, graceful child-process shutdown, and `before-input-event` F12 toggle.
- [ ] Implement preload context bridge and typed global declarations.
- [ ] Add Electron build/start/package scripts and `electron-builder` config for macOS/Linux/Windows directory artifacts.
- [ ] Run desktop typecheck/build and the main-process tests.
- [ ] Commit with `feat: add electron desktop shell`.

### Task 4: Add navigation, System Settings, and direct desktop import UX

**Files:**
- Modify: `apps/analyze-music/src/api.ts`
- Modify: `apps/analyze-music/src/App.tsx`
- Modify: `apps/analyze-music/src/styles.css`
- Modify: `apps/analyze-music/src/vite-env.d.ts`
- Test: `apps/analyze-music/tests/music-page.test.tsx`

**Interfaces:**
- `MusicApi.importSourcePaths(files, onProgress)` posts JSON to `/import` with `{ sourcePath, originalFilename, storageMode: "LINKED_SOURCE" }` and reports a session snapshot-compatible progress result.
- `MusicApi.getSettings()` and `MusicApi.updateSettings(patch)` wrap the settings routes.
- `MusicLibrary` renders `music` and `settings` views selected from a left rail; desktop file selection is used when `window.musicDesktop.isAvailable` is true, browser inputs remain as fallback.

- [ ] Add React tests for menu switching, settings field masking/load/save, and desktop bridge source-path import; run them red.
- [ ] Implement the API methods and typed desktop detection without accessing Node APIs in React.
- [ ] Add the left menu with active state, keyboard-accessible buttons, and a System Settings panel for AI and Feishu fields.
- [ ] Route direct desktop files through the linked-source endpoint and show clear “源文件不会被复制或删除” copy; retain browser upload UI as fallback.
- [ ] Style the two views in the existing cinematic workstation visual language with responsive narrow-window behavior and visible save/error states.
- [ ] Run admin unit tests, lint, typecheck, and build.
- [ ] Commit with `feat: add desktop navigation and settings UI`.

### Task 5: Add Electron integration test and real analysis packaging verification

**Files:**
- Create: `tests/electron/desktop-analysis.spec.ts`
- Modify: `playwright.music.config.ts`
- Modify: root `package.json`
- Modify: `apps/desktop/src/main.ts` if packaging path fixes are required
- Modify: README.md

- [ ] Add a Playwright Electron test that selects `tests/sample/10 希望.mp3`, waits for imported/completed analysis state, and asserts the sample path still exists.
- [ ] Run the test before final packaging and record the first failure as the red baseline.
- [ ] Implement only the packaging/runtime fixes needed for the test: packaged service assets, userData database path, `.env` lookup, and analyzer executable paths.
- [ ] Run `pnpm build`, `pnpm electron:pack`, and launch the generated artifact in the test harness.
- [ ] Run the full relevant test suite: unit, workspace, admin, Node API, and Electron Playwright tests.
- [ ] Update README with desktop dev/build/package commands, F12 behavior, `.env` fields, source-file safety, and Python/ffprobe prerequisites.
- [ ] Commit with `test: verify electron real audio analysis`.

## Verification Checklist

- [ ] `pnpm --filter @analyze-music/node-service test` passes with linked and managed source cases.
- [ ] `pnpm --filter @analyze-music/admin test` passes with navigation/settings/import cases.
- [ ] `pnpm --filter @analyze-music/desktop build` passes.
- [ ] `pnpm build` passes.
- [ ] `pnpm electron:pack` produces an Electron artifact.
- [ ] Electron Playwright test successfully imports and analyzes a file from `tests/sample`.
- [ ] The source file remains present after success, failure, retry, and app shutdown.
- [ ] F12 opens DevTools in the packaged app.
