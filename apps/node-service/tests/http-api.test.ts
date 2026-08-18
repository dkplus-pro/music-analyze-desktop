import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { appSettings, createDatabase, musicTracks } from "@analyze-music/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { FeishuMusicRecord, MusicExporter } from "../src/services/feishu-exporter.js";
import { createFeishuSyncService } from "../src/services/feishu-sync-service.js";
import { createSettingsService } from "../src/services/settings-service.js";

const samplePath = fileURLToPath(
  new URL("../../../tests/sample/10%20%E5%B8%8C%E6%9C%9B.mp3", import.meta.url)
);
const desktopFileActionToken = "desktop-file-action-test-token";

describe("music HTTP API", () => {
  let temporaryRoot: string;
  let database: Awaited<ReturnType<typeof createDatabase>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let remainingAnalysisFailures: number;

  beforeEach(async () => {
    process.env["MUSIC_DESKTOP_FILE_ACTION_TOKEN"] = desktopFileActionToken;
    temporaryRoot = await mkdtemp(join(tmpdir(), "analyze-music-api-"));
    database = await createDatabase({ url: `file:${join(temporaryRoot, "music.db")}` });
    const settingsEnvPath = join(temporaryRoot, ".env");
    await writeFile(
      settingsEnvPath,
      [
        "BAILIAN_API_KEY=sk-test-secret",
        "BAILIAN_BASE_URL=https://dashscope.example/v1",
        "BAILIAN_MODEL=qwen-test"
      ].join("\n")
    );
    remainingAnalysisFailures = 0;
    app = await buildApp({
      analyzer: {
        analyze: async () => {
          if (remainingAnalysisFailures > 0) {
            remainingAnalysisFailures -= 1;
            throw new Error("temporary analyzer failure");
          }
          return {
            cinematicScore: 8,
            cinematicStyles: ["Drama"],
            dialogueFriendly: 9,
            instrumentation: ["Piano"],
            narrativeFunctions: ["Memory"],
            primaryEmotion: "Nostalgic",
            recommendedScenes: ["人物回忆"],
            secondaryEmotions: [],
            segments: [{ description: "Piano opening", endMs: 20_000, startMs: 0, type: "Intro" }],
            summary: "Warm piano"
          };
        }
      },
      database,
      featureAnalyzer: {
        analyze: async () => ({
          beatPositions: [0.4, 1.2],
          bpm: 76.4,
          dynamicRange: 12.1,
          energyCurve: [0.1, 0.9],
          extractor: "test",
          key: "D",
          loudness: -16.3,
          mode: "minor"
        })
      },
      processAnalysisImmediately: true,
      settingsService: createSettingsService({ envPath: settingsEnvPath, environment: {} }),
      storageRoot: join(temporaryRoot, "music")
    });
  });

  afterEach(async () => {
    await app.close();
    database.close();
    delete process.env["MUSIC_DESKTOP_FILE_ACTION_TOKEN"];
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  it("automatically analyzes an import and releases its temporary audio file", async () => {
    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({
      status: "ok"
    });

    const imported = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { originalFilename: "10 希望.mp3", sourcePath: samplePath }
    });
    expect(imported.statusCode).toBe(201);
    const importResult = imported.json() as { trackId: string };

    const music = await app.inject({ method: "GET", url: "/api/music?search=10" });
    expect(music.statusCode).toBe(200);
    expect(music.json()).toMatchObject({
      items: [{ analysisStatus: "COMPLETED", id: importResult.trackId, title: "10 希望" }],
      total: 1
    });

    const [storedTrack] = await database.db.select().from(musicTracks);
    expect(storedTrack?.managedPath).toEqual(expect.any(String));
    await expect(access(storedTrack!.managedPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(samplePath)).resolves.toBeUndefined();

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/music/${importResult.trackId}`,
      payload: { manualPrimaryEmotion: "Nostalgic" }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      id: importResult.trackId,
      manualPrimaryEmotion: "Nostalgic"
    });

    const audio = await app.inject({
      method: "GET",
      url: `/api/music/${importResult.trackId}/audio`
    });
    expect(audio.statusCode).toBe(410);

    expect(
      (await app.inject({ method: "DELETE", url: `/api/music/${importResult.trackId}` })).statusCode
    ).toBe(204);
    expect(
      (await app.inject({ method: "GET", url: `/api/music/${importResult.trackId}` })).statusCode
    ).toBe(404);
  });

  it("analyzes a linked source without copying or deleting the original file", async () => {
    const imported = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: {
        originalFilename: "10 希望.mp3",
        sourcePath: samplePath,
        storageMode: "LINKED_SOURCE"
      }
    });

    expect(imported.statusCode).toBe(201);
    const { trackId } = imported.json() as { trackId: string };
    const [storedTrack] = await database.db.select().from(musicTracks);

    expect(storedTrack?.id).toBe(trackId);
    expect(storedTrack?.sourcePath).toBe(samplePath);
    expect(storedTrack?.managedPath).toBe(samplePath);
    await expect(access(samplePath)).resolves.toBeUndefined();
    await expect(access(join(temporaryRoot, "music"))).rejects.toMatchObject({ code: "ENOENT" });

    expect((await app.inject({ method: "DELETE", url: `/api/music/${trackId}` })).statusCode).toBe(
      204
    );
    await expect(access(samplePath)).resolves.toBeUndefined();
  });

  it("resolves a library source path only for the trusted desktop action token", async () => {
    const imported = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: {
        originalFilename: "10 希望.mp3",
        sourcePath: samplePath,
        storageMode: "LINKED_SOURCE"
      }
    });
    const { trackId } = imported.json() as { trackId: string };
    const url = `/api/desktop/music/${trackId}/source-path`;

    expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          headers: { "x-music-desktop-file-action-token": "incorrect" },
          method: "GET",
          url
        })
      ).statusCode
    ).toBe(404);

    const response = await app.inject({
      headers: { "x-music-desktop-file-action-token": desktopFileActionToken },
      method: "GET",
      url
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sourcePath: samplePath });
  });

  it("keeps a linked source available across a failed analysis and retry", async () => {
    remainingAnalysisFailures = 1;
    const imported = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: {
        originalFilename: "10 希望.mp3",
        sourcePath: samplePath,
        storageMode: "LINKED_SOURCE"
      }
    });

    expect(imported.statusCode).toBe(201);
    const { trackId } = imported.json() as { trackId: string };
    const failedJobs = (
      await app.inject({ method: "GET", url: "/api/analysis-jobs" })
    ).json() as Array<{ id: string; status: string }>;
    expect(failedJobs).toMatchObject([{ status: "FAILED" }]);
    await expect(access(samplePath)).resolves.toBeUndefined();

    const retry = await app.inject({
      method: "POST",
      url: `/api/analysis-jobs/${failedJobs[0]!.id}/retry`
    });
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toMatchObject({ status: "COMPLETED" });
    expect(
      (await app.inject({ method: "GET", url: `/api/music/${trackId}` })).json()
    ).toMatchObject({ analysisStatus: "COMPLETED" });
    await expect(access(samplePath)).resolves.toBeUndefined();
  });

  it("imports an audio file supplied by the browser as multipart form data", async () => {
    const boundary = "----analyze-music-boundary";
    const audio = await readFile(samplePath);
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="10 希望.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`
      ),
      audio,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const response = await app.inject({
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      method: "POST",
      payload,
      url: "/api/import"
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ kind: "IMPORTED" });
  });

  it("reads and updates masked local AI settings", async () => {
    const settings = await app.inject({ method: "GET", url: "/api/settings" });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toMatchObject({
      ai: {
        apiKeyConfigured: true,
        apiKeySuffix: "...secret",
        baseUrl: "https://dashscope.example/v1",
        model: "qwen-test"
      }
    });
    expect(JSON.stringify(settings.json())).not.toContain("sk-test-secret");

    const updated = await app.inject({
      method: "PATCH",
      payload: { ai: { apiKey: "", model: "qwen-updated" } },
      url: "/api/settings"
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      ai: { apiKeyConfigured: true, apiKeySuffix: "...secret", model: "qwen-updated" }
    });
  });

  it("tracks a browser import session across its manifest and file upload", async () => {
    const audio = await readFile(samplePath);
    const session = await app.inject({ method: "POST", url: "/api/import-sessions" });
    expect(session.statusCode).toBe(201);
    const { id: sessionId } = session.json() as { id: string };

    const manifest = await app.inject({
      method: "POST",
      payload: { files: [{ clientId: "cue-001", name: "10 希望.mp3", size: audio.length }] },
      url: `/api/import-sessions/${sessionId}/manifest`
    });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.json()).toMatchObject({ accepted: 1, rejected: 0, status: "IMPORTING" });

    const uploaded = await app.inject({
      headers: { "content-type": "multipart/form-data; boundary=----session-boundary" },
      method: "POST",
      payload: multipartPayload("----session-boundary", audio, "10 希望.mp3"),
      url: `/api/import-sessions/${sessionId}/files/cue-001`
    });
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.json()).toMatchObject({ kind: "IMPORTED" });

    const progress = await app.inject({ method: "GET", url: `/api/import-jobs/${sessionId}` });
    expect(progress.json()).toMatchObject({
      counts: { completed: 1, duplicate: 0, failed: 0, total: 1 },
      files: [{ clientId: "cue-001", name: "10 希望.mp3", status: "IMPORTED" }],
      id: sessionId,
      status: "COMPLETED"
    });

    const duplicateManifest = await app.inject({
      method: "POST",
      payload: { files: [{ clientId: "cue-001", name: "10 希望.mp3", size: audio.length }] },
      url: `/api/import-sessions/${sessionId}/manifest`
    });
    expect(duplicateManifest.statusCode).toBe(409);
  });

  it("sends the current import-session state over SSE", async () => {
    const session = await app.inject({ method: "POST", url: "/api/import-sessions" });
    const { id: sessionId } = session.json() as { id: string };
    const origin = await app.listen({ host: "127.0.0.1", port: 0 });

    const response = await fetch(`${origin}/api/import-jobs/${sessionId}/events`);
    const reader = response.body?.getReader();
    const event = await reader?.read();
    await reader?.cancel();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(new TextDecoder().decode(event?.value)).toContain("event: progress");
    expect(new TextDecoder().decode(event?.value)).toContain(`"id":"${sessionId}"`);
  });

  it("keeps failed audio for retry, exposes its reason, and releases it after success", async () => {
    remainingAnalysisFailures = 1;
    const imported = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { originalFilename: "10 希望.mp3", sourcePath: samplePath }
    });
    const { trackId } = imported.json() as { trackId: string };
    const jobs = (await app.inject({ method: "GET", url: "/api/analysis-jobs" })).json() as Array<{
      id: string;
      status: string;
    }>;
    expect(jobs).toHaveLength(1);
    const jobId = jobs[0]!.id;
    expect((await app.inject({ method: "GET", url: "/api/analysis-jobs" })).json()).toMatchObject([
      { id: jobId, status: "FAILED" }
    ]);
    const [storedTrack] = await database.db.select().from(musicTracks);
    await expect(access(storedTrack!.managedPath)).resolves.toBeUndefined();
    expect(
      (await app.inject({ method: "GET", url: `/api/music/${trackId}` })).json()
    ).toMatchObject({
      analysisError: "temporary analyzer failure",
      analysisJobId: jobId,
      analysisStatus: "FAILED"
    });

    const retry = await app.inject({ method: "POST", url: `/api/analysis-jobs/${jobId}/retry` });
    expect(retry.statusCode).toBe(202);
    expect(retry.json()).toMatchObject({ id: jobId, status: "COMPLETED" });
    await expect(access(storedTrack!.managedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("deletes retained failed audio with its music record", async () => {
    remainingAnalysisFailures = 1;
    const imported = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { originalFilename: "10 希望.mp3", sourcePath: samplePath }
    });
    const { trackId } = imported.json() as { trackId: string };
    const [storedTrack] = await database.db.select().from(musicTracks);
    await expect(access(storedTrack!.managedPath)).resolves.toBeUndefined();

    expect((await app.inject({ method: "DELETE", url: `/api/music/${trackId}` })).statusCode).toBe(
      204
    );
    await expect(access(storedTrack!.managedPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await app.inject({ method: "GET", url: `/api/music/${trackId}` })).statusCode).toBe(
      404
    );
  });

  it("does not delete music while its analysis is active", async () => {
    const activeApp = await buildApp({
      analyzer: {
        analyze: async () => new Promise(() => undefined)
      },
      analysisPollIntervalMs: 60_000,
      database,
      processAnalysisImmediately: false,
      storageRoot: join(temporaryRoot, "active-music")
    });
    try {
      const imported = await activeApp.inject({
        method: "POST",
        url: "/api/import",
        payload: { originalFilename: "10 希望.mp3", sourcePath: samplePath }
      });
      const { trackId } = imported.json() as { trackId: string };

      const deleted = await activeApp.inject({ method: "DELETE", url: `/api/music/${trackId}` });
      expect(deleted.statusCode).toBe(409);
      expect(deleted.json()).toMatchObject({
        error: "Music analysis is in progress and cannot be deleted"
      });
    } finally {
      await activeApp.close();
    }
  });

  it("queues a selected batch of tracks through one endpoint", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/import",
      payload: { originalFilename: "10 希望.mp3", sourcePath: samplePath }
    });
    const firstTrack = (first.json() as { trackId: string }).trackId;

    const batch = await app.inject({
      method: "POST",
      payload: { trackIds: [firstTrack] },
      url: "/api/music/batch-analyze"
    });

    expect(batch.statusCode).toBe(202);
    expect(batch.json()).toMatchObject({ jobs: [], queued: 0, skipped: 1 });
  });

  it("reports when Feishu synchronization has not been configured", async () => {
    expect((await app.inject({ method: "GET", url: "/api/feishu/status" })).json()).toMatchObject({
      configured: false,
      libraryUrl: null
    });
    expect((await app.inject({ method: "POST", url: "/api/feishu/sync" })).statusCode).toBe(503);
    expect((await app.inject({ method: "POST", url: "/api/feishu/export" })).statusCode).toBe(503);
  });

  it("creates a Feishu library once then exports complete records incrementally", async () => {
    const imported = await app.inject({
      method: "POST",
      payload: { originalFilename: "10 希望.mp3", sourcePath: samplePath },
      url: "/api/import"
    });
    expect(imported.statusCode).toBe(201);

    const exportedRecords: FeishuMusicRecord[] = [];
    const exporter: MusicExporter = {
      deleteMusic: async () => undefined,
      syncMusic: async (records) => {
        exportedRecords.push(...records);
        return records.map((record, index) => ({
          recordId: `rec_${exportedRecords.length - records.length + index + 1}`,
          trackId: record.trackId
        }));
      }
    };
    const exportApp = await buildApp({
      database,
      feishuLibraryProvisioner: {
        createLibrary: async () => ({ appToken: "app_music", exporter, tableId: "tbl_music" })
      },
      storageRoot: join(temporaryRoot, "music")
    });

    try {
      const first = await exportApp.inject({ method: "POST", url: "/api/feishu/export" });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({
        appToken: "app_music",
        created: 1,
        failed: 0,
        libraryUrl: "https://feishu.cn/base/app_music?table=tbl_music",
        tableId: "tbl_music",
        updated: 0
      });
      expect(
        (await exportApp.inject({ method: "GET", url: "/api/feishu/status" })).json()
      ).toMatchObject({
        configured: true,
        libraryUrl: "https://feishu.cn/base/app_music?table=tbl_music"
      });
      expect(exportedRecords).toHaveLength(1);
      expect(exportedRecords[0]?.fields).toMatchObject({
        文件哈希: expect.any(String),
        音乐结构: expect.stringContaining("引子")
      });
      const settings = await database.db.select().from(appSettings);
      expect(
        settings.filter((setting) => ["feishuAppToken", "feishuTableId"].includes(setting.key))
      ).toHaveLength(2);

      const second = await exportApp.inject({ method: "POST", url: "/api/feishu/export" });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({
        created: 0,
        failed: 0,
        libraryUrl: "https://feishu.cn/base/app_music?table=tbl_music",
        skipped: 1,
        updated: 0
      });
      expect(exportedRecords).toHaveLength(1);

      const restartedApp = await buildApp({
        database,
        feishuConnection: { appToken: "app_music", tableId: "tbl_music" },
        feishuSyncService: createFeishuSyncService({
          appToken: "app_music",
          database,
          exporter,
          tableId: "tbl_music"
        }),
        storageRoot: join(temporaryRoot, "music")
      });
      try {
        const resumed = await restartedApp.inject({ method: "POST", url: "/api/feishu/export" });
        expect(resumed.statusCode).toBe(200);
        expect(resumed.json()).toMatchObject({
          created: 0,
          failed: 0,
          libraryUrl: "https://feishu.cn/base/app_music?table=tbl_music",
          skipped: 1,
          updated: 0
        });
      } finally {
        await restartedApp.close();
      }
    } finally {
      await exportApp.close();
    }
  });
});

function multipartPayload(boundary: string, audio: Buffer, filename: string) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`
    ),
    audio,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
}
