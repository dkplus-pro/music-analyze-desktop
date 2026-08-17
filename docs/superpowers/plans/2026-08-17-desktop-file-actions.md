# Desktop Music File Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open linked source music in the operating system's default player, reveal it in its folder, and close the details inspector by overlay click or `Escape`.

**Architecture:** Add a narrow Electron file-action module that validates linked source paths and delegates only to `shell.openPath` and `shell.showItemInFolder`. Extend the preload bridge and use it from the React library UI; the browser build retains its existing detail-opening title click. Keep dialog dismissal fully local to `TrackInspector`.

**Tech Stack:** Electron 40 IPC and shell APIs, TypeScript, React 19, Vitest, Testing Library, Playwright.

## Global Constraints

- Source music files must never be copied, moved, or deleted by playback or folder-reveal actions.
- Electron-only operations must remain behind the context-isolated preload bridge; the React renderer must not import Electron.
- Desktop failures must become user-facing notices; source paths that are missing, unreadable, or directories must not reach Electron shell APIs.
- In browser mode, clicking a track name must preserve the existing inspector behavior and the folder action must not be rendered.
- The inspector must close from its close button, its outside layer, and `Escape`, but never when its internal content is clicked.

---

### Task 1: Validated Electron file-action bridge

**Files:**

- Create: `apps/desktop/src/file-actions.ts`
- Create: `apps/desktop/tests/file-actions.test.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/desktop/src/preload.cjs`
- Modify: `apps/desktop/src/electron-api.d.ts`
- Modify: `apps/analyze-music/src/vite-env.d.ts`

**Interfaces:**

- Produces `DesktopFileActionResult = { error: string | null }`.
- Produces `createDesktopFileActions({ shell, stat })` with `openFile(sourcePath: unknown): Promise<DesktopFileActionResult>` and `showItemInFolder(sourcePath: unknown): Promise<DesktopFileActionResult>`.
- Extends `window.musicDesktop` with `openFile(sourcePath: string)` and `showItemInFolder(sourcePath: string)`, each returning `Promise<DesktopFileActionResult>`.

- [ ] **Step 1: Write failing file-action tests**

```ts
it("opens an accessible audio file with the default player", async () => {
  const shell = { openPath: vi.fn().mockResolvedValue(""), showItemInFolder: vi.fn() };
  const actions = createDesktopFileActions({
    shell,
    stat: vi.fn().mockResolvedValue({ isFile: () => true })
  });

  await expect(actions.openFile("/music/remember-me.mp3")).resolves.toEqual({ error: null });
  expect(shell.openPath).toHaveBeenCalledWith("/music/remember-me.mp3");
});

it("does not invoke shell for a missing source file", async () => {
  const shell = { openPath: vi.fn(), showItemInFolder: vi.fn() };
  const actions = createDesktopFileActions({
    shell,
    stat: vi.fn().mockRejectedValue(new Error("ENOENT"))
  });

  await expect(actions.showItemInFolder("/music/missing.mp3")).resolves.toEqual({
    error: "源文件不存在或无法读取。"
  });
  expect(shell.showItemInFolder).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused desktop test and verify it fails**

Run: `pnpm --filter @analyze-music/desktop test -- file-actions.test.ts`

Expected: FAIL because `file-actions.ts` and `createDesktopFileActions` do not exist.

- [ ] **Step 3: Implement the minimal validated Electron action module and IPC handlers**

```ts
export type DesktopFileActionResult = { error: string | null };

interface DesktopFileActionsDependencies {
  shell: {
    openPath: (sourcePath: string) => Promise<string>;
    showItemInFolder: (sourcePath: string) => void;
  };
  stat: (sourcePath: string) => Promise<{ isFile: () => boolean }>;
}

