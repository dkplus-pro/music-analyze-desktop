# 失败音乐重试与管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不保留成功素材的前提下，提供失败分析重试、失败原因、音乐删除和飞书多维表格跳转。

**Architecture:** 保留现有 `analysis_jobs` 作为分析状态和失败原因的唯一来源。队列只在成功时删除 `music_tracks.managed_path`，API 将最新错误与飞书链接投影到已有响应模型，管理后台通过已有 React Query 刷新机制更新界面。

**Tech Stack:** TypeScript、Fastify、Drizzle/SQLite、React、TanStack Query、Vitest、Testing Library。

## Global Constraints

- 成功任务立即删除受管音频；失败任务保留至重试成功或用户删除。
- 不新增音频副本或数据库字段；不得向客户端返回本地路径。
- 删除活动任务必须返回 409，不能让队列处理已删除记录。
- 飞书链接格式固定为 `https://feishu.cn/base/{appToken}?table={tableId}`，并在新标签页打开。
- 每项生产行为先以失败测试覆盖，再写最小实现。

---

### Task 1: 覆盖失败保留、重试和删除的服务端回归测试

**Files:**

- Modify: `apps/node-service/tests/http-api.test.ts:195-228`
- Modify: `apps/node-service/tests/http-api.test.ts:70-130`

**Interfaces:**

- Consumes: `POST /api/analysis-jobs/:id/retry`、`DELETE /api/music/:id`、`GET /api/music/:id`
- Produces: 对失败素材生命周期、删除冲突与 `analysisError` 的可重复回归测试。

- [ ] **Step 1: 写失败分析仍保留来源、重试成功后清理的失败测试**

```ts
it("keeps failed audio for retry, exposes its reason, and releases it after success", async () => {
  remainingAnalysisFailures = 1;
  const imported = await app.inject({
    method: "POST",
    url: "/api/import",
    payload: { originalFilename: "10 希望.mp3", sourcePath: samplePath }
  });
  const { trackId } = imported.json() as { trackId: string };
  const [job] = (await app.inject({ method: "GET", url: "/api/analysis-jobs" })).json() as Array<{
    id: string;
  }>;
  const [storedTrack] = await database.db.select().from(musicTracks);
  await expect(access(storedTrack!.managedPath)).resolves.toBeUndefined();
  expect((await app.inject({ method: "GET", url: `/api/music/${trackId}` })).json()).toMatchObject({
    analysisError: "temporary analyzer failure",
    analysisStatus: "FAILED"
  });
  expect(
    (await app.inject({ method: "POST", url: `/api/analysis-jobs/${job!.id}/retry` })).statusCode
  ).toBe(202);
  await expect(access(storedTrack!.managedPath)).rejects.toMatchObject({ code: "ENOENT" });
});
```

- [ ] **Step 2: 运行测试，确认因当前 finally 块删除失败文件而失败**

Run: `pnpm --filter @analyze-music/node-service test -- tests/http-api.test.ts`

Expected: FAIL，失败断言为 `access(managedPath)` 不存在或重试返回 409。

- [ ] **Step 3: 写删除失败音乐和拒绝删除活动任务的失败测试**

```ts
it("deletes retained failed audio with its music record", async () => {
  remainingAnalysisFailures = 1;
  const imported = await app.inject({
    method: "POST",
    url: "/api/import",
    payload: { originalFilename: "10 希望.mp3", sourcePath: samplePath }
  });
  const { trackId } = imported.json() as { trackId: string };
  const [storedTrack] = await database.db.select().from(musicTracks);
  expect((await app.inject({ method: "DELETE", url: `/api/music/${trackId}` })).statusCode).toBe(
    204
  );
  await expect(access(storedTrack!.managedPath)).rejects.toMatchObject({ code: "ENOENT" });
});
```

Create a second app with `processAnalysisImmediately: false` and `analysisPollIntervalMs: 60_000`, import one track, then assert `DELETE /api/music/:id` returns 409 while its job is `QUEUED`.

- [ ] **Step 4: 运行测试，确认活动任务删除当前未被拒绝**

Run: `pnpm --filter @analyze-music/node-service test -- tests/http-api.test.ts`

Expected: FAIL，活动任务删除当前返回 204。

- [ ] **Step 5: 提交仅含失败测试的工作**

```bash
git add apps/node-service/tests/http-api.test.ts
git commit -m "test: cover failed music retry lifecycle"
```

### Task 2: 实现服务端素材生命周期、状态投影和删除保护

**Files:**

