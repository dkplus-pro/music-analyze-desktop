import { randomUUID } from "node:crypto";

import { feishuSyncRecords, type Database } from "@analyze-music/database";
import { and, eq, inArray } from "drizzle-orm";

import type { MusicExporter } from "./feishu-exporter.js";
import { toFeishuRecord } from "./feishu-library-schema.js";

export interface FeishuExportTrack {
  analysisCreatedAt: Date | null;
  analysisStatus: string;
  analysisUpdatedAt: Date | null;
  analysisVersion: string | null;
  arousal: number | null;
  bpm: number | null;
  beatEditability: number | null;
  beatPositions: number[] | null;
  bitRate: number | null;
  channels: number | null;
  cinematicScore: number | null;
  cinematicStyles: string[];
  confidence: number | null;
  createdAt: Date;
  cuePoints: Record<string, number> | null;
  dialogueFriendly: number | null;
  durationMs: number | null;
  dynamicRange: number | null;
  endingQuality: number | null;
  id: string;
  energyCurve: number[] | null;
  epicness: number | null;
  featureExtractor: string | null;
  fileHash: string;
  fileSize: number;
  format: string;
  instrumentation: string[];
  intimacy: number | null;
  loopability: number | null;
  loudness: number | null;
  manualPrimaryEmotion: string | null;
  model: string | null;
  montageFriendly: number | null;
  musicalKey: string | null;
  musicalMode: string | null;
  narrativeFunctions: string[];
  primaryEmotion: string | null;
  promptVersion: string | null;
  rawAiResult: string | null;
  recommendedScenes: string[];
  notRecommendedScenes: string[];
  originalFilename: string;
  sampleRate: number | null;
  scale: number | null;
  secondaryEmotions: string[];
  segments: Array<{
    description: string;
    endMs: number;
    energy: number | null;
    startMs: number;
    tension: number | null;
    type: string;
  }>;
  summary: string | null;
  tension: number | null;
  textures: string[];
  title: string;
  trajectory: string | null;
  updatedAt: Date;
  valence: number | null;
}

interface FeishuSyncServiceOptions {
  appToken: string;
  database: Database;
  exporter: MusicExporter;
  tableId: string;
}

export function createFeishuSyncService({
  appToken,
  database,
  exporter,
  tableId
}: FeishuSyncServiceOptions) {
  return {
    deleteMusic: async (trackId: string) => {
      const records = await database.db
        .select()
        .from(feishuSyncRecords)
        .where(
          and(
            eq(feishuSyncRecords.baseToken, appToken),
            eq(feishuSyncRecords.musicId, trackId),
            eq(feishuSyncRecords.tableId, tableId)
          )
        )
        .limit(1);
      const record = records[0];
      if (!record) return;
      if (record.recordId) await exporter.deleteMusic(record.recordId);
      await database.db.delete(feishuSyncRecords).where(eq(feishuSyncRecords.id, record.id));
    },

    status: async () => {
      const records = await database.db
        .select()
        .from(feishuSyncRecords)
        .where(
          and(eq(feishuSyncRecords.baseToken, appToken), eq(feishuSyncRecords.tableId, tableId))
        );
      return {
        failed: records.filter((record) => record.syncStatus === "FAILED").length,
        lastSyncedAt: records.reduce<Date | null>((latest, record) => {
          if (!record.lastSyncedAt || (latest && record.lastSyncedAt <= latest)) return latest;
          return record.lastSyncedAt;
        }, null),
        synced: records.filter((record) => record.syncStatus === "SYNCED").length
      };
    },

    sync: async (tracks: FeishuExportTrack[]) => {
      if (tracks.length === 0) return { created: 0, failed: 0, skipped: 0, updated: 0 };
      const existing = await database.db
        .select()
        .from(feishuSyncRecords)
        .where(
          and(
            eq(feishuSyncRecords.baseToken, appToken),
            eq(feishuSyncRecords.tableId, tableId),
            inArray(
              feishuSyncRecords.musicId,
              tracks.map((track) => track.id)
            )
          )
        );
      const existingByTrack = new Map(existing.map((record) => [record.musicId, record]));
      const pending = tracks.filter((track) => {
        const record = existingByTrack.get(track.id);
        return !record?.lastSyncedAt || track.updatedAt > record.lastSyncedAt;
      });
      let created = 0;
      let failed = 0;
      let updated = 0;
      for (const track of pending) {
        const previous = existingByTrack.get(track.id);
        try {
          const [synced] = await exporter.syncMusic([
            toFeishuRecord(track, previous?.recordId ?? undefined)
          ]);
          if (!synced) throw new Error(`Feishu did not return a record for ${track.id}`);
          const now = new Date();
          await database.db
            .insert(feishuSyncRecords)
            .values({
              baseToken: appToken,
              errorMessage: null,
              id: previous?.id ?? randomUUID(),
              lastSyncedAt: now,
              localUpdatedAt: track.updatedAt,
              musicId: track.id,
              recordId: synced.recordId,
              syncStatus: "SYNCED",
              tableId,
              updatedAt: now
            })
            .onConflictDoUpdate({
              target: [feishuSyncRecords.musicId, feishuSyncRecords.tableId],
              set: {
                baseToken: appToken,
                errorMessage: null,
                lastSyncedAt: now,
                localUpdatedAt: track.updatedAt,
                recordId: synced.recordId,
                syncStatus: "SYNCED",
                updatedAt: now
              }
            });
          if (previous?.recordId) updated += 1;
          else created += 1;
        } catch (error) {
          failed += 1;
          const now = new Date();
          await database.db
            .insert(feishuSyncRecords)
            .values({
              baseToken: appToken,
              errorMessage: error instanceof Error ? error.message : String(error),
              id: previous?.id ?? randomUUID(),
              localUpdatedAt: track.updatedAt,
              musicId: track.id,
              syncStatus: "FAILED",
              tableId,
              updatedAt: now
            })
            .onConflictDoUpdate({
              target: [feishuSyncRecords.musicId, feishuSyncRecords.tableId],
              set: {
                baseToken: appToken,
                errorMessage: error instanceof Error ? error.message : String(error),
                localUpdatedAt: track.updatedAt,
                syncStatus: "FAILED",
                updatedAt: now
              }
            });
        }
      }
      return { created, failed, skipped: tracks.length - pending.length, updated };
    }
  };
}
