import { randomUUID } from "node:crypto";
import { access, rm } from "node:fs/promises";

import { analysisResultSchema } from "@analyze-music/music-domain";
import {
  analysisJobs,
  musicAnalysis,
  musicFeatures,
  musicSegments,
  musicTracks,
  type Database
} from "@analyze-music/database";
import { eq, sql } from "drizzle-orm";

import type { MusicAnalyzer } from "./analysis-service.js";
import type { DeterministicAnalyzer, DeterministicFeatures } from "./deterministic-analyzer.js";

interface AnalysisQueueOptions {
  analyzer: MusicAnalyzer;
  database: Database;
  featureAnalyzer?: DeterministicAnalyzer;
}

export function createAnalysisQueue({ analyzer, database, featureAnalyzer }: AnalysisQueueOptions) {
  return {
    enqueue: async (trackId: string) => {
      const id = randomUUID();
      await database.db.insert(analysisJobs).values({ id, status: "QUEUED", trackId });
      return { id, status: "QUEUED" as const, trackId };
    },

    processNext: async () => {
      const jobs = await database.db
        .select()
        .from(analysisJobs)
        .where(eq(analysisJobs.status, "QUEUED"))
        .limit(1);
      const job = jobs[0];
      if (!job) {
        return null;
      }

      await database.db
        .update(analysisJobs)
        .set({
          attempts: sql`${analysisJobs.attempts} + 1`,
          status: "EXTRACTING",
          updatedAt: new Date()
        })
        .where(eq(analysisJobs.id, job.id));

      let completed = false;
      let managedPath: string | undefined;
      try {
        const tracks = await database.db
          .select()
          .from(musicTracks)
          .where(eq(musicTracks.id, job.trackId))
          .limit(1);
        const track = tracks[0];
        if (!track) {
          throw new Error(`Music track ${job.trackId} does not exist`);
        }
        managedPath = track.managedPath;

        const features = await extractFeatures(featureAnalyzer, track.managedPath);
        if (features) {
          await persistFeatures(database, track.id, features);
        }

        await updateStatus(database, job.id, "AI_ANALYZING");
        const result = analysisResultSchema.parse(
          await analyzer.analyze({
            filePath: track.managedPath,
            features,
            metadata: {
              bitRate: track.bitRate,
              bpm: features?.bpm ?? track.bpm,
              channels: track.channels,
              durationMs: track.durationMs,
              format: track.format,
              key: features?.key ?? track.musicalKey,
              mode: features?.mode ?? track.musicalMode,
              sampleRate: track.sampleRate
            }
          })
        );
        await updateStatus(database, job.id, "VALIDATING");
        await database.db.insert(musicAnalysis).values({
          id: randomUUID(),
          musicId: track.id,
          primaryEmotion: result.primaryEmotion,
          secondaryEmotions: result.secondaryEmotions,
          narrativeFunctions: result.narrativeFunctions,
          cinematicStyles: result.cinematicStyles,
          cinematicScore: result.cinematicScore,
          analysisVersion: "v1",
          arousal: result.arousal ?? null,
          beatEditability: result.beatEditability ?? null,
          confidence: result.confidence ?? null,
          cuePoints: result.cuePoints ?? null,
          dialogueFriendly: result.dialogueFriendly ?? null,
          endingQuality: result.endingQuality ?? null,
          epicness: result.epicness ?? null,
          instrumentation: result.instrumentation ?? [],
          intimacy: result.intimacy ?? null,
          loopability: result.loopability ?? null,
          model: "qwen3.5-omni-plus",
          montageFriendly: result.montageFriendly ?? null,
          notRecommendedScenes: result.notRecommendedScenes ?? [],
          promptVersion: "v1",
          recommendedScenes: result.recommendedScenes ?? [],
          scale: result.scale ?? null,
          summary: result.summary,
          tension: result.tension ?? null,
          textures: result.textures ?? [],
          trajectory: result.trajectory ?? null,
          valence: result.valence ?? null,
          rawAiResult: JSON.stringify(result)
        });
        await database.db.delete(musicSegments).where(eq(musicSegments.musicId, track.id));
        if (result.segments?.length) {
          await database.db.insert(musicSegments).values(
            result.segments.map((segment) => ({
              description: segment.description,
              endMs: segment.endMs,
              energy: segment.energy ?? null,
              id: randomUUID(),
              musicId: track.id,
              startMs: segment.startMs,
              tension: segment.tension ?? null,
              type: segment.type
            }))
          );
        }
        await updateStatus(database, job.id, "COMPLETED");
        completed = true;
        return { id: job.id, status: "COMPLETED" as const };
      } catch (error) {
        await database.db
          .update(analysisJobs)
          .set({
            errorMessage: error instanceof Error ? error.message : String(error),
            status: "FAILED",
            updatedAt: new Date()
          })
          .where(eq(analysisJobs.id, job.id));
        return { id: job.id, status: "FAILED" as const };
      } finally {
        if (completed && managedPath) {
          await rm(managedPath, { force: true }).catch(() => undefined);
        }
      }
    },

    retry: async (jobId: string) => {
      const jobs = await database.db
        .select()
        .from(analysisJobs)
        .where(eq(analysisJobs.id, jobId))
        .limit(1);
      const job = jobs[0];
      if (!job) {
        throw new Error(`Analysis job ${jobId} does not exist`);
      }
      if (job.status !== "FAILED") {
        throw new Error(`Analysis job ${jobId} cannot be retried from ${job.status}`);
      }
      const tracks = await database.db
        .select({ managedPath: musicTracks.managedPath })
        .from(musicTracks)
        .where(eq(musicTracks.id, job.trackId))
        .limit(1);
      const track = tracks[0];
      if (!track) {
        throw new Error(`Music track ${job.trackId} does not exist`);
      }
      try {
        await access(track.managedPath);
      } catch {
        throw new Error("Music source has been released; re-import it to retry analysis");
      }
      await database.db
        .update(analysisJobs)
        .set({ errorMessage: null, status: "QUEUED", updatedAt: new Date() })
        .where(eq(analysisJobs.id, jobId));
      return { id: jobId, status: "QUEUED" as const };
    }
  };
}

