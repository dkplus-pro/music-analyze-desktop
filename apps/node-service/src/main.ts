import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { appSettings, createDatabase } from "@analyze-music/database";

import { buildApp } from "./app.js";
import { createBailianAnalyzer } from "./services/bailian-analyzer.js";
import { createBailianCliAnalyzer } from "./services/bailian-cli-analyzer.js";
import { createDeterministicAnalyzer } from "./services/deterministic-analyzer.js";
import {
  createFeishuLibraryProvisioner,
  createFeishuOpenApiExporter
} from "./services/feishu-exporter.js";
import { createFeishuSyncService } from "./services/feishu-sync-service.js";
import { configuredValue } from "./services/runtime-config.js";
import { createSettingsService } from "./services/settings-service.js";

const databaseUrl = process.env["DATABASE_URL"] ?? "file:data/analyze-music.db";
const settingsEnvPath = process.env["MUSIC_ENV_PATH"] ?? join(process.cwd(), "../../.env");
if (databaseUrl.startsWith("file:")) {
  await mkdir(dirname(databaseUrl.slice("file:".length)), { recursive: true });
}

const database = await createDatabase({ url: databaseUrl });
const persistedSettings = new Map(
  (await database.db.select().from(appSettings)).map((setting) => [setting.key, setting.value])
);
const feishuAppId = process.env["FEISHU_APP_ID"];
const feishuAppSecret = process.env["FEISHU_APP_SECRET"];
const feishuAppToken = configuredValue(
  process.env["FEISHU_APP_TOKEN"],
  persistedSettings.get("feishuAppToken")
);
const feishuTableId = configuredValue(
  process.env["FEISHU_TABLE_ID"],
  persistedSettings.get("feishuTableId")
);
const feishuSyncService =
  feishuAppId && feishuAppSecret && feishuAppToken && feishuTableId
    ? createFeishuSyncService({
        appToken: feishuAppToken,
        database,
        exporter: createFeishuOpenApiExporter({
          appId: feishuAppId,
          appSecret: feishuAppSecret,
          appToken: feishuAppToken,
          tableId: feishuTableId
        }),
        tableId: feishuTableId
      })
    : undefined;
const app = await buildApp({
  analyzer: process.env["BAILIAN_API_KEY"]
    ? createBailianAnalyzer({
        apiKey: process.env["BAILIAN_API_KEY"],
        baseUrl: process.env["BAILIAN_BASE_URL"],
        model: process.env["BAILIAN_MODEL"]
      })
    : createBailianCliAnalyzer(),
  database,
  feishuConnection:
    feishuAppToken && feishuTableId
      ? { appToken: feishuAppToken, tableId: feishuTableId }
      : undefined,
  featureAnalyzer: createDeterministicAnalyzer(),
  feishuLibraryProvisioner:
    feishuAppId && feishuAppSecret
      ? createFeishuLibraryProvisioner({ appId: feishuAppId, appSecret: feishuAppSecret })
      : undefined,
  feishuSyncService,
  processAnalysisImmediately: false,
  settingsService: createSettingsService({
    environment: process.env,
    envPath: settingsEnvPath
  }),
  storageRoot: process.env["MUSIC_STORAGE_PATH"] ?? join(tmpdir(), "analyze-music-work")
});

const close = async () => {
  await app.close();
  database.close();
};

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

await app.listen({ host: "127.0.0.1", port: Number(process.env["PORT"] ?? 3001) });
