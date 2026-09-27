import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";

import { patchMusicRequestSchema, importMusicRequestSchema } from "@analyze-music/contracts";
import {
  analysisJobs,
  appSettings,
  musicAnalysis,
  musicFeatures,
  musicSegments,
  musicTracks,
  type Database
} from "@analyze-music/database";
import multipart from "@fastify/multipart";
import { desc, eq, inArray, like, or } from "drizzle-orm";
import Fastify from "fastify";

import { createAnalysisQueue } from "./services/analysis-queue.js";
import type { MusicAnalyzer } from "./services/analysis-service.js";
import { createImportService, type ImportResult } from "./services/import-service.js";
import {
  createImportSessionService,
  type ImportManifestFile
} from "./services/import-session-service.js";
import type { DeterministicAnalyzer } from "./services/deterministic-analyzer.js";
import type { FeishuLibraryProvisioner } from "./services/feishu-exporter.js";
import { createFeishuSyncService, type FeishuExportTrack } from "./services/feishu-sync-service.js";
import {
  analysisFilePath,
  canReleaseManagedPath,
  isSourceAvailable
} from "./services/source-file.js";
import {
  createSettingsService,
  parseSettingsPatch,
  type SettingsView
} from "./services/settings-service.js";

interface BuildAppOptions {
  analyzer?: MusicAnalyzer;
  analysisPollIntervalMs?: number;
  database: Database;
  featureAnalyzer?: DeterministicAnalyzer;
  feishuConnection?: { appToken: string; tableId: string };
  feishuLibraryProvisioner?: FeishuLibraryProvisioner;
  feishuSyncService?: ReturnType<typeof createFeishuSyncService>;
  processAnalysisImmediately?: boolean;
  settingsService?: ReturnType<typeof createSettingsService>;
  storageRoot: string;
}

