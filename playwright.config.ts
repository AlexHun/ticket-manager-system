import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_PORT = 3002;
const WEB_PORT = 4001;
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

// A second, AI-enabled API instance for issue #26's real-pipeline E2E spec
// (tests/e2e/knowledge-auto-reply-approval.spec.ts) — see that file and
// apps/api/.env.test.ai for why this cannot just be the ordinary :3002 server
// with AUTO_REPLY_ENABLED flipped on: every other spec in this suite asserts
// tickets stay uncategorised while AI is off, and flipping it suite-wide would
// make all of them flaky. `AI_API_PORT` must match `.env.test.ai`'s `PORT`;
// `FAKE_OPENAI_PORT` must match `tests/e2e/fake-openai/constants.ts`'s
// `STUB_PORT`. Safe to share the ordinary run's `ticket_manager_test` database
// only because `workers: 1` below means nothing else is writing concurrently.
const AI_API_PORT = 3003;
const FAKE_OPENAI_PORT = 3999;
const AI_API_URL = `http://localhost:${AI_API_PORT}`;

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
      // **`bunx vite`, not `bunx --bun vite`** — the one difference from
      // `apps/web`'s own `dev` script, and it is deliberate. Under `--bun`,
      // Vite runs on Bun's runtime rather than Node's, and spawned from
      // Playwright it deadlocks on this machine: the process reaches ~240mb
      // resident, binds this port and accepts Playwright's readiness probe,
      // then sits at **0% CPU with the request unanswered, no listening socket
      // left, and not one line on stdout** — no banner, no error, nothing for
      // Playwright to report but its own timeout. Started by hand, or from a
      // script, the same command is fine: 14 consecutive starts under `--bun`
      // served in 2-8s, including with the API server up alongside it. Only the
      // Playwright-spawned one hangs, and only sometimes.
      //
      // The mechanism inside Bun is **not** established — what is established is
      // that the stall follows `--bun` and that dropping it costs nothing here
      // (Vite is a Node tool; the flag was buying a runtime it does not need).
      // If this ever comes back, the next thing to try is `stdout: "ignore"`
      // below: a child blocked writing to a pipe nobody drained would look
      // exactly like this.
      command: `bunx vite --port ${WEB_PORT} --strictPort`,
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
      // Raised from 120s while chasing the deadlock described on `command`
      // above, and **more time was never the answer** — a run blew through 420s
      // too, because a process at 0% CPU does not finish starting no matter how
      // long you wait. Kept as headroom for a genuinely cold dependency
      // optimize, which is the only thing here that legitimately takes minutes;
      // a warm start is 3-4s. Don't raise it again in response to a timeout.
      //
      // If this ever times out again: **a timeout can leave Vite alive on 4001.**
      // `reuseExistingServer` below then silently adopts the survivor on the next
      // run — possibly built with different settings — so a green run straight
      // after a timeout proves nothing until the port owner has been checked.
      // Starting the web server by hand and letting the suite adopt it is also
      // the fallback if the spawned one misbehaves:
      //
      //   cd apps/web && VITE_API_URL=http://localhost:3002 \
      //     bunx vite --port 4001 --strictPort
      timeout: 420_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // The fake OpenAI stub — see tests/e2e/fake-openai/server.ts. Plain
      // node:http under Bun, no framework, up for the whole suite alongside
      // everything else at negligible cost.
      command: `bun tests/e2e/fake-openai/server.ts`,
      cwd: __dirname,
      url: `http://localhost:${FAKE_OPENAI_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // The second, AI-enabled API instance. `-o`/`--override` is load-bearing,
      // not a style choice: dotenv's default is to leave a key alone once an
      // earlier `-e` file has set it, so without this flag `.env.test.ai`'s
      // PORT/OPENAI_API_KEY/OPENAI_BASE_URL/AUTO_REPLY_ENABLED/
      // PIPELINE_SIMULATOR_ENABLED would silently lose to .env.test's values —
      // verified against dotenv's own `populate()` rather than assumed. Every
      // other key (DATABASE_URL, BETTER_AUTH_SECRET, TRUSTED_ORIGINS,
      // SEED_ADMIN_*, webhook creds, NODE_ENV=test) is untouched by
      // `.env.test.ai` and keeps flowing from `.env.test`.
      command:
        "bunx dotenv -e .env.test -e .env.test.ai -o -- bun src/index.ts",
      cwd: path.join(__dirname, "apps/api"),
      url: `${AI_API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
