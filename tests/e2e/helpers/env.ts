import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envTestPath = path.resolve(__dirname, "../../../apps/api/.env.test");

/**
 * The Playwright process never gets `apps/api/.env.test` loaded for it — only
 * the API webServer does, via dotenv-cli (see playwright.config.ts). Parse the
 * file directly so specs read the same values the server was started with
 * instead of duplicating them as literals.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const raw = fs.readFileSync(filePath, "utf8");
  const out: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value.replace(/^["']|["']$/g, "");
  }

  return out;
}

const testEnv = parseEnvFile(envTestPath);

/** Read a required key, failing loudly rather than silently defaulting. */
export function requireEnv(key: string): string {
  const value = testEnv[key];
  if (!value) {
    throw new Error(
      `${key} is missing or empty in ${envTestPath}. ` +
        `Copy apps/api/.env.test.example and fill it in.`,
    );
  }
  return value;
}

export const DATABASE_URL = requireEnv("DATABASE_URL");
export const API_URL = requireEnv("API_URL");
export const WEBHOOK_URL = requireEnv("INBOUND_EMAIL_WEBHOOK_URL");
export const WEBHOOK_USERNAME = requireEnv("INBOUND_EMAIL_WEBHOOK_USERNAME");
export const WEBHOOK_PASSWORD = requireEnv("INBOUND_EMAIL_WEBHOOK_PASSWORD");