- Modify: `apps/node-service/src/services/analysis-queue.ts:38-151`
- Modify: `apps/node-service/src/app.ts:415-430`
- Modify: `apps/node-service/src/app.ts:600-650`
- Test: `apps/node-service/tests/http-api.test.ts`

**Interfaces:**

- Consumes: `analysisJobs.status`, `analysisJobs.errorMessage`, `musicTracks.managedPath`。
- Produces: `analysisError: string | null` in enriched music API responses; retryable failed source files; 409 for active deletes.

- [ ] **Step 1: 在 `processNext` 中记录成功完成状态**

```ts
let completed = false;
// after updateStatus(database, job.id, "COMPLETED")
completed = true;
// finally
if (completed && managedPath) await rm(managedPath, { force: true }).catch(() => undefined);
```

Keep the existing catch block unchanged so it persists the real `Error.message` and sets `FAILED`.

- [ ] **Step 2: 在删除路由查找最新任务并拒绝活动状态**

```ts
const latestJob = await findLatestAnalysisJob(database, id);
if (latestJob && isActiveAnalysisStatus(latestJob.status)) {
  return reply.code(409).send({ error: "Music analysis is in progress and cannot be deleted" });
}
```

Run this check after confirming the track exists and before calling Feishu or `rm`.

- [ ] **Step 3: 在 `enrichTracks` 投影失败原因**

```ts
analysisError: job?.status === "FAILED" ? job.errorMessage : null,
analysisStatus: job?.status ?? "NONE",
```

Do not expose `managedPath`, `sourcePath`, or raw error stack data.

- [ ] **Step 4: 运行服务端回归测试并确认转绿**

Run: `pnpm --filter @analyze-music/node-service test -- tests/http-api.test.ts`

Expected: PASS，覆盖失败保留、重试清理、删除清理、活动删除拒绝和错误返回。

- [ ] **Step 5: 提交服务端生命周期实现**

```bash
git add apps/node-service/src/services/analysis-queue.ts apps/node-service/src/app.ts apps/node-service/tests/http-api.test.ts
git commit -m "feat: retain failed music for retries"
```

### Task 3: 覆盖并实现飞书多维表格链接

**Files:**

- Modify: `apps/node-service/src/app.ts:112-210`
- Modify: `apps/node-service/tests/http-api.test.ts:245-330`
- Modify: `apps/analyze-music/src/api.ts:61-82`

**Interfaces:**

- Consumes: `{ appToken: string; tableId: string }` from active Feishu connection.
- Produces: `libraryUrl: string | null` in `GET /api/feishu/status`; `libraryUrl: string` in `POST /api/feishu/export` and `POST /api/feishu/library`; matching admin API types.

- [ ] **Step 1: 扩展现有飞书 HTTP 测试为链接断言**

```ts
expect((await exportApp.inject({ method: "GET", url: "/api/feishu/status" })).json()).toMatchObject(
  {
    configured: true,
    libraryUrl: "https://feishu.cn/base/app_music?table=tbl_music"
  }
);
expect(
  (await exportApp.inject({ method: "POST", url: "/api/feishu/export" })).json()
).toMatchObject({
  libraryUrl: "https://feishu.cn/base/app_music?table=tbl_music"
});
```

- [ ] **Step 2: 运行测试，确认链接字段尚不存在**

Run: `pnpm --filter @analyze-music/node-service test -- tests/http-api.test.ts`

Expected: FAIL，响应没有 `libraryUrl`。

- [ ] **Step 3: 添加私有链接构造函数并应用到三条飞书响应**

