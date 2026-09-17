import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Connect, ViteDevServer } from "vite";
import type { ServerResponse } from "node:http";
import { devToolsPlugin } from "./plugin.ts";
import { DEVTOOLS_API, type UsageReport } from "../src/dev/protocol.ts";
import { ISSUES_FILE_ENV } from "./issues.ts";
import { TRANSCRIPT_DIR_ENV, resolveTranscriptDir } from "./usage.ts";

/**
 * The usage route, exercised through the plugin rather than around it.
 *
 * It exists for one bug, and for the reason that bug survived five green E2E
 * cases: `tests/e2e/dev-usage.spec.ts` sets `CLAUDE_TRANSCRIPT_DIR`, which is
 * the *point* of the override and also means the spec never reaches the branch
 * that derives a directory when nothing is set. That branch shipped wrong — the
 * plugin let the resolver default to `process.cwd()`, which for a Vite dev
 * server is `apps/web`, so the page looked in `…/projects/<repo-slug>-apps-web`
 * and reported ENOENT to anyone who pressed Scan.
 *
 * Vitest runs this suite with `apps/web` as its working directory, which is the
 * dev server's cwd exactly — so the condition the bug needed is the condition
 * these tests run under, with no simulation required.
 */

/** The smallest `ViteDevServer` the plugin's `configureServer` touches. */
function mountPlugin(): Map<string, Connect.NextHandleFunction[]> {
  const routes = new Map<string, Connect.NextHandleFunction[]>();
  const server = {
    middlewares: {
      use(path: string, handler: Connect.NextHandleFunction) {
        routes.set(path, [...(routes.get(path) ?? []), handler]);
      },
    },
    // The plugin registers a close handler to cancel in-flight test runs.
    httpServer: { once() {} },
    config: { logger: { info() {} } },
  };

  // `configureServer` is an `ObjectHook`, so it is either the handler or a
  // `{ handler, order }` pair — and read off the plugin it carries a `this`
  // requirement (Vite's plugin context) that this fake has no business
  // satisfying. Narrowing to a plain call signature is what drops it.
  const hook = devToolsPlugin().configureServer;
  const configure = (typeof hook === "function" ? hook : hook?.handler) as
    ((server: ViteDevServer) => void) | undefined;
  if (!configure) throw new Error("the plugin no longer configures a server");

  configure(server as unknown as ViteDevServer);
  return routes;
}

/**
 * Drive one registered handler and return the JSON body it wrote.
 *
 * Asynchronous because the usage handler is: it waits on the issue listing
 * (`gh`, or the file the environment names). So "did this handler answer?"
 * cannot be read off the status immediately after the call — what is read
 * instead is whether the handler passed the request on. `only()` calls `next()`
 * synchronously for a method it does not serve and otherwise takes ownership,
 * which is the same signal the real middleware stack goes by.
 */
async function callRoute(
  routes: Map<string, Connect.NextHandleFunction[]>,
  path: string,
  method: string,
): Promise<{ status: number; body: unknown }> {
  const handlers = routes.get(path);
  if (!handlers) throw new Error(`Nothing registered on ${path}`);

  let status = 0;
  let payload = "";
  let written!: () => void;
  const answered = new Promise<void>((resolve) => {
    written = resolve;
  });
  const res = {
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(chunk: string) {
      payload = chunk;
      written();
    },
  } as unknown as ServerResponse;

  let taken = false;
  for (const handler of handlers) {
    let passedOn = false;
    handler({ method, url: path } as never, res, () => {
      passedOn = true;
    });
    if (passedOn) continue;
    await answered;
    taken = true;
    break;
  }
  if (!taken) throw new Error(`No handler answered ${method} ${path}`);

  return { status, body: JSON.parse(payload) as unknown };
}

const scanUsage = async (): Promise<UsageReport> => {
  const { status, body } = await callRoute(
    mountPlugin(),
    DEVTOOLS_API.usage,
    "POST",
  );
  expect(status).toBe(200);
  return body as UsageReport;
};

/**
 * The issue listing, pinned to a file for every test here.
 *
 * Not an optimisation: the route asks `gh` when nothing overrides it, so an
 * unset `GH_ISSUES_FILE` would have this suite shelling out to GitHub — slow,
 * dependent on the machine being authenticated, and answering with whatever
 * this repository's issues happen to be titled today. The override is the same
 * seam Playwright uses, driven here for the same reason.
 */
const LISTING = [
  {
    number: 101,
    title: "The issue the fixture transcripts spent on",
    state: "OPEN",
    url: "https://github.com/AlexHun/ticket-manager-system/issues/101",
    labels: [{ name: "forecast/M" }],
  },
];

