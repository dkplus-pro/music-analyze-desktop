import { describe, expect, it } from "vitest";

import {
  createFeishuLibraryProvisioner,
  createFeishuOpenApiExporter
} from "../src/services/feishu-exporter.js";
import { feishuLibraryFields } from "../src/services/feishu-library-schema.js";

describe("Feishu OpenAPI exporter", () => {
  it("exchanges an app credential then creates and updates Bitable records", async () => {
    const calls: Array<{ body: string; method: string; url: string }> = [];
    const exporter = createFeishuOpenApiExporter({
      appId: "cli_test",
      appSecret: "secret",
      appToken: "app_token",
      baseUrl: "https://feishu.test/open-apis",
      fetchImplementation: async (url, init) => {
        calls.push({ body: String(init?.body), method: init?.method ?? "GET", url: String(url) });
        if (String(url).endsWith("/tenant_access_token/internal")) {
          return new Response(
            JSON.stringify({ code: 0, expire: 7_200, tenant_access_token: "tenant-token" })
          );
        }
        return new Response(
          JSON.stringify({ code: 0, data: { record: { record_id: "rec_001" } } })
        );
      },
      tableId: "tbl_music"
    });

    await expect(
      exporter.syncMusic([{ fields: { 名称: "Remember Me" }, trackId: "music-1" }])
    ).resolves.toEqual([{ recordId: "rec_001", trackId: "music-1" }]);
    await expect(
      exporter.syncMusic([
        { fields: { 名称: "Remember Me (edit)" }, recordId: "rec_001", trackId: "music-1" }
      ])
    ).resolves.toEqual([{ recordId: "rec_001", trackId: "music-1" }]);
    await expect(exporter.deleteMusic("rec_001")).resolves.toBeUndefined();
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "https://feishu.test/open-apis/auth/v3/tenant_access_token/internal"
      }),
      expect.objectContaining({
        method: "POST",
        url: "https://feishu.test/open-apis/bitable/v1/apps/app_token/tables/tbl_music/records"
      }),
      expect.objectContaining({
        method: "PUT",
        url: "https://feishu.test/open-apis/bitable/v1/apps/app_token/tables/tbl_music/records/rec_001"
      }),
      expect.objectContaining({
        method: "DELETE",
        url: "https://feishu.test/open-apis/bitable/v1/apps/app_token/tables/tbl_music/records/rec_001"
      })
    ]);
  });

  it("creates a Bitable and its music-library fields", async () => {
    const calls: Array<{ body: string; method: string; url: string }> = [];
    const provisioner = createFeishuLibraryProvisioner({
      appId: "cli_test",
      appSecret: "secret",
      baseUrl: "https://feishu.test/open-apis",
      fetchImplementation: async (url, init) => {
        const request = {
          body: String(init?.body),
          method: init?.method ?? "GET",
          url: String(url)
        };
        calls.push(request);
        if (request.url.endsWith("/tenant_access_token/internal")) {
          return new Response(JSON.stringify({ code: 0, tenant_access_token: "tenant-token" }));
        }
        if (request.url.endsWith("/bitable/v1/apps")) {
          return new Response(JSON.stringify({ code: 0, data: { app: { app_token: "app_new" } } }));
        }
        if (request.url.endsWith("/tables")) {
          return new Response(
            JSON.stringify({ code: 0, data: { items: [{ table_id: "tbl_new" }] } })
          );
        }
        return new Response(JSON.stringify({ code: 0, data: { field: { field_id: "fld_new" } } }));
      }
    });

    await expect(provisioner.createLibrary()).resolves.toMatchObject({
      appToken: "app_new",
      tableId: "tbl_new"
    });
    const fieldRequests = calls.filter((call) => call.url.endsWith("/fields"));
    expect(fieldRequests).toHaveLength(feishuLibraryFields.length);
    expect(fieldRequests.map((request) => JSON.parse(request.body))).toContainEqual(
      expect.objectContaining({
        field_name: "主情绪",
        property: { options: expect.arrayContaining([{ name: "温暖" }]) },
        type: 3
      })
    );
  });
});
