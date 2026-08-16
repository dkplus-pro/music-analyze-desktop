import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import { basename, extname, join, parse } from "node:path";

import { eq } from "drizzle-orm";

import { importFiles, importJobs, musicTracks, type Database } from "@analyze-music/database";

import { readAudioMetadata, type AudioMetadata } from "./audio-metadata.js";
import { hashFile } from "./file-hash.js";

export type ImportResult =
  { kind: "DUPLICATE"; duplicateOf: string } | { kind: "IMPORTED"; trackId: string };

interface ImportFileInput {
  importFileId?: string;
  importJobId?: string;
  originalFilename?: string;
  sourcePath: string;
}

interface ImportServiceOptions {
  database: Database;
  probeAudioMetadata?: (sourcePath: string) => Promise<AudioMetadata>;
  storageRoot: string;
}

export function createImportService({
  database,
  probeAudioMetadata = readAudioMetadata,
  storageRoot
}: ImportServiceOptions) {
  return {
    importFile: async ({
      importFileId,
      importJobId: existingImportJobId,
      sourcePath,
      originalFilename = basename(sourcePath)
    }: ImportFileInput): Promise<ImportResult> => {
      const importJobId = existingImportJobId ?? randomUUID();
      if (!existingImportJobId) {
        await database.db.insert(importJobs).values({
          id: importJobId,
          sourcePath,
          status: "PROCESSING"
        });
      }

      try {
        const fileHash = await hashFile(sourcePath);
        const existingTrack = await database.db
          .select({ id: musicTracks.id })
          .from(musicTracks)
          .where(eq(musicTracks.fileHash, fileHash))
          .limit(1);
        const duplicateOf = existingTrack[0]?.id;

        if (duplicateOf) {
          await recordImportFile({
            database,
            duplicateOf,
            importFileId,
            importJobId,
            originalFilename,
            sourcePath,
            status: "DUPLICATE"
          });
          if (!existingImportJobId) await completeImportJob(database, importJobId);
          return { kind: "DUPLICATE", duplicateOf };
        }

        const [fileInfo, metadata] = await Promise.all([
          stat(sourcePath),
          probeAudioMetadata(sourcePath)
        ]);
        const managedPath = await copyManagedFile({
          fileHash,
          originalFilename,
          sourcePath,
          storageRoot
        });
        const trackId = randomUUID();
        await database.db.insert(musicTracks).values({
          id: trackId,
          title: parse(originalFilename).name,
          originalFilename,
          sourcePath,
          managedPath,
          fileHash,
          fileSize: fileInfo.size,
          format: metadata.format,
          durationMs: metadata.durationMs,
          sampleRate: metadata.sampleRate,
          bitRate: metadata.bitRate,
          channels: metadata.channels
        });
        await recordImportFile({
          database,
          importFileId,
          importJobId,
          originalFilename,
          sourcePath,
          status: "IMPORTED",
          trackId
        });
        if (!existingImportJobId) await completeImportJob(database, importJobId);

        return { kind: "IMPORTED", trackId };
      } catch (error) {
        if (!existingImportJobId) {
          await database.db
            .update(importJobs)
            .set({
              errorMessage: error instanceof Error ? error.message : String(error),
              status: "FAILED",
              updatedAt: new Date()
            })
            .where(eq(importJobs.id, importJobId));
        }
        throw error;
      }
    }
  };
}

async function copyManagedFile({
  fileHash,
  originalFilename,
  sourcePath,
  storageRoot
}: {
  fileHash: string;
  originalFilename: string;
  sourcePath: string;
  storageRoot: string;
}) {
  await mkdir(storageRoot, { recursive: true });
  const extension = extname(originalFilename).toLowerCase();
  const managedPath = join(storageRoot, `${fileHash}${extension}`);
  const temporaryPath = join(storageRoot, `.${fileHash}.${randomUUID()}.tmp`);
  await copyFile(sourcePath, temporaryPath);
  await rename(temporaryPath, managedPath);
  return managedPath;
}

async function recordImportFile({
  database,
  importFileId,
  importJobId,
  sourcePath,
  originalFilename,
  status,
  trackId,
  duplicateOf
}: {
  database: Database;
  duplicateOf?: string;
  importFileId?: string;
  importJobId: string;
  originalFilename: string;
  sourcePath: string;
  status: "DUPLICATE" | "IMPORTED";
  trackId?: string;
}) {
  const values = {
    id: randomUUID(),
    importJobId,
    sourcePath,
    originalFilename,
    status,
    trackId,
    duplicateOf
  };
  if (importFileId) {
    await database.db
      .update(importFiles)
      .set({
        duplicateOf: values.duplicateOf,
        originalFilename: values.originalFilename,
        status: values.status,
        trackId: values.trackId,
        updatedAt: new Date()
      })
      .where(eq(importFiles.id, importFileId));
    return;
  }
  await database.db.insert(importFiles).values(values);
}

async function completeImportJob(database: Database, importJobId: string) {
  await database.db
    .update(importJobs)
    .set({ status: "COMPLETED", updatedAt: new Date() })
    .where(eq(importJobs.id, importJobId));
}
