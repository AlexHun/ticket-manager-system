import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_PORT = 3002;
const WEB_PORT = 4001;
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // `list` (or `github` on CI) keeps live console output; `html` writes the
  // browsable report to playwright-report/. open: "never" stops Playwright from
  // auto-spawning a browser on failure, which breaks non-interactive runs.
  reporter: [
    process.env.CI ? ["github"] : ["list"],
    ["html", { open: "never" }],
  ],
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // Use dotenv-cli so NODE_ENV from .env.test actually reaches the process
      // (Bun's --env-file silently ignores NODE_ENV).
      command: "bunx dotenv -e .env.test -- bun src/index.ts",
      cwd: path.join(__dirname, "apps/api"),
      url: `${API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `bunx --bun vite --port ${WEB_PORT} --strictPort`,
      cwd: path.join(__dirname, "apps/web"),
      env: { VITE_API_URL: API_URL },
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