export function createDesktopFileActions({ shell, stat }: DesktopFileActionsDependencies) {
  const validate = async (sourcePath: unknown): Promise<string | null> => {
    if (typeof sourcePath !== "string" || !sourcePath.trim()) return "源文件路径无效。";
    try {
      return (await stat(sourcePath)).isFile() ? null : "源文件不存在或无法读取。";
    } catch {
      return "源文件不存在或无法读取。";
    }
  };
  return {
    async openFile(sourcePath: unknown): Promise<DesktopFileActionResult> {
      const error = await validate(sourcePath);
      if (error) return { error };
      const shellError = await shell.openPath(sourcePath);
      return { error: shellError || null };
    },
    async showItemInFolder(sourcePath: unknown): Promise<DesktopFileActionResult> {
      const error = await validate(sourcePath);
      if (error) return { error };
      shell.showItemInFolder(sourcePath);
      return { error: null };
    }
  };
}
```

Create the actions in `main.ts` with Electron `shell` and Node `stat`, register `open-file` and `show-item-in-folder` handlers, then expose exactly those names from `preload.cjs`. Mirror the result and methods in both renderer bridge declaration files.

- [ ] **Step 4: Run focused desktop tests and type/lint checks**

Run: `pnpm --filter @analyze-music/desktop test -- file-actions.test.ts && pnpm --filter @analyze-music/desktop typecheck && pnpm --filter @analyze-music/desktop lint`

Expected: PASS with file access, default-player, folder reveal, missing-file, invalid-path, and player-error cases covered.

- [ ] **Step 5: Commit the bridge task**

```bash
git add apps/desktop/src/file-actions.ts apps/desktop/tests/file-actions.test.ts apps/desktop/src/main.ts apps/desktop/src/preload.cjs apps/desktop/src/electron-api.d.ts apps/analyze-music/src/vite-env.d.ts
git commit -m "feat: add desktop source file actions"
```

### Task 2: Music-row controls and dismissible inspector

**Files:**

- Modify: `apps/analyze-music/src/App.tsx`
- Modify: `apps/analyze-music/src/api.ts`
- Modify: `apps/analyze-music/src/styles.css`
- Modify: `apps/analyze-music/tests/music-page.test.tsx`

**Interfaces:**

- Consumes `window.musicDesktop.openFile(sourcePath)` and `window.musicDesktop.showItemInFolder(sourcePath)` from Task 1.
- Extends `MusicTrack` with `sourcePath: string`.
- Produces `TrackRow` callbacks for playback, details, and folder reveal.

- [ ] **Step 1: Write failing UI tests for desktop controls and dismissal**

```tsx
it("uses the desktop bridge to play a track and reveal its source folder", async () => {
  const openFile = vi.fn().mockResolvedValue({ error: null });
  const showItemInFolder = vi.fn().mockResolvedValue({ error: null });
  Object.defineProperty(window, "musicDesktop", {
    configurable: true,
    value: {
      isAvailable: true,
      openFile,
      selectFiles: vi.fn(),
      selectFolder: vi.fn(),
      showItemInFolder,
      toggleDevTools: vi.fn()
    }
  });
  await renderApp();

  await userEvent.click(await screen.findByRole("button", { name: "播放 Remember Me" }));
  await userEvent.click(screen.getByRole("button", { name: "打开所在文件夹" }));
  expect(openFile).toHaveBeenCalledWith("/music/remember-me.mp3");
  expect(showItemInFolder).toHaveBeenCalledWith("/music/remember-me.mp3");
});

it("closes the track inspector from its layer and Escape", async () => {
  await renderApp();
  await userEvent.click(await screen.findByRole("button", { name: "详情" }));
  await userEvent.click(document.querySelector(".inspector-layer")!);
  expect(screen.queryByRole("dialog", { name: "音轨详情" })).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "详情" }));
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "音轨详情" })).toBeNull();
});
```

- [ ] **Step 2: Run the focused UI tests and verify they fail**

Run: `pnpm --filter @analyze-music/admin test -- music-page.test.tsx`

Expected: FAIL because the play/folder bridge calls, details action, and layer/keyboard dismiss behavior do not yet exist.

- [ ] **Step 3: Implement minimal UI behavior**

```tsx
const openTrack = async (track: MusicTrack) => {
  if (!window.musicDesktop?.isAvailable) {
    setSelectedTrackId(track.id);
    return;
  }
  const result = await window.musicDesktop.openFile(track.sourcePath);
  if (result.error) setNotice(`无法打开“${track.title}”：${result.error}`);
};

