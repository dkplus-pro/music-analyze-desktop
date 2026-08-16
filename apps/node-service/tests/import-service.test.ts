import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase, musicTracks } from "@analyze-music/database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createImportService } from "../src/services/import-service.js";

const samplePath = fileURLToPath(
  new URL("../../../tests/sample/10%20%E5%B8%8C%E6%9C%9B.mp3", import.meta.url)
);

describe("import service", () => {
  let temporaryRoot: string;
  let database: Awaited<ReturnType<typeof createDatabase>>;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "analyze-music-import-"));
    database = await createDatabase({ url: `file:${join(temporaryRoot, "music.db")}` });
  });

  afterEach(async () => {
    database.close();
    await rm(temporaryRoot, { force: true, recursive: true });
  });

  it("copies a new file into managed storage and rejects its second matching import", async () => {
    const service = createImportService({
      database,
      storageRoot: join(temporaryRoot, "music")
    });

    const first = await service.importFile({
      sourcePath: samplePath,
      originalFilename: "10 希望.mp3"
    });

    expect(first.kind).toBe("IMPORTED");
    if (first.kind !== "IMPORTED") {
      throw new Error("Expected the first import to create a track");
    }
    expect(first.trackId).toEqual(expect.any(String));
    const tracksAfterFirstImport = await database.db.select().from(musicTracks);
    expect(tracksAfterFirstImport).toHaveLength(1);
    await access(tracksAfterFirstImport[0]!.managedPath);

    const second = await service.importFile({
      sourcePath: samplePath,
      originalFilename: "10 希望.mp3"
    });

    expect(second).toEqual({ kind: "DUPLICATE", duplicateOf: first.trackId });
    expect(await database.db.select().from(musicTracks)).toHaveLength(1);
  });
});
