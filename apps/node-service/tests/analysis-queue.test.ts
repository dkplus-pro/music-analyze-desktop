import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { analysisJobs, createDatabase, musicAnalysis, musicTracks } from "@analyze-music/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAnalysisQueue } from "../src/services/analysis-queue.js";

describe("analysis queue", () => {
  let database: Awaited<ReturnType<typeof createDatabase>>;
  let temporaryRoot: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "analyze-music-analysis-"));
    database = await createDatabase({ url: `file:${join(temporaryRoot, "music.db")}` });
    const sourcePath = join(temporaryRoot, "source.mp3");
    const managedPath = join(temporaryRoot, "managed-sample.mp3");
    await writeFile(sourcePath, "audio");
    await writeFile(managedPath, "audio");
    await database.db.insert(musicTracks).values({
      id: randomUUID(),
      fileHash: randomUUID(),
      fileSize: 1,
      format: "mp3",
      managedPath,
      originalFilename: "sample.mp3",
      sourcePath,
      title: "sample"
    });
  });

  afterEach(async () => {
    database.close();
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  it("retains a failed analysis source for retry then releases it after success", async () => {
    const [track] = await database.db.select().from(musicTracks);
    let attempts = 0;
    const queue = createAnalysisQueue({
      analyzer: {
        analyze: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("temporary analyzer failure");
          }
          return {
            cinematicScore: 8,
            cinematicStyles: ["Drama"],
            dialogueFriendly: 9,
            instrumentation: ["Piano", "Strings"],
            narrativeFunctions: ["Memory"],
            primaryEmotion: "Nostalgic",
            recommendedScenes: ["人物回忆"],
            secondaryEmotions: [],
            segments: [
              { description: "Piano opening", endMs: 14_000, startMs: 0, type: "Intro" },
              { description: "Emotional arrival", endMs: 80_000, startMs: 14_000, type: "Climax" }
            ],
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
      }
    });

    const job = await queue.enqueue(track!.id);
    await queue.processNext();

    expect(await database.db.select().from(analysisJobs)).toMatchObject([
      { errorMessage: "temporary analyzer failure", id: job.id, status: "FAILED" }
    ]);

    await expect(access(track!.managedPath)).resolves.toBeUndefined();
    await expect(queue.retry(job.id)).resolves.toMatchObject({ id: job.id, status: "QUEUED" });
    await queue.processNext();

    expect(await database.db.select().from(analysisJobs)).toMatchObject([
      { errorMessage: null, id: job.id, status: "COMPLETED" }
    ]);
    await expect(access(track!.managedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("still completes AI analysis when local feature extraction is unavailable", async () => {
    const [track] = await database.db.select().from(musicTracks);
    const queue = createAnalysisQueue({
      analyzer: {
        analyze: async () => ({
          cinematicScore: 8,
          cinematicStyles: ["Drama"],
          narrativeFunctions: ["Memory"],
          primaryEmotion: "Nostalgic",
          secondaryEmotions: [],
          summary: "Warm piano"
        })
      },
      database,
      featureAnalyzer: {
        analyze: async () => {
          throw new Error("No module named 'librosa'");
        }
      }
    });

    const job = await queue.enqueue(track!.id);
    await queue.processNext();

    expect(await database.db.select().from(analysisJobs)).toMatchObject([
      { errorMessage: null, id: job.id, status: "COMPLETED" }
    ]);
    expect(await database.db.select().from(musicAnalysis)).toMatchObject([
      { musicId: track!.id, primaryEmotion: "Nostalgic" }
    ]);
    await expect(access(track!.managedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