<button aria-label={`播放 ${track.title}`} className="track-name" onClick={onPlay} type="button">…</button>
<button type="button" onClick={onDetails}>详情</button>
{desktopAvailable ? <button type="button" onClick={onShowItemInFolder}>打开所在文件夹</button> : null}
```

In `TrackInspector`, add a `keydown` listener that calls `onClose` for `Escape`, clean it up with the scroll-lock effect, and add an outside-layer click handler that only closes when `event.target === event.currentTarget`. Preserve the existing close button. Add small action spacing and a visible focus state without changing the established dark workstation visual language.

- [ ] **Step 4: Run focused UI tests, build, typecheck, and lint**

Run: `pnpm --filter @analyze-music/admin test -- music-page.test.tsx && pnpm --filter @analyze-music/admin build && pnpm --filter @analyze-music/admin typecheck && pnpm --filter @analyze-music/admin lint`

Expected: PASS; browser title click keeps details behavior, the browser does not render the folder action, desktop failure results show the existing notice, and inspector content clicks do not close the dialog.

- [ ] **Step 5: Commit the UI task**

```bash
git add apps/analyze-music/src/App.tsx apps/analyze-music/src/api.ts apps/analyze-music/src/styles.css apps/analyze-music/tests/music-page.test.tsx
git commit -m "feat: open music files from desktop library"
```

### Task 3: Packaged Electron regression verification

**Files:**

- Modify: `apps/desktop/tests/electron/desktop-analysis.spec.ts`

**Interfaces:**

- Consumes the Task 1 preload methods and Task 2 controls in the packaged application.
- Produces a smoke test proving the new bridge is available after Electron packaging.

- [ ] **Step 1: Write a failing packaged-app bridge assertion**

```ts
expect(
  await page.evaluate(() =>
    Boolean(window.musicDesktop?.openFile && window.musicDesktop?.showItemInFolder)
  )
).toBe(true);
```

- [ ] **Step 2: Run the Electron test and verify it fails before the bridge is added**

Run: `pnpm --filter @analyze-music/desktop test:electron`

Expected: FAIL because the packaged preload does not expose both file-action methods.

- [ ] **Step 3: Add the packaged-app assertion and preserve source-file invariants**

Add the assertion after the existing `isAvailable` check. Do not launch the actual OS player or Finder in Playwright; the unit tests from Task 1 cover those shell calls. Keep the existing source hash, mode, size, and modification-time assertions unchanged.

- [ ] **Step 4: Run complete verification**

Run: `pnpm electron:test && pnpm --filter @analyze-music/music-domain test && pnpm --filter @analyze-music/node-service test && pnpm --filter @analyze-music/admin test && pnpm --filter @analyze-music/desktop typecheck && pnpm --filter @analyze-music/admin typecheck && pnpm --filter @analyze-music/desktop lint && pnpm --filter @analyze-music/admin lint && pnpm exec prettier --check apps/desktop/src/file-actions.ts apps/desktop/tests/file-actions.test.ts apps/desktop/src/main.ts apps/desktop/src/preload.cjs apps/desktop/src/electron-api.d.ts apps/analyze-music/src/App.tsx apps/analyze-music/src/api.ts apps/analyze-music/src/styles.css apps/analyze-music/src/vite-env.d.ts apps/analyze-music/tests/music-page.test.tsx apps/desktop/tests/electron/desktop-analysis.spec.ts && git diff --check`

Expected: all commands exit 0 and the packaged Electron test confirms the new bridge exists without modifying the audio source.

- [ ] **Step 5: Commit the regression test**

```bash
git add apps/desktop/tests/electron/desktop-analysis.spec.ts docs/superpowers/plans/2026-08-17-desktop-file-actions.md
git commit -m "test: cover desktop file action bridge"
```
