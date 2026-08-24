import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

export type FwEnvName = "local" | "dev" | "staging" | "prod";

export type FwEnv = {
  name: FwEnvName;
  baseUrl: string;
  apiUrl: string;
  apiKey: string | undefined;
  storageState: string | undefined;
  convertTimeoutMs: number;
};

const PRESETS: Record<FwEnvName, { baseUrl: string; apiUrl: string }> = {
  local: {
    baseUrl: "http://localhost:3000",
    apiUrl: "http://localhost:8000",
  },
  dev: {
    baseUrl: "https://fileworks-dev.pages.dev",
    // Dev often uses a Lambda Function URL — set FW_API_URL or let `fw test` inject it.
    apiUrl: "https://api.dev.fileworks.ai",
  },
  staging: {
    baseUrl: "https://staging.fileworks.ai",
    apiUrl: "https://api.staging.fileworks.ai",
  },
  prod: {
    baseUrl: "https://fileworks.ai",
    apiUrl: "https://api.fileworks.ai",
  },
};

function loadDotenv(envName: FwEnvName) {
  const root = path.resolve(__dirname, "..");
  for (const file of [`.env.${envName}`, ".env.local", ".env"]) {
    const full = path.join(root, file);
    if (fs.existsSync(full)) {
      dotenv.config({ path: full, override: false });
    }
  }
}

function resolveEnvName(): FwEnvName {
  const raw = (process.env.FW_ENV || "staging").toLowerCase();
  if (raw === "local" || raw === "dev" || raw === "staging" || raw === "prod") return raw;
  throw new Error(`Unknown FW_ENV="${raw}". Use local|dev|staging|prod.`);
}

/** Resolve target environment. Safe to call from Playwright config and tests. */
export function getEnv(): FwEnv {
  const name = resolveEnvName();
  loadDotenv(name);
  const preset = PRESETS[name];
  return {
    name,
    baseUrl: (process.env.FW_BASE_URL || preset.baseUrl).replace(/\/$/, ""),
    apiUrl: (process.env.FW_API_URL || preset.apiUrl).replace(/\/$/, ""),
    apiKey: process.env.FW_API_KEY || undefined,
    storageState: process.env.FW_STORAGE_STATE || undefined,
    convertTimeoutMs: Number(process.env.FW_CONVERT_TIMEOUT_MS || 180_000),
  };
}

export function requireApiKey(env: FwEnv = getEnv()): string {
  if (!env.apiKey) {
    throw new Error(
      `FW_API_KEY is required for convert API tests against ${env.name}. ` +
        `Copy integration/.env.example → integration/.env and set a fw_live_ key.`,
    );
  }
  return env.apiKey;
}