async function persistFeatures(
  database: Database,
  trackId: string,
  features: DeterministicFeatures
) {
  const now = new Date();
  await database.db
    .update(musicTracks)
    .set({
      bpm: features.bpm,
      musicalKey: features.key,
      musicalMode: features.mode,
      updatedAt: now
    })
    .where(eq(musicTracks.id, trackId));
  await database.db
    .insert(musicFeatures)
    .values({
      beatPositions: features.beatPositions,
      bpm: features.bpm,
      dynamicRange: features.dynamicRange,
      energyCurve: features.energyCurve,
      extractor: features.extractor,
      id: randomUUID(),
      loudness: features.loudness,
      musicalKey: features.key,
      musicalMode: features.mode,
      musicId: trackId
    })
    .onConflictDoUpdate({
      target: musicFeatures.musicId,
      set: {
        beatPositions: features.beatPositions,
        bpm: features.bpm,
        dynamicRange: features.dynamicRange,
        energyCurve: features.energyCurve,
        extractor: features.extractor,
        loudness: features.loudness,
        musicalKey: features.key,
        musicalMode: features.mode,
        updatedAt: now
      }
    });
}

async function updateStatus(database: Database, jobId: string, status: string) {
  await database.db
    .update(analysisJobs)
    .set({ status, updatedAt: new Date() })
    .where(eq(analysisJobs.id, jobId));
}

async function extractFeatures(
  featureAnalyzer: DeterministicAnalyzer | undefined,
  filePath: string
) {
  if (!featureAnalyzer) return undefined;
  try {
    return await featureAnalyzer.analyze(filePath);
  } catch (error) {
    console.warn(
      `Local music feature extraction failed; continuing with AI analysis: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return undefined;
  }
}
