import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CliConfig {
  apiKey?: string;
  baseUrl: string;
  mailto?: string;
}

export type ConfigKey = "apiKey" | "baseUrl" | "mailto";

export interface StoredCliConfig {
  apiKey?: string;
  baseUrl?: string;
  mailto?: string;
}

export function getConfig(): CliConfig {
  const stored = readStoredConfig();
  const envApiKey = readEnvValue(process.env.OPENALEX_API_KEY);
  const envBaseUrl = readEnvValue(process.env.OPENALEX_BASE_URL);
  const envMailto = readEnvValue(process.env.OPENALEX_MAILTO);

  return {
    apiKey: envApiKey ?? stored.apiKey,
    baseUrl: envBaseUrl ?? stored.baseUrl ?? "https://api.openalex.org",
    mailto: envMailto ?? stored.mailto,
  };
}

export function getConfigPath(): string {
  return path.join(os.homedir(), ".openalex-skill", "config.json");
}

export function readStoredConfig(): StoredCliConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, "utf8").trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    apiKey: typeof parsed.apiKey === "string" && parsed.apiKey ? parsed.apiKey : undefined,
    baseUrl: typeof parsed.baseUrl === "string" && parsed.baseUrl ? parsed.baseUrl : undefined,
    mailto: typeof parsed.mailto === "string" && parsed.mailto ? parsed.mailto : undefined,
  };
}

export function readStoredConfigForMutation(): StoredCliConfig {
  try {
    return readStoredConfig();
  } catch {
    return {};
  }
}

export function writeStoredConfig(config: StoredCliConfig): void {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function updateStoredConfig(key: ConfigKey, value: string): StoredCliConfig {
  const current = readStoredConfigForMutation();
  const next: StoredCliConfig = { ...current, [key]: value };
  writeStoredConfig(next);
  return next;
}

export function unsetStoredConfig(key: ConfigKey): StoredCliConfig {
  const current = readStoredConfigForMutation();
  const next: StoredCliConfig = { ...current };
  delete next[key];
  writeStoredConfig(next);
  return next;
}

export function maskSecret(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function readEnvValue(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

export function isTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
