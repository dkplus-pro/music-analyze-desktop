# Analyze Music V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a local, runnable music-library admin that imports supported audio files, detects content duplicates, queues AI analysis, and lets an operator retry failures.

**Architecture:** `apps/node-service` owns persistent SQLite data, managed-file storage, ffprobe metadata, duplicate detection, and the analysis queue. `apps/analyze-music` is a React admin client that uses the HTTP API; it never receives the Bailian key. Shared Zod contracts hold the fixed cinematic taxonomy and API DTOs.

**Tech Stack:** Node.js, TypeScript, Fastify, Drizzle ORM, SQLite, Zod, React, Vite, TanStack Query, Zustand, Vitest, Playwright, ffprobe, DashScope OpenAI-compatible API.

## Global Constraints

- Keep the existing pnpm/Turborepo workspace structure; add applications under `apps/*` and packages under `packages/*`.
- Persist music under `data/music` and the SQLite database under `data/analyze-music.db`; neither belongs in Git.
- Accepted import formats are MP3, WAV, FLAC, M4A, AAC, and OGG; SHA-256 decides content equality.
- Import and AI analysis are separate jobs. A failed item does not abort other imports.
- AI output must validate against the fixed music taxonomy; a retry records an error and moves a failed analysis job back to `QUEUED`.
- API credentials are read only from the Node environment (`BAILIAN_API_KEY`), never returned by an endpoint or committed.
- Manual overrides are stored separately from AI values and win when the effective value is read.

---

## File structure

- `packages/music-domain/src/*`: fixed classification lists, Zod analysis schema, and effective-value helper.
- `packages/contracts/src/*`: request/response schemas shared by browser and service.
- `packages/database/src/*`: Drizzle SQLite schema and database factory.
- `apps/node-service/src/*`: Fastify routes, import service, ffprobe adapter, analysis queue, and Bailian adapter.
- `apps/analyze-music/src/*`: Vite React admin view, API client, server-state hooks, and small UI store.
- `apps/*/tests/*`: unit/integration tests that exercise public behavior; `tests/playwright` verifies the management screen.

### Task 1: Create shared taxonomy, analysis contract, and database tables

**Files:**
- Create: `packages/music-domain/src/taxonomy.ts`, `packages/music-domain/src/analysis.ts`, `packages/music-domain/src/index.ts`, `packages/music-domain/tests/analysis.test.ts`
- Create: `packages/contracts/src/index.ts`, `packages/database/src/schema.ts`, `packages/database/src/index.ts`
- Create: package manifests and TypeScript configurations for all three packages.

**Interfaces:**
- Produces `analysisResultSchema`, `AnalysisResult`, `primaryEmotionValues`, and `effectiveValue(manual, ai)`.
- Produces Drizzle `musicTracks`, `musicAnalysis`, `analysisJobs`, `importJobs`, and `importFiles` tables.

- [ ] **Step 1: Write failing taxonomy tests**

```ts
expect(analysisResultSchema.safeParse({ primaryEmotion: "Nostalgic", narrativeFunctions: ["Memory"], cinematicStyles: ["Drama"], cinematicScore: 8, summary: "Warm piano" }).success).toBe(true);
expect(analysisResultSchema.safeParse({ primaryEmotion: "Invented", narrativeFunctions: [], cinematicStyles: [], cinematicScore: 8, summary: "x" }).success).toBe(false);
expect(effectiveValue("Nostalgic", "Sad")).toBe("Nostalgic");
```

- [ ] **Step 2: Run `pnpm --filter @analyze-music/music-domain test` and observe that it fails because the package does not exist.**
- [ ] **Step 3: Add only the schema, taxonomy arrays, effective-value helper, and relational table declarations necessary for these contracts.**
- [ ] **Step 4: Re-run the package test and typecheck; expect both to pass.**

### Task 2: Build import, duplicate-detection, and metadata services

**Files:**
- Create: `apps/node-service/src/services/file-hash.ts`, `audio-metadata.ts`, `import-service.ts`
- Create: `apps/node-service/tests/import-service.test.ts`

**Interfaces:**
- Consumes `Database`, `musicTracks`, `importJobs`, and `importFiles`.
- Produces `importFile({ sourcePath, originalFilename }): Promise<{ kind: "IMPORTED" | "DUPLICATE"; trackId?: string; duplicateOf?: string }>`.

- [ ] **Step 1: Write failing tests using `tests/sample/10 希望.mp3` that assert an initial import copies a managed file and a second same-content import returns `DUPLICATE` without creating a second track.**
- [ ] **Step 2: Run `pnpm --filter @analyze-music/node-service test -- import-service`; expect a missing-module failure.**
- [ ] **Step 3: Implement SHA-256 streaming, ffprobe JSON parsing for duration/format/bitrate/channels, atomic managed-file copy, and a hash lookup before insert.**
- [ ] **Step 4: Re-run the test; expect one track, one managed file, and a duplicate result on the second call.**

### Task 3: Add the Fastify music/import API and audio range endpoint

**Files:**
- Create: `apps/node-service/src/app.ts`, `main.ts`, `routes/music.ts`, `routes/import.ts`, `routes/health.ts`
- Create: `apps/node-service/tests/http-api.test.ts`

