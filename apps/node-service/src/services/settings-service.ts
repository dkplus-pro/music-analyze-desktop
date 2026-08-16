import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const secretKeys = new Set(["BAILIAN_API_KEY", "FEISHU_APP_SECRET"]);
const settingKeys = [
  "BAILIAN_API_KEY",
  "BAILIAN_BASE_URL",
  "BAILIAN_MODEL",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_APP_TOKEN",
  "FEISHU_TABLE_ID"
] as const;

type SettingKey = (typeof settingKeys)[number];

export interface SettingsPatch {
  ai?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  feishu?: {
    appId?: string;
    appSecret?: string;
    appToken?: string;
    tableId?: string;
  };
}

export interface SettingsView {
  ai: {
    apiKeyConfigured: boolean;
    apiKeySuffix: string | null;
    baseUrl: string;
    model: string;
  };
  feishu: {
    appId: string;
    appIdConfigured: boolean;
    appSecretConfigured: boolean;
    appSecretSuffix: string | null;
    appToken: string;
    appTokenConfigured: boolean;
    tableId: string;
    tableIdConfigured: boolean;
  };
}

export function parseSettingsPatch(input: unknown): SettingsPatch | undefined {
  if (!isRecord(input)) return undefined;
  const patch: SettingsPatch = {};
  if (input["ai"] !== undefined) {
    if (!isRecord(input["ai"])) return undefined;
    const ai = readStringFields(input["ai"], ["apiKey", "baseUrl", "model"]);
    if (!ai) return undefined;
    patch.ai = ai;
  }
  if (input["feishu"] !== undefined) {
    if (!isRecord(input["feishu"])) return undefined;
    const feishu = readStringFields(input["feishu"], ["appId", "appSecret", "appToken", "tableId"]);
    if (!feishu) return undefined;
    patch.feishu = feishu;
  }
  return patch.ai || patch.feishu ? patch : undefined;
}

export function createSettingsService({
  envPath,
  environment = process.env
}: {
  envPath?: string;
  environment?: Record<string, string | undefined>;
}) {
  return {
    read: async (): Promise<SettingsView> => {
      const fileValues = envPath ? await readEnvFile(envPath) : {};
      return toSettingsView({ ...fileValues, ...environment });
    },

    update: async (patch: SettingsPatch): Promise<SettingsView> => {
      if (!envPath) throw new Error("Settings file path is not configured");
      const original = await readFile(envPath, "utf8").catch((error: unknown) => {
        if (isMissingFile(error)) return "";
        throw error;
      });
      const current = parseEnv(original);
      const updates = patchToEnv(patch, current);
      const next = replaceEnvValues(original, updates);
      await mkdir(dirname(envPath), { recursive: true });
      const temporaryPath = join(
        dirname(envPath),
        `.${basename(envPath)}.${process.pid}.${Date.now()}.tmp`
      );
      try {
        await writeFile(temporaryPath, next, "utf8");
        await rename(temporaryPath, envPath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
      for (const [key, value] of Object.entries(updates)) {
        environment[key] = value;
      }
      return toSettingsView({ ...current, ...updates, ...environment });
    }
  };
}

function patchToEnv(patch: SettingsPatch, current: Record<string, string>) {
  const updates: Partial<Record<SettingKey, string>> = {};
  const set = (key: SettingKey, value: string | undefined) => {
    if (value === undefined) return;
    updates[key] = value === "" && secretKeys.has(key) ? (current[key] ?? "") : value;
  };
  set("BAILIAN_API_KEY", patch.ai?.apiKey);
  set("BAILIAN_BASE_URL", patch.ai?.baseUrl);
  set("BAILIAN_MODEL", patch.ai?.model);
  set("FEISHU_APP_ID", patch.feishu?.appId);
  set("FEISHU_APP_SECRET", patch.feishu?.appSecret);
  set("FEISHU_APP_TOKEN", patch.feishu?.appToken);
  set("FEISHU_TABLE_ID", patch.feishu?.tableId);
  return updates;
}

function toSettingsView(values: Record<string, string | undefined>): SettingsView {
  const apiKey = values["BAILIAN_API_KEY"]?.trim() ?? "";
  const appSecret = values["FEISHU_APP_SECRET"]?.trim() ?? "";
  const appId = values["FEISHU_APP_ID"]?.trim() ?? "";
  const appToken = values["FEISHU_APP_TOKEN"]?.trim() ?? "";
  const tableId = values["FEISHU_TABLE_ID"]?.trim() ?? "";
  return {
    ai: {
      apiKeyConfigured: Boolean(apiKey),
      apiKeySuffix: maskSecret(apiKey),
      baseUrl: values["BAILIAN_BASE_URL"]?.trim() ?? "",
      model: values["BAILIAN_MODEL"]?.trim() ?? ""
    },
    feishu: {
      appId,
      appIdConfigured: Boolean(appId),
      appSecretConfigured: Boolean(appSecret),
      appSecretSuffix: maskSecret(appSecret),
      appToken,
      appTokenConfigured: Boolean(appToken),
      tableId,
      tableIdConfigured: Boolean(tableId)
    }
  };
}

function maskSecret(value: string) {
  return value ? `...${value.slice(-6)}` : null;
}

async function readEnvFile(path: string) {
  const content = await readFile(path, "utf8").catch((error: unknown) => {
    if (isMissingFile(error)) return "";
    throw error;
  });
  return parseEnv(content);
}

function parseEnv(content: string) {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    values[match[1]!] = parseEnvValue(match[2] ?? "");
  }
  return values;
}

function replaceEnvValues(content: string, updates: Partial<Record<SettingKey, string>>) {
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*(?:export\s+)?)([A-Z][A-Z0-9_]*)(\s*=\s*).*$/);
    if (!match || !(match[2]! in updates)) return line;
    seen.add(match[2]!);
    return `${match[1]}${match[2]}=${formatEnvValue(updates[match[2]! as SettingKey] ?? "")}`;
  });
  for (const key of settingKeys) {
    if (!seen.has(key) && updates[key] !== undefined) {
      while (lines.length && lines.at(-1) === "") lines.pop();
      lines.push(`${key}=${formatEnvValue(updates[key]!)}`);
    }
  }
  return `${lines.join("\n").replace(/\n*$/, "")}\n`;
}

function formatEnvValue(value: string) {
  return /[\s#"']/.test(value) ? JSON.stringify(value) : value;
}

function parseEnvValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readStringFields<T extends string>(input: Record<string, unknown>, keys: T[]) {
  const values: Record<string, string> = {};
  for (const key of keys) {
    if (input[key] !== undefined && typeof input[key] !== "string") return undefined;
    if (typeof input[key] === "string") values[key] = input[key] as string;
  }
  return values as { [K in T]?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
