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
    // The dashboard animates: Recharts grows its bars in and the KPI tiles
    // count up, so for ~600ms the DOM holds numbers and geometry that were
    // never true. Every route change also runs `animate-page-in`. Emulating the
    // reduced-motion preference turns all of it off at the source — Recharts'
    // `isAnimationActive: "auto"` and `useReducedMotion` both honour it — so an
    // assertion can't catch a half-drawn frame.
    //
    // It has to go under `contextOptions`, and that is not a style choice.
    // `reducedMotion` is not a top-level `use` option in Playwright 1.60, so
    // setting it there is accepted by `defineConfig` and then dropped: the trace
    // of a run recorded `"reducedMotion":"undefined"`, meaning every test so far
    // ran with animations *on*, against the intent of the comment above. Only
    // the tsc error on the root tsconfig ever pointed at it, and no workspace
    // typecheck script covers this file. Verify after changing: the context
    // options in a `--trace=on` run should read `"reducedMotion":"reduce"`.
    contextOptions: { reducedMotion: "reduce" },
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
      // A distinct `VITE_API_URL` from the dev server's, which is also what
      // gives this run its own dependency cache — see `cacheDir` in
      // `apps/web/vite.config.ts`.
      //
      // Sharing one cache with the dev server was tried and is worse: two Vite
      // processes optimizing into the same directory contend, and the E2E server
      // then never becomes ready at all. Measured — a warm run with its own cache
      // is ready in ~4s; the same run sharing the dev server's cache while
      // `bun run dev` is up hangs past 420s.
      env: { VITE_API_URL: API_URL },
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      // Longer than the API's, which starts in about a second.
      //
      // Raised from 120s while chasing a startup that hangs on this machine, and
      // **it did not fix that** — a run blew through 420s too. It is headroom for
      // a slow cold optimize, not a cure. Read the note below before raising it
      // again; more time was already tried.
      //
      // What *is* established: when this server starts at all it is ready in
      // ~3-4s, and the failure looks identical every time — Vite logs the
      // dev-tools plugin line, never reaches its own "ready" banner, and
      // Playwright reports only `Timed out waiting …ms from config.webServer`
      // with nothing about the cause. It is intermittent and independent of
      // whether the dependency cache is warm.
      //
      // The reliable workaround is to start the web server yourself first —
      // `reuseExistingServer` below then adopts it:
      //
      //   cd apps/web && VITE_API_URL=http://localhost:3002 \
      //     bunx --bun vite --port 4001 --strictPort
      //
      // **A timeout here can leave that Vite alive on 4001.** Because
      // `reuseExistingServer` is on, the next run silently adopts the survivor —
      // possibly built with different settings — so a green run straight after a
      // timeout proves nothing until the port owner has been checked.
      timeout: 420_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
