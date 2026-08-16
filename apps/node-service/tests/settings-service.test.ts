import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createSettingsService } from "../src/services/settings-service.js";

describe("settings service", () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
    );
  });

  it("reads env configuration while masking secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "analyze-music-settings-"));
    temporaryRoots.push(root);
    const envPath = join(root, ".env");
    await writeFile(
      envPath,
      [
        "BAILIAN_API_KEY=sk-test-secret",
        "BAILIAN_BASE_URL=https://dashscope.example/v1",
        "BAILIAN_MODEL=qwen-test",
        "FEISHU_APP_ID=cli_test",
        "FEISHU_APP_SECRET=feishu-secret",
        "FEISHU_APP_TOKEN=app_token",
        "FEISHU_TABLE_ID=tbl_test"
      ].join("\n")
    );

    const settings = createSettingsService({ envPath, environment: {} });
    const view = await settings.read();

    expect(view).toMatchObject({
      ai: {
        apiKeyConfigured: true,
        apiKeySuffix: "...secret",
        baseUrl: "https://dashscope.example/v1",
        model: "qwen-test"
      },
      feishu: {
        appId: "cli_test",
        appIdConfigured: true,
        appSecretConfigured: true,
        appTokenConfigured: true,
        tableId: "tbl_test",
        tableIdConfigured: true
      }
    });
    expect(JSON.stringify(view)).not.toContain("sk-test-secret");
    expect(JSON.stringify(view)).not.toContain("feishu-secret");
  });

  it("updates approved values atomically and preserves blank secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "analyze-music-settings-"));
    temporaryRoots.push(root);
    const envPath = join(root, ".env");
    await writeFile(envPath, "BAILIAN_API_KEY=sk-original\nUNKNOWN=value\n");
    const settings = createSettingsService({ envPath, environment: {} });

    const view = await settings.update({
      ai: { apiKey: "", baseUrl: "https://new.example/v1", model: "qwen-new" },
      feishu: { appId: "cli_new", appSecret: "", appToken: "app_new", tableId: "tbl_new" }
    });
    const file = await readFile(envPath, "utf8");

    expect(view.ai).toMatchObject({
      apiKeyConfigured: true,
      baseUrl: "https://new.example/v1",
      model: "qwen-new"
    });
    expect(view.feishu).toMatchObject({ appId: "cli_new", appTokenConfigured: true });
    expect(file).toContain("BAILIAN_API_KEY=sk-original");
    expect(file).toContain("BAILIAN_MODEL=qwen-new");
    expect(file).toContain("FEISHU_APP_SECRET=");
    expect(file).toContain("UNKNOWN=value");
  });
});