let envDir: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {
    [TRANSCRIPT_DIR_ENV]: process.env[TRANSCRIPT_DIR_ENV],
    [ISSUES_FILE_ENV]: process.env[ISSUES_FILE_ENV],
  };
  delete process.env[TRANSCRIPT_DIR_ENV];

  envDir = mkdtempSync(join(tmpdir(), "plugin-listing-"));
  const listing = join(envDir, "issues.json");
  writeFileSync(listing, JSON.stringify(LISTING), "utf8");
  process.env[ISSUES_FILE_ENV] = listing;
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(envDir, { recursive: true, force: true });
});

describe(`POST ${DEVTOOLS_API.usage}`, () => {
  it("derives the transcript directory from the repo root, not the dev server's cwd", async () => {
    // `apps/web/dev` → the repo root, the same two steps up the plugin makes.
    const repoRoot = resolve(import.meta.dirname, "../../..");

    const { transcriptDir } = await scanUsage();

    expect(transcriptDir).toBe(resolveTranscriptDir({}, { cwd: repoRoot }));
    // The shape of the wrong answer, named so a regression is legible rather
    // than just unequal: `process.cwd()` here is `apps/web`.
    expect(transcriptDir).not.toMatch(/-apps-web$/);
    expect(transcriptDir).not.toBe(
      resolveTranscriptDir({}, { cwd: process.cwd() }),
    );
  });

  it("honours the override, which is how Playwright points it at a fixture", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-usage-"));
    writeFileSync(
      join(dir, "s.jsonl"),
      JSON.stringify({
        sessionId: "s",
        gitBranch: "feat/101-a",
        message: { usage: { output_tokens: 4200 } },
      }),
      "utf8",
    );
    process.env[TRANSCRIPT_DIR_ENV] = dir;

    try {
      const report = await scanUsage();

      expect(report.transcriptDir).toBe(dir);
      expect(report.issues).toMatchObject([
        {
          issue: 101,
          spend: { out: 4200, turns: 1, sessions: 1, cacheRead: 0 },
        },
      ]);
      expect(report.warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers a missing directory with a warning rather than a 500", async () => {
    const missing = join(tmpdir(), "plugin-usage-not-here");
    process.env[TRANSCRIPT_DIR_ENV] = missing;

    const report = await scanUsage();

    // Not empty, since #251: the listing still names an open issue, and what it
    // was forecast to cost is knowable with no transcripts at all. Every figure
    // is absent rather than zero, and the warning says why there are none.
    expect(report.issues).toMatchObject([{ issue: 101, spend: null }]);
    expect(report.warnings[0]).toContain(missing);
  });

  // R2/R3 over the wire: the two sources are joined inside the middleware, so
  // the page receives one row and never has to ask GitHub anything itself.
  it("serves the listing's title, link and verdict beside the figures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-usage-"));
    writeFileSync(
      join(dir, "s.jsonl"),
      JSON.stringify({
        sessionId: "s",
        gitBranch: "feat/101-a",
        message: { usage: { output_tokens: 200_000 } },
      }),
      "utf8",
    );
    process.env[TRANSCRIPT_DIR_ENV] = dir;

    try {
      const [row] = (await scanUsage()).issues;

      expect(row).toEqual({
        issue: 101,
        spend: { out: 200_000, turns: 1, sessions: 1, cacheRead: 0 },
        title: "The issue the fixture transcripts spent on",
        url: "https://github.com/AlexHun/ticket-manager-system/issues/101",
        forecast: "M",
        bucket: "L",
        verdict: "over",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The degraded path, through the real middleware: the listing is the one the
  // environment names, and a missing one costs three columns rather than a 500.
  it("answers with the figures alone when the listing cannot be read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-usage-"));
    writeFileSync(
      join(dir, "s.jsonl"),
      JSON.stringify({
        sessionId: "s",
        gitBranch: "feat/101-a",
        message: { usage: { output_tokens: 4200 } },
      }),
      "utf8",
    );
    process.env[TRANSCRIPT_DIR_ENV] = dir;
    const missingListing = join(envDir, "gone.json");
    process.env[ISSUES_FILE_ENV] = missingListing;

    try {
      const report = await scanUsage();

      expect(report.issues[0]).toMatchObject({
        spend: { out: 4200 },
        title: null,
        url: null,
        forecast: null,
        bucket: "S",
        verdict: null,
      });
      expect(report.warnings.join(" ")).toContain(missingListing);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a GET, so the SPA fallback is never shadowed by a stale read", async () => {
    const routes = mountPlugin();

    await expect(callRoute(routes, DEVTOOLS_API.usage, "GET")).rejects.toThrow(
      /No handler answered/,
    );
  });
});