export async function buildApp({
  analyzer,
  analysisPollIntervalMs = 500,
  database,
  featureAnalyzer,
  feishuConnection,
  feishuLibraryProvisioner,
  feishuSyncService,
  processAnalysisImmediately = false,
  settingsService,
  storageRoot
}: BuildAppOptions) {
  const app = Fastify({ logger: false });
  const desktopFileActionToken = process.env["MUSIC_DESKTOP_FILE_ACTION_TOKEN"];
  await app.register(multipart, { limits: { files: 1, fileSize: 500 * 1024 * 1024 } });
  const importer = createImportService({ database, storageRoot });
  const activeSettingsService =
    settingsService ?? createSettingsService({ environment: process.env });
  let activeFeishuSyncService = feishuSyncService;
  let activeFeishuConnection = feishuConnection;
  const activateFeishuLibrary = async (
    library: Awaited<ReturnType<FeishuLibraryProvisioner["createLibrary"]>>
  ) => {
    activeFeishuConnection = { appToken: library.appToken, tableId: library.tableId };
    activeFeishuSyncService = createFeishuSyncService({
      appToken: library.appToken,
      database,
      exporter: library.exporter,
      tableId: library.tableId
    });
    const now = new Date();
    await Promise.all([
      database.db
        .insert(appSettings)
        .values({ key: "feishuAppToken", updatedAt: now, value: library.appToken })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { updatedAt: now, value: library.appToken }
        }),
      database.db
        .insert(appSettings)
        .values({ key: "feishuTableId", updatedAt: now, value: library.tableId })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { updatedAt: now, value: library.tableId }
        })
    ]);
  };
  const analysisQueue = analyzer
    ? createAnalysisQueue({ analyzer, database, featureAnalyzer })
    : undefined;
  let queuePolling = false;
  const processQueuedJobs = async () => {
    if (!analysisQueue || queuePolling) return;
    queuePolling = true;
    try {
      while (await analysisQueue.processNext()) {
        // Continue until the local queue is drained; the in-flight guard keeps this single-worker.
      }
    } finally {
      queuePolling = false;
    }
  };
  const scheduleImportedTrack = async (result: ImportResult) => {
    if (result.kind !== "IMPORTED") return result;
    if (!analysisQueue) {
      const track = await findTrack(database, result.trackId);
      if (track && canReleaseManagedPath(track)) await rm(track.managedPath, { force: true });
      return result;
    }
    await analysisQueue.enqueue(result.trackId);
    if (processAnalysisImmediately) {
      await processQueuedJobs();
    } else {
      void processQueuedJobs();
    }
    return result;
  };
  const importSessions = createImportSessionService({
    database,
    importFile: async (input) => scheduleImportedTrack(await importer.importFile(input))
  });
  const analysisPoller =
    analysisQueue && !processAnalysisImmediately
      ? setInterval(() => void processQueuedJobs(), analysisPollIntervalMs)
      : undefined;
  if (analysisPoller) {
    analysisPoller.unref();
    void processQueuedJobs();
    app.addHook("onClose", () => clearInterval(analysisPoller));
  }

  app.get("/api/health", async () => ({ status: "ok" }));

  app.get("/api/settings", async (): Promise<SettingsView> => activeSettingsService.read());

  app.patch("/api/settings", async (request, reply) => {
    const patch = parseSettingsPatch(request.body);
    if (!patch) {
      return reply.code(400).send({ error: "Invalid settings update" });
    }
    try {
      return await activeSettingsService.update(patch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Settings file path is not configured") {
        return reply.code(503).send({ error: "Local .env settings file is not configured" });
      }
      return reply.code(500).send({ error: "Unable to save local settings" });
    }
  });

  app.get("/api/feishu/status", async () => {
    if (!activeFeishuSyncService) {
      return {
        canCreate: Boolean(feishuLibraryProvisioner),
        configured: false,
        failed: 0,
        lastSyncedAt: null,
        libraryUrl: null,
        synced: 0
      };
    }
    return {
      canCreate: false,
      configured: true,
      ...(await activeFeishuSyncService.status()),
      libraryUrl: activeFeishuConnection ? feishuLibraryUrl(activeFeishuConnection) : null
    };
  });

  app.post("/api/feishu/library", async (request, reply) => {
    if (!feishuLibraryProvisioner) {
      return reply.code(503).send({ error: "Feishu app credentials are not configured" });
    }
    const name = (request.body as { name?: unknown } | undefined)?.name;
    if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
      return reply.code(400).send({ error: "name must be a non-empty string" });
    }
    try {
      const library = await feishuLibraryProvisioner.createLibrary(name?.trim());
      await activateFeishuLibrary(library);
      return reply.code(201).send({
        appToken: library.appToken,
        libraryUrl: feishuLibraryUrl(library),
        tableId: library.tableId
      });
    } catch (error) {
      return reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/feishu/sync", async (request, reply) => {
    if (!activeFeishuSyncService) {
      return reply.code(503).send({ error: "Feishu sync is not configured" });
    }
    const body = request.body as { trackIds?: unknown } | undefined;
    if (
      body?.trackIds !== undefined &&
      (!Array.isArray(body.trackIds) || body.trackIds.some((id) => typeof id !== "string"))
    ) {
      return reply.code(400).send({ error: "trackIds must be an array of track IDs" });
    }
    const requestedIds = body?.trackIds as string[] | undefined;
    const tracks = requestedIds
      ? await database.db.select().from(musicTracks).where(inArray(musicTracks.id, requestedIds))
      : await database.db.select().from(musicTracks);
    if (requestedIds && tracks.length !== new Set(requestedIds).size) {
      return reply.code(404).send({ error: "One or more music tracks were not found" });
    }
    return activeFeishuSyncService.sync(await enrichFeishuTracks(database, tracks));
  });

  app.post("/api/feishu/export", async (_request, reply) => {
    let createdLibrary = false;
    try {
      if (!activeFeishuSyncService) {
        if (!feishuLibraryProvisioner) {
          return reply.code(503).send({ error: "Feishu app credentials are not configured" });
        }
        const library = await feishuLibraryProvisioner.createLibrary();
        await activateFeishuLibrary(library);
        createdLibrary = true;
      }
      const syncService = activeFeishuSyncService;
      if (!activeFeishuConnection || !syncService) {
        return reply.code(503).send({ error: "Feishu library identifiers are not configured" });
      }
      const tracks = await database.db.select().from(musicTracks);
      const result = await syncService.sync(await enrichFeishuTracks(database, tracks));
      return reply.code(createdLibrary ? 201 : 200).send({
        ...activeFeishuConnection,
        ...result,
        libraryUrl: feishuLibraryUrl(activeFeishuConnection)
      });
    } catch (error) {
      return reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/export/json", async (_request, reply) => {
    const tracks = await database.db.select().from(musicTracks);
    const enriched = await enrichFeishuTracks(database, tracks);
    reply.header(
      "content-disposition",
      `attachment; filename="analyze-music-export-${new Date().toISOString().slice(0, 10)}.json"`
    );
    return {
      exportedAt: new Date().toISOString(),
      total: enriched.length,
      tracks: enriched
    };
  });

  app.post("/api/import", async (request, reply) => {
    if (request.isMultipart()) {
      const upload = await request.file();
      if (!upload || upload.fieldname !== "audio") {
        return reply.code(400).send({ error: "Expected one audio file in the audio field" });
      }

      const originalFilename = basename(upload.filename).trim() || "audio";
      const temporaryRoot = await mkdtemp(join(tmpdir(), "analyze-music-upload-"));
      const temporaryFile = join(temporaryRoot, originalFilename);
      try {
        await pipeline(upload.file, createWriteStream(temporaryFile, { flags: "wx" }));
        if (upload.file.truncated) {
          return reply.code(413).send({ error: "Audio file exceeds the 500 MiB upload limit" });
        }
        const result = await scheduleImportedTrack(
          await importer.importFile({ originalFilename, sourcePath: temporaryFile })
        );
        return reply.code(result.kind === "IMPORTED" ? 201 : 200).send(result);
      } finally {
        await rm(temporaryRoot, { force: true, recursive: true });
      }
    }

    const parsed = importMusicRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid import request", issues: parsed.error.issues });
    }

    const result = await scheduleImportedTrack(await importer.importFile(parsed.data));
    return reply.code(result.kind === "IMPORTED" ? 201 : 200).send(result);
  });

  app.post("/api/import-sessions", async (_request, reply) => {
    return reply.code(201).send(await importSessions.create());
  });

  app.post("/api/import-sessions/:id/manifest", async (request, reply) => {
    const files = (request.body as { files?: ImportManifestFile[] } | undefined)?.files;
    if (!Array.isArray(files) || files.some((file) => !isManifestFile(file))) {
      return reply.code(400).send({ error: "Expected a valid import manifest" });
    }
    try {
      return await importSessions.registerManifest((request.params as { id: string }).id, files);
    } catch (error) {
      return reply
        .code(409)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/import-sessions/:id/files/:clientId", async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: "Expected an audio multipart upload" });
    }
    const upload = await request.file();
    if (!upload || upload.fieldname !== "audio") {
      return reply.code(400).send({ error: "Expected one audio file in the audio field" });
    }

    const originalFilename = basename(upload.filename).trim() || "audio";
    const temporaryRoot = await mkdtemp(join(tmpdir(), "analyze-music-upload-"));
    const temporaryFile = join(temporaryRoot, originalFilename);
    try {
      await pipeline(upload.file, createWriteStream(temporaryFile, { flags: "wx" }));
      if (upload.file.truncated) {
        return reply.code(413).send({ error: "Audio file exceeds the 500 MiB upload limit" });
      }
      const result = await importSessions.importUploadedFile({
        clientId: (request.params as { clientId: string }).clientId,
        originalFilename,
        sessionId: (request.params as { id: string }).id,
        sourcePath: temporaryFile
      });
      return reply.code(result.kind === "IMPORTED" ? 201 : 200).send(result);
    } catch (error) {
      return reply
        .code(409)
        .send({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  const importSessionSnapshot = async (
    request: { params: unknown },
    reply: { code: (statusCode: number) => { send: (body: unknown) => unknown } }
  ) => {
    try {
      return await importSessions.snapshot((request.params as { id: string }).id);
    } catch (error) {
      return reply
        .code(404)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  };
  app.get("/api/import-jobs/:id", importSessionSnapshot);
  app.get("/api/import-sessions/:id", importSessionSnapshot);

  app.get("/api/import-jobs/:id/events", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    let initial;
    try {
      initial = await importSessions.snapshot(id);
    } catch (error) {
      return reply
        .code(404)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
    reply.hijack();
    reply.raw.writeHead(200, {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream"
    });
    const send = (snapshot: typeof initial) => {
      reply.raw.write(`event: progress\ndata: ${JSON.stringify(snapshot)}\n\n`);
    };
    send(initial);
    const unsubscribe = importSessions.subscribe(id, send);
    request.raw.once("close", unsubscribe);
  });

  app.get("/api/music", async (request) => {
    const query = request.query as {
      cinematicStyle?: string;
      limit?: string;
      minCinematicScore?: string;
      minDialogueFriendly?: string;
      narrative?: string;
      offset?: string;
      primaryEmotion?: string;
      search?: string;
      status?: string;
      trajectory?: string;
    };
    const limit = withinRange(query.limit, 50, 1, 100);
    const offset = withinRange(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const minimumCinematicScore = minimumNumber(query.minCinematicScore);
    const minimumDialogueFriendly = minimumNumber(query.minDialogueFriendly);
    const search = query.search?.trim();
    const where = search
      ? or(
          like(musicTracks.title, `%${search}%`),
          like(musicTracks.originalFilename, `%${search}%`)
        )
      : undefined;
    const tracks = where
      ? await database.db.select().from(musicTracks).where(where)
      : await database.db.select().from(musicTracks);
    const items = (await enrichTracks(database, tracks)).filter((track) => {
      if (query.primaryEmotion && track.primaryEmotion !== query.primaryEmotion) return false;
      if (query.status && track.analysisStatus !== query.status) return false;
      if (query.narrative && !track.narrativeFunctions.includes(query.narrative)) return false;
      if (query.cinematicStyle && !track.cinematicStyles.includes(query.cinematicStyle))
        return false;
      if (
        minimumCinematicScore !== undefined &&
        (track.cinematicScore ?? 0) < minimumCinematicScore
      )
        return false;
      if (
        minimumDialogueFriendly !== undefined &&
        (track.dialogueFriendly ?? 0) < minimumDialogueFriendly
      )
        return false;
      if (query.trajectory && track.trajectory !== query.trajectory) return false;
      return true;
    });

    return {
      items: items.slice(offset, offset + limit),
      total: items.length
    };
  });

  app.get("/api/music/:id", async (request, reply) => {
    const track = await findTrack(database, (request.params as { id: string }).id);
    if (!track) {
      return reply.code(404).send({ error: "Music track not found" });
    }
    return (await enrichTracks(database, [track], true))[0]!;
  });

  app.get("/api/desktop/music/:id/source-path", async (request, reply) => {
    if (
      !desktopFileActionToken ||
      request.headers["x-music-desktop-file-action-token"] !== desktopFileActionToken
    ) {
      return reply.code(404).send({ error: "Music track not found" });
    }
    const track = await findTrack(database, (request.params as { id: string }).id);
    if (!track) {
      return reply.code(404).send({ error: "Music track not found" });
    }
    return { sourcePath: analysisFilePath(track) };
  });

  app.patch("/api/music/:id", async (request, reply) => {
    const parsed = patchMusicRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid music update", issues: parsed.error.issues });
    }
    const id = (request.params as { id: string }).id;
    const track = await findTrack(database, id);
    if (!track) {
      return reply.code(404).send({ error: "Music track not found" });
    }

    await database.db
      .update(musicTracks)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(musicTracks.id, id));
    const updated = await findTrack(database, id);
    return (await enrichTracks(database, [updated!], true))[0]!;
  });

  app.delete("/api/music/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const track = await findTrack(database, id);
    if (!track) {
      return reply.code(404).send({ error: "Music track not found" });
    }
    const latestJob = await findLatestAnalysisJob(database, id);
    if (latestJob && isActiveAnalysisStatus(latestJob.status)) {
      return reply.code(409).send({ error: "Music analysis is in progress and cannot be deleted" });
    }

    try {
      await activeFeishuSyncService?.deleteMusic(track.id);
    } catch (error) {
      return reply
        .code(502)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
    if (canReleaseManagedPath(track)) await rm(track.managedPath, { force: true });
    await database.db.delete(musicTracks).where(eq(musicTracks.id, id));
    return reply.code(204).send();
  });

  app.post("/api/music/:id/analyze", async (request, reply) => {
    if (!analysisQueue) {
      return reply.code(503).send({ error: "Music analysis is not configured" });
    }
    const trackId = (request.params as { id: string }).id;
    const track = await findTrack(database, trackId);
    if (!track) {
      return reply.code(404).send({ error: "Music track not found" });
    }
    const latestJob = await findLatestAnalysisJob(database, trackId);
    if (latestJob?.status === "COMPLETED") {
      return reply.code(409).send({ error: "Music has already been analyzed successfully" });
    }
    if (latestJob && isActiveAnalysisStatus(latestJob.status)) {
      return reply.code(409).send({ error: "Music analysis is already in progress" });
    }
    if (!(await isSourceAvailable(analysisFilePath(track)))) {
      return reply
        .code(409)
        .send({ error: "Music source has been released; re-import it to analyze" });
    }
    const job = await analysisQueue.enqueue(trackId);
    const outcome = processAnalysisImmediately ? await analysisQueue.processNext() : job;
    return reply.code(202).send(outcome ?? job);
  });

  app.post("/api/music/batch-analyze", async (request, reply) => {
    if (!analysisQueue) {
      return reply.code(503).send({ error: "Music analysis is not configured" });
    }
    const body = request.body as { trackIds?: unknown } | undefined;
    if (
      body?.trackIds !== undefined &&
      (!Array.isArray(body.trackIds) || body.trackIds.some((id) => typeof id !== "string"))
    ) {
      return reply.code(400).send({ error: "trackIds must be an array of track IDs" });
    }
    const requestedIds = body?.trackIds as string[] | undefined;
    const tracks = requestedIds
      ? await database.db.select().from(musicTracks).where(inArray(musicTracks.id, requestedIds))
      : await database.db.select().from(musicTracks);
    if (requestedIds && tracks.length !== new Set(requestedIds).size) {
      return reply.code(404).send({ error: "One or more music tracks were not found" });
    }
    const latestJobs = await findLatestAnalysisJobs(
      database,
      tracks.map((track) => track.id)
    );
    const tracksToAnalyze = [] as typeof tracks;
    for (const track of tracks) {
      const latestJob = latestJobs.get(track.id);
      if (
        latestJob?.status !== "COMPLETED" &&
        !isActiveAnalysisStatus(latestJob?.status) &&
        (await isSourceAvailable(analysisFilePath(track)))
      ) {
        tracksToAnalyze.push(track);
      }
    }
    const jobs = await Promise.all(tracksToAnalyze.map((track) => analysisQueue.enqueue(track.id)));
    if (processAnalysisImmediately) {
      for (let processed = 0; processed < jobs.length; processed += 1) {
        await analysisQueue.processNext();
      }
    } else {
      void processQueuedJobs();
    }
    return reply
      .code(202)
      .send({ jobs, queued: jobs.length, skipped: tracks.length - jobs.length });
  });

  app.get("/api/analysis-jobs", async () => database.db.select().from(analysisJobs));

  app.post("/api/analysis-jobs/:id/retry", async (request, reply) => {
    if (!analysisQueue) {
      return reply.code(503).send({ error: "Music analysis is not configured" });
    }
    const jobId = (request.params as { id: string }).id;
    try {
      const job = await analysisQueue.retry(jobId);
      const outcome = processAnalysisImmediately ? await analysisQueue.processNext() : job;
      return reply.code(202).send(outcome ?? job);
    } catch (error) {
      return reply
        .code(409)
        .send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/music/:id/audio", async (request, reply) => {
    const track = await findTrack(database, (request.params as { id: string }).id);
    if (!track) {
      return reply.code(404).send({ error: "Music track not found" });
    }
    return reply.code(410).send({ error: "Audio files are not retained after analysis" });
  });

  app.get("/api/music/:id/waveform", async (request, reply) => {
    const track = await findTrack(database, (request.params as { id: string }).id);
    if (!track) {
      return reply.code(404).send({ error: "Music track not found" });
    }
    return reply.code(410).send({ error: "Audio files are not retained after analysis" });
  });

  return app;
}

async function findTrack(database: Database, id: string) {
  const tracks = await database.db
    .select()
    .from(musicTracks)
    .where(eq(musicTracks.id, id))
    .limit(1);
  return tracks[0];
}

async function enrichTracks(
  database: Database,
  tracks: Array<typeof musicTracks.$inferSelect>,
  includeDetails = false
) {
  if (tracks.length === 0) return [];

  const trackIds = tracks.map((track) => track.id);
  const [analyses, jobs, features, segments] = await Promise.all([
    database.db
      .select()
      .from(musicAnalysis)
      .where(inArray(musicAnalysis.musicId, trackIds))
      .orderBy(desc(musicAnalysis.createdAt)),
    database.db
      .select()
      .from(analysisJobs)
      .where(inArray(analysisJobs.trackId, trackIds))
      .orderBy(desc(analysisJobs.createdAt)),
    database.db
      .select()
      .from(musicFeatures)
      .where(inArray(musicFeatures.musicId, trackIds))
      .orderBy(desc(musicFeatures.createdAt)),
    database.db
      .select()
      .from(musicSegments)
      .where(inArray(musicSegments.musicId, trackIds))
      .orderBy(musicSegments.startMs)
  ]);
  const latestAnalysisByTrack = latestBy(analyses, (analysis) => analysis.musicId);
  const latestJobByTrack = latestBy(jobs, (job) => job.trackId);
  const latestFeaturesByTrack = latestBy(features, (feature) => feature.musicId);
  const segmentsByTrack = new Map<string, typeof segments>();
  for (const segment of segments) {
    const trackSegments = segmentsByTrack.get(segment.musicId) ?? [];
    trackSegments.push(segment);
    segmentsByTrack.set(segment.musicId, trackSegments);
  }

  return tracks.map((track) => {
    const analysis = latestAnalysisByTrack.get(track.id);
    const job = latestJobByTrack.get(track.id);
    return {
      ...track,
      analysisError: job?.status === "FAILED" ? job.errorMessage : null,
      analysisJobId: job?.id ?? null,
      analysisStatus: job?.status ?? "NONE",
      analysisCreatedAt: includeDetails ? (analysis?.createdAt ?? null) : undefined,
      analysisUpdatedAt: includeDetails ? (analysis?.updatedAt ?? null) : undefined,
      analysisVersion: includeDetails ? (analysis?.analysisVersion ?? null) : undefined,
      arousal: includeDetails ? (analysis?.arousal ?? null) : undefined,
      beatEditability: includeDetails ? (analysis?.beatEditability ?? null) : undefined,
      cinematicScore: analysis?.cinematicScore ?? null,
      cinematicStyles: analysis?.cinematicStyles ?? [],
      bpm: track.bpm ?? latestFeaturesByTrack.get(track.id)?.bpm ?? null,
      confidence: includeDetails ? (analysis?.confidence ?? null) : undefined,
      cuePoints: includeDetails ? (analysis?.cuePoints ?? null) : undefined,
      dialogueFriendly: analysis?.dialogueFriendly ?? null,
      endingQuality: includeDetails ? (analysis?.endingQuality ?? null) : undefined,
      epicness: includeDetails ? (analysis?.epicness ?? null) : undefined,
      features: includeDetails ? (latestFeaturesByTrack.get(track.id) ?? null) : undefined,
      instrumentation: analysis?.instrumentation ?? [],
      intimacy: includeDetails ? (analysis?.intimacy ?? null) : undefined,
      loopability: includeDetails ? (analysis?.loopability ?? null) : undefined,
      montageFriendly: analysis?.montageFriendly ?? null,
      model: includeDetails ? (analysis?.model ?? null) : undefined,
      narrativeFunctions: analysis?.narrativeFunctions ?? [],
      musicalKey: track.musicalKey ?? latestFeaturesByTrack.get(track.id)?.musicalKey ?? null,
      musicalMode: track.musicalMode ?? latestFeaturesByTrack.get(track.id)?.musicalMode ?? null,
      notRecommendedScenes: includeDetails ? (analysis?.notRecommendedScenes ?? []) : undefined,
      primaryEmotion: track.manualPrimaryEmotion ?? analysis?.primaryEmotion ?? null,
      promptVersion: includeDetails ? (analysis?.promptVersion ?? null) : undefined,
      rawAiResult: includeDetails ? (analysis?.rawAiResult ?? null) : undefined,
      recommendedScenes: analysis?.recommendedScenes ?? [],
      scale: includeDetails ? (analysis?.scale ?? null) : undefined,
      secondaryEmotions: analysis?.secondaryEmotions ?? [],
      segments: includeDetails ? (segmentsByTrack.get(track.id) ?? []) : undefined,
      summary: analysis?.summary ?? null,
      tension: includeDetails ? (analysis?.tension ?? null) : undefined,
      textures: analysis?.textures ?? [],
      trajectory: analysis?.trajectory ?? null,
      valence: includeDetails ? (analysis?.valence ?? null) : undefined
    };
  });
}

async function enrichFeishuTracks(
  database: Database,
  tracks: Array<typeof musicTracks.$inferSelect>
): Promise<FeishuExportTrack[]> {
  const enriched = await enrichTracks(database, tracks, true);
  return enriched.map((track) => ({
    analysisCreatedAt: track.analysisCreatedAt ?? null,
    analysisStatus: track.analysisStatus,
    analysisUpdatedAt: track.analysisUpdatedAt ?? null,
    analysisVersion: track.analysisVersion ?? null,
    arousal: track.arousal ?? null,
    beatEditability: track.beatEditability ?? null,
    beatPositions: track.features?.beatPositions ?? null,
    bitRate: track.bitRate,
    bpm: track.bpm,
    channels: track.channels,
    cinematicScore: track.cinematicScore,
    cinematicStyles: track.cinematicStyles,
    confidence: track.confidence ?? null,
    createdAt: track.createdAt,
    cuePoints: track.cuePoints ?? null,
    dialogueFriendly: track.dialogueFriendly,
    durationMs: track.durationMs,
    dynamicRange: track.features?.dynamicRange ?? null,
    endingQuality: track.endingQuality ?? null,
    energyCurve: track.features?.energyCurve ?? null,
    epicness: track.epicness ?? null,
    featureExtractor: track.features?.extractor ?? null,
    fileHash: track.fileHash,
    fileSize: track.fileSize,
    format: track.format,
    id: track.id,
    instrumentation: track.instrumentation,
    intimacy: track.intimacy ?? null,
    loopability: track.loopability ?? null,
    loudness: track.features?.loudness ?? null,
    manualPrimaryEmotion: track.manualPrimaryEmotion,
    model: track.model ?? null,
    montageFriendly: track.montageFriendly,
    musicalKey: track.musicalKey,
    musicalMode: track.musicalMode,
    narrativeFunctions: track.narrativeFunctions,
    notRecommendedScenes: track.notRecommendedScenes ?? [],
    originalFilename: track.originalFilename,
    primaryEmotion: track.primaryEmotion,
    promptVersion: track.promptVersion ?? null,
    rawAiResult: track.rawAiResult ?? null,
    recommendedScenes: track.recommendedScenes,
    sampleRate: track.sampleRate,
    scale: track.scale ?? null,
    secondaryEmotions: track.secondaryEmotions,
    segments: track.segments ?? [],
    sourcePath: analysisFilePath(track),
    summary: track.summary ?? null,
    tension: track.tension ?? null,
    textures: track.textures,
    title: track.title,
    trajectory: track.trajectory,
    updatedAt: track.updatedAt,
    valence: track.valence ?? null
  }));
}

function latestBy<T extends { createdAt: Date }>(items: T[], key: (item: T) => string) {
  const latest = new Map<string, T>();
  for (const item of items) {
    const existing = latest.get(key(item));
    if (!existing || item.createdAt > existing.createdAt) {
      latest.set(key(item), item);
    }
  }
  return latest;
}

async function findLatestAnalysisJob(database: Database, trackId: string) {
  const jobs = await database.db
    .select()
    .from(analysisJobs)
    .where(eq(analysisJobs.trackId, trackId))
    .orderBy(desc(analysisJobs.createdAt))
    .limit(1);
  return jobs[0];
}

async function findLatestAnalysisJobs(database: Database, trackIds: string[]) {
  if (trackIds.length === 0) return new Map<string, typeof analysisJobs.$inferSelect>();
  const jobs = await database.db
    .select()
    .from(analysisJobs)
    .where(inArray(analysisJobs.trackId, trackIds))
    .orderBy(desc(analysisJobs.createdAt));
  return latestBy(jobs, (job) => job.trackId);
}

function isActiveAnalysisStatus(status: string | undefined) {
  return (
    status === "QUEUED" ||
    status === "EXTRACTING" ||
    status === "AI_ANALYZING" ||
    status === "VALIDATING"
  );
}

function feishuLibraryUrl(connection: { appToken: string; tableId: string }) {
  return `https://feishu.cn/base/${encodeURIComponent(connection.appToken)}?table=${encodeURIComponent(connection.tableId)}`;
}

function withinRange(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(Math.max(number, minimum), maximum);
}

function minimumNumber(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isManifestFile(value: unknown): value is ImportManifestFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file["clientId"] === "string" &&
    file["clientId"].length > 0 &&
    typeof file["name"] === "string" &&
    file["name"].length > 0 &&
    typeof file["size"] === "number" &&
    Number.isFinite(file["size"]) &&
    file["size"] >= 0
  );
}
