import { randomUUID } from "node:crypto";

import { importFiles, importJobs, type Database } from "@analyze-music/database";
import { and, eq } from "drizzle-orm";

import { type ImportResult } from "./import-service.js";

export interface ImportManifestFile {
  clientId: string;
  name: string;
  size: number;
}

export interface ImportSessionSnapshot {
  counts: {
    completed: number;
    duplicate: number;
    failed: number;
    imported: number;
    pending: number;
    total: number;
    uploading: number;
  };
  files: Array<{
    clientId: string;
    errorMessage: string | null;
    name: string;
    status: string;
  }>;
  id: string;
  status: string;
}

interface ImportSessionServiceOptions {
  database: Database;
  importFile: (input: {
    importFileId: string;
    importJobId: string;
    originalFilename: string;
    sourcePath: string;
  }) => Promise<ImportResult>;
}

const supportedExtensions = new Set(["mp3", "wav", "flac", "m4a", "aac", "ogg"]);

export function createImportSessionService({ database, importFile }: ImportSessionServiceOptions) {
  const listeners = new Map<string, Set<(snapshot: ImportSessionSnapshot) => void>>();

  return {
    create: async () => {
      const id = randomUUID();
      await database.db.insert(importJobs).values({
        id,
        sourcePath: "browser-session",
        status: "SCANNING"
      });
      return readSnapshot(database, id);
    },

    registerManifest: async (id: string, files: ImportManifestFile[]) => {
      await assertSession(database, id);
      const clientIds = new Set<string>();
      const existingFiles = await database.db
        .select({ sourcePath: importFiles.sourcePath })
        .from(importFiles)
        .where(eq(importFiles.importJobId, id));
      const registeredClientIds = new Set(
        existingFiles
          .map((file) => file.sourcePath.match(/^browser:(.+)$/)?.[1])
          .filter((clientId): clientId is string => clientId !== undefined)
      );
      let accepted = 0;
      let rejected = 0;
      for (const file of files) {
        if (clientIds.has(file.clientId)) {
          throw new Error(`Manifest contains duplicate client ID ${file.clientId}`);
        }
        if (registeredClientIds.has(file.clientId)) {
          throw new Error(`Import session ${id} already contains ${file.clientId}`);
        }
        clientIds.add(file.clientId);
        const supported = isSupportedFilename(file.name);
        await database.db.insert(importFiles).values({
          id: randomUUID(),
          importJobId: id,
          originalFilename: file.name,
          sourcePath: clientSourcePath(file.clientId),
          status: supported ? "PENDING" : "FAILED",
          errorMessage: supported ? null : "Unsupported audio format"
        });
        if (supported) accepted += 1;
        else rejected += 1;
      }
      const snapshot = await refresh(database, id);
      publish(listeners, snapshot);
      return { ...snapshot, accepted, rejected };
    },

    importUploadedFile: async ({
      clientId,
      originalFilename,
      sessionId,
      sourcePath
    }: {
      clientId: string;
      originalFilename: string;
      sessionId: string;
      sourcePath: string;
    }) => {
      const files = await database.db
        .select()
        .from(importFiles)
        .where(
          and(
            eq(importFiles.importJobId, sessionId),
            eq(importFiles.sourcePath, clientSourcePath(clientId))
          )
        )
        .limit(1);
      const file = files[0];
      if (!file) throw new Error(`Import session ${sessionId} does not contain ${clientId}`);
      if (file.status !== "PENDING") {
        throw new Error(`Import file ${clientId} cannot upload from ${file.status}`);
      }
      if (file.originalFilename !== originalFilename) {
        throw new Error(`Import file ${clientId} does not match its manifest filename`);
      }
      await database.db
        .update(importFiles)
        .set({ status: "UPLOADING", updatedAt: new Date() })
        .where(eq(importFiles.id, file.id));
      publish(listeners, await refresh(database, sessionId));

      try {
        const result = await importFile({
          importFileId: file.id,
          importJobId: sessionId,
          originalFilename,
          sourcePath
        });
        publish(listeners, await refresh(database, sessionId));
        return result;
      } catch (error) {
        await database.db
          .update(importFiles)
          .set({
            errorMessage: error instanceof Error ? error.message : String(error),
            status: "FAILED",
            updatedAt: new Date()
          })
          .where(eq(importFiles.id, file.id));
        publish(listeners, await refresh(database, sessionId));
        throw error;
      }
    },

    snapshot: (id: string) => readSnapshot(database, id),

    subscribe: (id: string, listener: (snapshot: ImportSessionSnapshot) => void) => {
      const sessionListeners = listeners.get(id) ?? new Set();
      sessionListeners.add(listener);
      listeners.set(id, sessionListeners);
      return () => {
        sessionListeners.delete(listener);
        if (sessionListeners.size === 0) listeners.delete(id);
      };
    }
  };
}

async function assertSession(database: Database, id: string) {
  const session = await database.db.select().from(importJobs).where(eq(importJobs.id, id)).limit(1);
  if (!session[0]) throw new Error(`Import session ${id} does not exist`);
}

async function refresh(database: Database, id: string) {
  const snapshot = await readSnapshot(database, id);
  const nextStatus = sessionStatus(snapshot);
  if (nextStatus !== snapshot.status) {
    await database.db
      .update(importJobs)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(importJobs.id, id));
    snapshot.status = nextStatus;
  }
  return snapshot;
}

async function readSnapshot(database: Database, id: string): Promise<ImportSessionSnapshot> {
  const sessions = await database.db
    .select()
    .from(importJobs)
    .where(eq(importJobs.id, id))
    .limit(1);
  const session = sessions[0];
  if (!session) throw new Error(`Import session ${id} does not exist`);
  const files = await database.db.select().from(importFiles).where(eq(importFiles.importJobId, id));
  const counts = {
    completed: files.filter((file) => ["IMPORTED", "DUPLICATE", "FAILED"].includes(file.status))
      .length,
    duplicate: files.filter((file) => file.status === "DUPLICATE").length,
    failed: files.filter((file) => file.status === "FAILED").length,
    imported: files.filter((file) => file.status === "IMPORTED").length,
    pending: files.filter((file) => file.status === "PENDING").length,
    total: files.length,
    uploading: files.filter((file) => file.status === "UPLOADING").length
  };
  return {
    counts,
    files: files.map((file) => ({
      clientId: file.sourcePath.replace(/^browser:/, ""),
      errorMessage: file.errorMessage,
      name: file.originalFilename,
      status: file.status
    })),
    id,
    status: session.status
  };
}

function sessionStatus(snapshot: ImportSessionSnapshot) {
  if (snapshot.counts.total === 0) return snapshot.status;
  if (snapshot.counts.pending > 0 || snapshot.counts.uploading > 0) return "IMPORTING";
  if (snapshot.counts.failed === snapshot.counts.total) return "FAILED";
  if (snapshot.counts.failed > 0) return "PARTIAL_FAILED";
  return "COMPLETED";
}

function publish(
  listeners: Map<string, Set<(snapshot: ImportSessionSnapshot) => void>>,
  snapshot: ImportSessionSnapshot
) {
  for (const listener of listeners.get(snapshot.id) ?? []) listener(snapshot);
}

function clientSourcePath(clientId: string) {
  return `browser:${clientId}`;
}

function isSupportedFilename(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension !== undefined && supportedExtensions.has(extension);
}
