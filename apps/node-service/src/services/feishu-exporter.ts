import { feishuLibraryFields } from "./feishu-library-schema.js";

export interface FeishuMusicRecord {
  fields: Record<string, null | number | string | string[]>;
  recordId?: string;
  trackId: string;
}

export interface MusicExporter {
  deleteMusic(recordId: string): Promise<void>;
  syncMusic(records: FeishuMusicRecord[]): Promise<Array<{ recordId: string; trackId: string }>>;
}

export interface FeishuLibraryProvisioner {
  createLibrary(
    name?: string
  ): Promise<{ appToken: string; exporter: MusicExporter; tableId: string }>;
}

interface FeishuOpenApiExporterOptions {
  appId: string;
  appSecret: string;
  appToken: string;
  baseUrl?: string;
  fetchImplementation?: typeof fetch;
  tableId: string;
}

export function createFeishuOpenApiExporter({
  appId,
  appSecret,
  appToken,
  baseUrl = "https://open.feishu.cn/open-apis",
  fetchImplementation = fetch,
  tableId
}: FeishuOpenApiExporterOptions): MusicExporter {
  let cachedToken: { expiresAt: number; value: string } | undefined;

  const getToken = async () => {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
    const response = await fetchImplementation(
      `${baseUrl.replace(/\/$/, "")}/auth/v3/tenant_access_token/internal`,
      {
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
        headers: { "content-type": "application/json; charset=utf-8" },
        method: "POST"
      }
    );
    const body = (await response.json().catch(() => ({}))) as {
      code?: number;
      expire?: number;
      msg?: string;
      tenant_access_token?: string;
    };
    if (!response.ok || body.code !== 0 || !body.tenant_access_token) {
      throw new Error(`Feishu token request failed: ${body.msg ?? response.status}`);
    }
    cachedToken = {
      expiresAt: Date.now() + Math.max(60, (body.expire ?? 7_200) - 60) * 1_000,
      value: body.tenant_access_token
    };
    return cachedToken.value;
  };

  return {
    deleteMusic: async (recordId) => {
      const token = await getToken();
      const response = await fetchImplementation(
        `${baseUrl.replace(/\/$/, "")}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}`,
        {
          headers: { authorization: `Bearer ${token}` },
          method: "DELETE"
        }
      );
      const body = (await response.json().catch(() => ({}))) as { code?: number; msg?: string };
      if (!response.ok || body.code !== 0) {
        throw new Error(`Feishu record delete failed: ${body.msg ?? response.status}`);
      }
    },
    syncMusic: async (records) => {
      const token = await getToken();
      const results: Array<{ recordId: string; trackId: string }> = [];
      for (const record of records) {
        const method = record.recordId ? "PUT" : "POST";
        const suffix = record.recordId ? `/${encodeURIComponent(record.recordId)}` : "";
        const response = await fetchImplementation(
          `${baseUrl.replace(/\/$/, "")}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records${suffix}`,
          {
            body: JSON.stringify({ fields: record.fields }),
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json; charset=utf-8"
            },
            method
          }
        );
        const body = (await response.json().catch(() => ({}))) as {
          code?: number;
          data?: { record?: { record_id?: string } };
          msg?: string;
        };
        const recordId = body.data?.record?.record_id ?? record.recordId;
        if (!response.ok || body.code !== 0 || !recordId) {
          throw new Error(
            `Feishu record sync failed for ${record.trackId}: ${body.msg ?? response.status}`
          );
        }
        results.push({ recordId, trackId: record.trackId });
      }
      return results;
    }
  };
}

export function createFeishuLibraryProvisioner({
  appId,
  appSecret,
  baseUrl = "https://open.feishu.cn/open-apis",
  fetchImplementation = fetch
}: Omit<FeishuOpenApiExporterOptions, "appToken" | "tableId">): FeishuLibraryProvisioner {
  return {
    createLibrary: async (name = "Analyze Music 音乐库") => {
      const token = await exchangeTenantAccessToken({
        appId,
        appSecret,
        baseUrl,
        fetchImplementation
      });
      const app = await feishuRequest<{ app?: { app_token?: string } }>({
        body: { name },
        fetchImplementation,
        method: "POST",
        token,
        url: `${baseUrl.replace(/\/$/, "")}/bitable/v1/apps`
      });
      const appToken = app.app?.app_token;
      if (!appToken) throw new Error("Feishu did not return the newly created Bitable app token");
      const tables = await feishuRequest<{ items?: Array<{ table_id?: string }> }>({
        fetchImplementation,
        method: "GET",
        token,
        url: `${baseUrl.replace(/\/$/, "")}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`
      });
      const tableId = tables.items?.[0]?.table_id;
      if (!tableId) throw new Error("Feishu did not return the default Bitable table");
      for (const field of feishuLibraryFields) {
        await feishuRequest({
          body: field,
          fetchImplementation,
          method: "POST",
          token,
          url: `${baseUrl.replace(/\/$/, "")}/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`
        });
      }
      return {
        appToken,
        exporter: createFeishuOpenApiExporter({
          appId,
          appSecret,
          appToken,
          baseUrl,
          fetchImplementation,
          tableId
        }),
        tableId
      };
    }
  };
}

async function exchangeTenantAccessToken({
  appId,
  appSecret,
  baseUrl,
  fetchImplementation
}: {
  appId: string;
  appSecret: string;
  baseUrl: string;
  fetchImplementation: typeof fetch;
}) {
  const response = await fetchImplementation(
    `${baseUrl.replace(/\/$/, "")}/auth/v3/tenant_access_token/internal`,
    {
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      headers: { "content-type": "application/json; charset=utf-8" },
      method: "POST"
    }
  );
  const body = (await response.json().catch(() => ({}))) as {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
  };
  if (!response.ok || body.code !== 0 || !body.tenant_access_token) {
    throw new Error(`Feishu token request failed: ${body.msg ?? response.status}`);
  }
  return body.tenant_access_token;
}

async function feishuRequest<T>({
  body,
  fetchImplementation,
  method,
  token,
  url
}: {
  body?: unknown;
  fetchImplementation: typeof fetch;
  method: "GET" | "POST";
  token: string;
  url: string;
}) {
  const response = await fetchImplementation(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8"
    },
    method
  });
  const result = (await response.json().catch(() => ({}))) as {
    code?: number;
    data?: T;
    msg?: string;
  };
  if (!response.ok || result.code !== 0 || !result.data) {
    throw new Error(`Feishu library setup failed: ${result.msg ?? response.status}`);
  }
  return result.data;
}