**Interfaces:**
- Produces `buildApp({ database, storageRoot, analyzer }): FastifyInstance`.
- Endpoints: `GET /api/health`, `GET /api/music`, `GET/PATCH/DELETE /api/music/:id`, `POST /api/import`, `GET /api/music/:id/audio`.

- [ ] **Step 1: Write failing `app.inject` tests that import a sample, list it, filter by title, and request `Range: bytes=0-31` from its audio URL. Assert `206`, `content-range`, and exactly 32 bytes.**
- [ ] **Step 2: Run the focused test and observe routes are unregistered.**
- [ ] **Step 3: Register Zod-validated routes and implement pagination/filtering, manual-field patching, file deletion, and RFC 7233 single-range streaming.**
- [ ] **Step 4: Re-run the API tests; expect the observable responses and range bytes to match.**

### Task 4: Add analysis queue, resilient Bailian adapter, and retry endpoint

**Files:**
- Create: `apps/node-service/src/services/analysis-service.ts`, `analysis-queue.ts`, `bailian-analyzer.ts`, `routes/analysis.ts`
- Create: `apps/node-service/tests/analysis-queue.test.ts`, `bailian-analyzer.test.ts`

**Interfaces:**
- Consumes `MusicAnalyzer.analyze({ filePath, metadata })` and returns `AnalysisResult`.
- Produces `enqueue(trackId)`, `processNext()`, `retry(jobId)`, `POST /api/music/:id/analyze`, `POST /api/analysis-jobs/:id/retry`, `GET /api/analysis-jobs`.

- [ ] **Step 1: Write a failing queue test with an analyzer that fails once then succeeds: after `processNext`, the job must be `FAILED` with an error; after `retry` and another `processNext`, it must be `COMPLETED` with a saved analysis.**
- [ ] **Step 2: Write a failing adapter test that supplies fenced JSON containing an unsupported emotion and asserts the adapter rejects it before persistence.**
- [ ] **Step 3: Run both focused tests; expect missing queue and adapter modules.**
- [ ] **Step 4: Implement transactional state transitions (`QUEUED → EXTRACTING → AI_ANALYZING → VALIDATING → COMPLETED|FAILED`), validation, JSON extraction, a one-time repair request, and `FAILED → QUEUED` retry. Only create the network client when `BAILIAN_API_KEY` is defined.**
- [ ] **Step 5: Re-run focused tests; expect failure isolation, a successful explicit retry, and malformed output rejected.**

### Task 5: Create the React management screen

**Files:**
- Create: `apps/analyze-music/src/*`, `vite.config.ts`, `package.json`, `tests/music-page.test.tsx`
- Modify: root Playwright configuration and documentation to start/check the new app.

**Interfaces:**
- Consumes `GET /api/music`, `POST /api/import`, `POST /api/music/:id/analyze`, and `POST /api/analysis-jobs/:id/retry`.
- Produces the `/` admin screen with search/filter controls, import picker, table, analysis status, duplicate feedback, and retry button for failed jobs.

- [ ] **Step 1: Write a failing UI test that uses a test HTTP server: a failed job renders a `重新尝试` button, clicking it sends its job ID to the retry endpoint, and duplicate import feedback displays `已存在`.**
- [ ] **Step 2: Run the focused component test and observe the missing page module.**
- [ ] **Step 3: Implement a responsive Vite React screen with TanStack Query for API data/mutations and Zustand only for selected track/import dialog state.**
- [ ] **Step 4: Re-run the UI test and `pnpm --filter @analyze-music/admin typecheck`; expect both to pass.**

### Task 6: Verify end-to-end behavior with supplied audio fixtures

**Files:**
- Create: `apps/node-service/tests/e2e-sample-import.test.ts`, `tests/playwright/analyze-music.spec.ts`
- Modify: `README.md`, `.gitignore`, `.env.example`, workspace manifests.

**Interfaces:**
- Consumes application startup configuration `{ DATABASE_URL, MUSIC_STORAGE_PATH, BAILIAN_API_KEY }`.
- Produces repeatable `dev`, `build`, `lint`, `typecheck`, and `test` scripts per workspace.

- [ ] **Step 1: Write a failing integration test that imports two distinct files from `tests/sample`, imports the first again, queues an analyzer that succeeds, and retries another analyzer job that initially fails. Assert two tracks, one duplicate, one completed analysis, and one completed retry.**
- [ ] **Step 2: Run it against a temporary database and storage directory; expect a missing integration composition failure.**
- [ ] **Step 3: Compose the real database, importer, and queue in the test harness; add a browser smoke test for the visible retry action.**
- [ ] **Step 4: Run each package’s test/typecheck/lint/build command, then root `pnpm verify`; record exact passing commands in the README.**

## Self-review

- Coverage: Tasks 1–6 cover the V1 local library, managed import, SHA-256 duplicate check, metadata, structured AI output, fixed taxonomy, SQLite queue, failure retry, manual override, filterable admin UI, and test fixtures. Feishu, waveforms, and full Essentia extraction remain intentionally outside this first independently runnable slice.
- Consistency: all tasks use `AnalysisResult`, `MusicAnalyzer`, and the same job-state names; the front end never handles an API key.
- Scope: the initial delivery excludes remote Feishu writes and a browser directory walker because the managed `POST /api/import` route establishes the reliable file-import core first.