```ts
function feishuLibraryUrl(connection: { appToken: string; tableId: string }) {
  return `https://feishu.cn/base/${encodeURIComponent(connection.appToken)}?table=${encodeURIComponent(connection.tableId)}`;
}
```

The unconfigured status must return `libraryUrl: null`; configured status, library create and export must return the constructed URL.

- [ ] **Step 4: 扩展客户端类型**

```ts
export interface FeishuStatus {
  /* existing fields */ libraryUrl: string | null;
}
export interface FeishuExportResult {
  /* existing fields */ libraryUrl: string;
}
```

- [ ] **Step 5: 运行服务端飞书测试并提交**

Run: `pnpm --filter @analyze-music/node-service test -- tests/http-api.test.ts`

Expected: PASS。

```bash
git add apps/node-service/src/app.ts apps/node-service/tests/http-api.test.ts apps/analyze-music/src/api.ts
git commit -m "feat: expose feishu library link"
```

### Task 4: 覆盖并实现后台失败操作与飞书跳转

**Files:**

- Modify: `apps/analyze-music/tests/music-page.test.tsx:20-150`
- Modify: `apps/analyze-music/tests/music-page.test.tsx:200-380`
- Modify: `apps/analyze-music/src/App.tsx:100-150`
- Modify: `apps/analyze-music/src/App.tsx:490-545`
- Modify: `apps/analyze-music/src/api.ts:1-45,180-230`
- Modify: `apps/analyze-music/src/styles.css:420-490`

**Interfaces:**

- Consumes: `MusicTrack.analysisError`, `MusicApi.retry`, `MusicApi.deleteMusic`, `FeishuStatus.libraryUrl`, `FeishuExportResult.libraryUrl`.
- Produces: 失败原因/重试/删除行操作和飞书外链。

- [ ] **Step 1: 将测试服务器的失败音乐和飞书响应扩展为期望字段**

```ts
const track = {
  analysisError: "临时分析服务不可用",
  analysisStatus: "FAILED" /* existing fields */
};
// configured status response:
libraryUrl: "https://feishu.cn/base/app_music?table=tbl_music";
// export response:
libraryUrl: "https://feishu.cn/base/app_music?table=tbl_music";
```

Handle `DELETE /api/music/track-1` with status 204 and make the retry handler record its request.

- [ ] **Step 2: 写失败行操作和跳转的失败测试**

```tsx
expect(await screen.findByText("失败原因：临时分析服务不可用")).toBeTruthy();
await user.click(screen.getByRole("button", { name: "重试分析" }));
await waitFor(() => expect(requestCount("/api/analysis-jobs/job-1/retry")).toBe(1));
await user.click(screen.getByRole("button", { name: "删除音乐" }));
await waitFor(() => expect(requestCount("/api/music/track-1")).toBe(1));
expect(screen.getByRole("link", { name: "打开飞书多维表格" })).toHaveAttribute("target", "_blank");
```

Mock `window.confirm` to return true in the deletion test and restore it after the test.

- [ ] **Step 3: 运行前端测试，确认失败原因、删除接口和链接尚不存在**

Run: `pnpm --filter @analyze-music/admin test -- tests/music-page.test.tsx`

Expected: FAIL，找不到失败原因、重试/删除按钮或飞书链接。

- [ ] **Step 4: 添加 API 删除方法与三条 React Query mutation**

```ts
async deleteMusic(trackId: string) {
  await this.request<void>(`/music/${trackId}`, { method: "DELETE" });
}
```

Add retry and delete mutations that set Chinese notices and call the existing `refresh()`. Pass them into `TrackRow`; when a failed row has `analysisError`, render it below the retry control. Render a delete button in every row and disable it for active statuses or while its mutation is pending.

- [ ] **Step 5: 渲染飞书链接并在导出通知中提供跳转**

```tsx
{
  feishuQuery.data?.libraryUrl ? (
    <a href={feishuQuery.data.libraryUrl} rel="noreferrer" target="_blank">
      打开飞书多维表格
    </a>
  ) : null;
}
```

Keep the existing export button. In its success handler store or render the returned link so first export exposes the link immediately before the status query refetches.

- [ ] **Step 6: 为新行操作补充紧凑样式并运行前端测试**

Run: `pnpm --filter @analyze-music/admin test -- tests/music-page.test.tsx`

Expected: PASS，失败原因可见，重试和删除均发出正确请求，飞书链接安全地在新标签页打开。

- [ ] **Step 7: 提交后台实现**

```bash
git add apps/analyze-music/src/App.tsx apps/analyze-music/src/api.ts apps/analyze-music/src/styles.css apps/analyze-music/tests/music-page.test.tsx
git commit -m "feat: manage failed music from admin"
```

### Task 5: 端到端回归与交付验证

**Files:**

- Modify: `apps/analyze-music/tests/playwright/music-admin.spec.ts` only if current browser test needs selectors for new controls.

**Interfaces:**

- Consumes: 完整本地服务与管理后台。
- Produces: 可复现的全量验证证据。

- [ ] **Step 1: 运行格式、类型和全量测试**

Run: `pnpm verify`

Expected: exit 0，所有 lint、typecheck、unit、API 和浏览器测试通过。

- [ ] **Step 2: 在本地启动服务并验证实际 API 响应**

Run: `pnpm run dev:music`

Then call `GET /api/feishu/status` and confirm `libraryUrl` is present for the configured local library without printing credentials.

- [ ] **Step 3: 检查交付差异并提交验证调整**

Run: `git diff --check && git status --short && git log --oneline main..HEAD`

Expected: 无空白错误；仅本功能的受跟踪文件有差异。
