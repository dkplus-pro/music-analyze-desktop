# 飞书音乐导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过一个“导出飞书”按钮，将所有本地音乐业务字段以正确的飞书多维表格字段类型进行可重复、增量的导出。

**Architecture:** 服务端以 `feishu-library-schema.ts` 集中定义飞书字段和本地记录转换，避免建库字段与同步字段漂移。`POST /api/feishu/export` 在未配置库时完成建库、持久化 app/table 标识，再调用现有同步服务；前端只调用这一个端点并显示导出结果。

**Tech Stack:** Fastify、TypeScript、Drizzle/SQLite、Vitest、React、TanStack Query、飞书 Bitable OpenAPI。

## Global Constraints

- 凭证仅从 Git 忽略的 `.env` 的 `FEISHU_APP_ID`、`FEISHU_APP_SECRET` 读取，不能写入源码、数据库、日志、错误信息或测试快照。
- 不上传、不保存或导出音频文件；不导出已失效的 `sourcePath`、`managedPath`。
- 可枚举字段必须用飞书 type `3`（单选）或 `4`（多选）和 `property.options: [{ name }]`；其它字段使用文本、数字或日期。
- 一首音乐一条飞书记录；同步通过 `feishu_sync_records` 幂等增量更新，单条失败不能中断其它记录。
- 导出文案与字段名称使用中文；音乐摘要及结构说明保持中文。

---

### Task 1: 完整飞书字段架构与记录转换

**Files:**

- Create: `apps/node-service/src/services/feishu-library-schema.ts`
- Modify: `apps/node-service/src/services/feishu-exporter.ts`
- Modify: `apps/node-service/src/services/feishu-sync-service.ts`
- Test: `apps/node-service/tests/feishu-library-schema.test.ts`
- Test: `apps/node-service/tests/feishu-exporter.test.ts`

**Interfaces:**

- Consumes: `packages/music-domain/src/taxonomy.ts` 的分类常量，以及 music tracks、analysis、features 和 segments 的业务字段。
- Produces: `feishuLibraryFields`（建表字段数组）与 `toFeishuRecord(track, recordId?)`（全量业务记录）；provisioner 只使用前者，sync service 只使用后者。

- [ ] **Step 1: 写会失败的字段与转换测试**

在 `feishu-library-schema.test.ts` 建立完整的 `FeishuExportTrack` fixture。测试 type `3` 的 `主情绪`、type `4` 的 `叙事功能` 都有从领域分类生成的 options；测试存在 `格式`、`调式`、`分析状态`、`音乐结构`、`原始 AI 结果`。测试转换记录保留文件哈希、数值特征、版本信息、原始 AI JSON 与中文结构说明，但没有 `sourcePath`、`managedPath`。

```ts
expect(field("主情绪")).toMatchObject({
  type: 3,
  property: { options: primaryEmotionValues.map((name) => ({ name })) }
});
expect(toFeishuRecord(track).fields).toMatchObject({
  文件哈希: "sha256",
  音乐结构: expect.stringContaining("高潮"),
  分析状态: "已完成"
});
```

- [ ] **Step 2: 验证测试确实失败**

Run: `pnpm --filter @analyze-music/node-service test -- feishu-library-schema.test.ts`

Expected: FAIL，原因是 `feishu-library-schema.js` 或其导出尚不存在。

- [ ] **Step 3: 实现最小字段架构与转换器**

新模块从 `@analyze-music/music-domain` 引入 taxonomy，定义统一的 field request 体。用下列辅助函数创建可选字段：

```ts
const singleSelect = (field_name: string, values: readonly string[]) => ({
  field_name,
  type: 3,
  property: { options: values.map((name) => ({ name })) }
});
```

扩展 `FeishuExportTrack` 包含每个业务数据库字段，序列化对象/数组为 JSON，并将 segment 的类型转换为中文且保留起止时间、能量、张力、说明。`toFeishuRecord` 仅写已声明的字段。`feishu-exporter.ts` 从新模块导入 `feishuLibraryFields`，移除私有的旧字段列表。

- [ ] **Step 4: 验证字段及 exporter 测试通过**

Run: `pnpm --filter @analyze-music/node-service test -- feishu-library-schema.test.ts feishu-exporter.test.ts`

Expected: PASS；建表请求数为 `feishuLibraryFields.length`，选项字段包含 `property.options`。

- [ ] **Step 5: 提交字段和转换实现**

Run:

```bash
git add apps/node-service/src/services/feishu-library-schema.ts apps/node-service/src/services/feishu-exporter.ts apps/node-service/src/services/feishu-sync-service.ts apps/node-service/tests/feishu-library-schema.test.ts apps/node-service/tests/feishu-exporter.test.ts
git commit -m "feat: export complete music fields to feishu"
```

### Task 2: 原子化导出 API 与全量数据装配

**Files:**

- Modify: `apps/node-service/src/app.ts`
- Test: `apps/node-service/tests/http-api.test.ts`

**Interfaces:**

- Consumes: `FeishuLibraryProvisioner.createLibrary()`、`createFeishuSyncService()`、`FeishuExportTrack`、`enrichTracks(database, tracks, true)`。
- Produces: `POST /api/feishu/export`，返回 `{ appToken, tableId, created, updated, skipped, failed }`；只在建库成功后写 app settings。

- [ ] **Step 1: 写会失败的 API 测试**

