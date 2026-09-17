import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Connect, ViteDevServer } from "vite";
import type { ServerResponse } from "node:http";
import { devToolsPlugin } from "./plugin.ts";
import { DEVTOOLS_API, type UsageReport } from "../src/dev/protocol.ts";
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

/** Drive one registered handler and return the JSON body it wrote. */
function callRoute(
  routes: Map<string, Connect.NextHandleFunction[]>,
  path: string,
  method: string,
): { status: number; body: unknown } {
  const handlers = routes.get(path);
  if (!handlers) throw new Error(`Nothing registered on ${path}`);

  let status = 0;
  let payload = "";
  const res = {
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(chunk: string) {
      payload = chunk;
    },
  } as unknown as ServerResponse;

  // Registered in order, and `only()` calls `next()` on a method it does not
  // answer — so walking the chain is what the real middleware stack does.
  let answered = false;
  for (const handler of handlers) {
    handler({ method, url: path } as never, res, () => {});
    if (status !== 0) {
      answered = true;
      break;
    }
  }
  if (!answered) throw new Error(`No handler answered ${method} ${path}`);

  return { status, body: JSON.parse(payload) as unknown };
}

const scanUsage = (): UsageReport => {
  const { status, body } = callRoute(mountPlugin(), DEVTOOLS_API.usage, "POST");
  expect(status).toBe(200);
  return body as UsageReport;
};

let override: string | undefined;

beforeEach(() => {
  override = process.env[TRANSCRIPT_DIR_ENV];
  delete process.env[TRANSCRIPT_DIR_ENV];
});
afterEach(() => {
  if (override === undefined) delete process.env[TRANSCRIPT_DIR_ENV];
  else process.env[TRANSCRIPT_DIR_ENV] = override;
});

describe(`POST ${DEVTOOLS_API.usage}`, () => {
  it("derives the transcript directory from the repo root, not the dev server's cwd", () => {
    // `apps/web/dev` → the repo root, the same two steps up the plugin makes.
    const repoRoot = resolve(import.meta.dirname, "../../..");

    const { transcriptDir } = scanUsage();

    expect(transcriptDir).toBe(resolveTranscriptDir({}, { cwd: repoRoot }));
    // The shape of the wrong answer, named so a regression is legible rather
    // than just unequal: `process.cwd()` here is `apps/web`.
    expect(transcriptDir).not.toMatch(/-apps-web$/);
    expect(transcriptDir).not.toBe(
      resolveTranscriptDir({}, { cwd: process.cwd() }),
    );
  });

  it("honours the override, which is how Playwright points it at a fixture", () => {
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
      const report = scanUsage();

      expect(report.transcriptDir).toBe(dir);
      expect(report.issues).toEqual([
        { issue: 101, out: 4200, turns: 1, sessions: 1, cacheRead: 0 },
      ]);
      expect(report.warnings).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers a missing directory with a warning rather than a 500", () => {
    const missing = join(tmpdir(), "plugin-usage-not-here");
    process.env[TRANSCRIPT_DIR_ENV] = missing;

    const report = scanUsage();

    expect(report.issues).toEqual([]);
    expect(report.warnings[0]).toContain(missing);
  });

  it("ignores a GET, so the SPA fallback is never shadowed by a stale read", () => {
    const routes = mountPlugin();

    expect(() => callRoute(routes, DEVTOOLS_API.usage, "GET")).toThrow(
      /No handler answered/,
    );
  });
});