在 `http-api.test.ts` 向 `buildApp` 注入 fake provisioner 和记录 exporter。导入一首测试音乐后调用新路由；断言第一次为 `201`、新增 `1`、保存两个 app settings，exporter 接收 `文件哈希` 和 `音乐结构`。第二次为 `200` 且跳过；没有 provisioner 或 active service 时为 `503`。

```ts
const first = await app.inject({ method: "POST", url: "/api/feishu/export" });
expect(first.statusCode).toBe(201);
expect(first.json()).toMatchObject({ created: 1, failed: 0, tableId: "tbl_music" });
```

- [ ] **Step 2: 验证新路由缺失导致失败**

Run: `pnpm --filter @analyze-music/node-service test -- http-api.test.ts`

Expected: FAIL，`POST /api/feishu/export` 为 `404`。

- [ ] **Step 3: 实现导出路由**

提取 `activateFeishuLibrary(library)`：创建 sync service，并 upsert `feishuAppToken` 和 `feishuTableId`。路由没有 active service 时创建并激活库；以 `enrichTracks(..., true)` 取得所有字段后同步；新库返回 `201`，已有库返回 `200`；OpenAPI 错误转为不含凭证的 `502`。

```ts
const result = await activeFeishuSyncService.sync(await exportTracks());
return reply.code(createdLibrary ? 201 : 200).send({ appToken, tableId, ...result });
```

- [ ] **Step 4: 验证 API 测试通过**

Run: `pnpm --filter @analyze-music/node-service test -- http-api.test.ts`

Expected: PASS，含首次、增量和未配置导出情形。

- [ ] **Step 5: 提交导出 API**

Run:

```bash
git add apps/node-service/src/app.ts apps/node-service/tests/http-api.test.ts
git commit -m "feat: add one-click feishu export api"
```

### Task 3: 管理后台按钮、环境说明与回归测试

**Files:**

- Modify: `apps/analyze-music/src/api.ts`
- Modify: `apps/analyze-music/src/App.tsx`
- Modify: `apps/analyze-music/tests/music-page.test.tsx`
- Modify: `README.md`

**Interfaces:**

- Consumes: `POST /api/feishu/export` 的 `{ appToken, tableId, created, updated, skipped, failed }`。
- Produces: 单一“导出飞书”操作和中文通知；安全的环境配置说明。

- [ ] **Step 1: 写会失败的前端行为测试**

在 `music-page.test.tsx` mock `/api/feishu/export`。断言只显示“导出飞书”，不显示“创建飞书库”或“同步飞书”；点击后请求一次新 endpoint，并显示结果。

```tsx
await user.click(screen.getByRole("button", { name: "导出飞书" }));
expect(await screen.findByText("飞书导出完成：新增 1，更新 0，跳过 0，失败 0。")).toBeVisible();
```

- [ ] **Step 2: 验证前端测试失败**

Run: `pnpm --filter @analyze-music/admin test -- music-page.test.tsx`

Expected: FAIL，按钮或新 endpoint 尚不存在。

- [ ] **Step 3: 实现一个按钮与文档**

`MusicApi` 新增 `exportFeishu()`；`App.tsx` 用单个 mutation 取代建库与同步按钮；按钮未配置时仍可见但说明需要 `.env` 凭证；成功通知显示完整计数。README 只列环境变量名和配置步骤，绝不写入真实 secret。

```ts
async exportFeishu() {
  return this.request<FeishuExportResult>("/feishu/export", { method: "POST" });
}
```

- [ ] **Step 4: 验证前端与全仓库通过**

Run: `pnpm --filter @analyze-music/admin test -- music-page.test.tsx && pnpm verify`

Expected: PASS，lint、typecheck、单元及浏览器测试完成。

- [ ] **Step 5: 提交用户界面和文档**

Run:

```bash
git add apps/analyze-music/src/api.ts apps/analyze-music/src/App.tsx apps/analyze-music/tests/music-page.test.tsx README.md
git commit -m "feat: add feishu export action"
```

### Task 4: 使用本地凭证进行真实飞书验证

**Files:**

- Modify: `.env`（Git 忽略，不提交）
- Verify: `apps/node-service/data/analyze-music.db`

**Interfaces:**

- Consumes: `FEISHU_APP_ID`、`FEISHU_APP_SECRET` 与 `POST /api/feishu/export`。
- Produces: 真实飞书多维表格和持久化的 app/table 标识，供之后点击增量同步。

- [ ] **Step 1: 安全设置本地凭证**

确认 `.env` 被 Git 忽略后，写入 provided app id 与 secret。不要回显 `.env`、密钥、完整环境变量或 HTTP Authorization 头。

- [ ] **Step 2: 重启服务**

Run: `pnpm run dev:music`

Expected: API 在 `http://localhost:3001`，后台在 `http://localhost:5173`。

- [ ] **Step 3: 首次真实导出**

Run: `curl -sS -X POST http://localhost:3001/api/feishu/export`

Expected: HTTP `201`，仅返回 app/table 标识和计数，`failed` 为 `0`。

- [ ] **Step 4: 验证幂等导出**

Run: `curl -sS -X POST http://localhost:3001/api/feishu/export`

Expected: HTTP `200`，`created: 0`、`updated: 0`、`skipped` 等于已同步音乐数、`failed: 0`。

- [ ] **Step 5: 最终验证与提交**

Run: `git status --short && pnpm verify`

Expected: `.env` 和数据库未出现在 Git 变更中；所有代码、测试和文档均已提交。
