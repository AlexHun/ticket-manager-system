/**
 * The dev-tools backend, as a Vite plugin.
 *
 * `apply: "serve"` is the whole security story: the plugin — and therefore the
 * project scan and the ability to spawn a test run — exists only while
 * `vite dev` is running. `vite build` never loads it, so there is no production
 * artefact to forget to disable. The pages that talk to it are behind
 * `import.meta.env.DEV`, which Rollup folds to `false` and eliminates.
 *
 * Middlewares are registered by returning nothing from `configureServer`, so
 * they install *ahead* of Vite's internals. That matters for one reason: the SPA
 * fallback would otherwise answer these paths with `index.html`.
 *
 * Note for anyone editing this file or its imports: they are dependencies of
 * `vite.config.ts`, so saving one restarts the dev server and reloads the page.
 * That is Vite's behaviour, not a bug — but it does mean an in-flight test run is
 * cancelled by editing the runner.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Connect, Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { scanProject } from "./scan";
import { findSuite, runSuite, suiteDescriptors, type RunHandle } from "./suites";
import {
  DEVTOOLS_API,
  type DevStreamMessage,
  type RunEvent,
} from "../src/dev/protocol";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `apps/web/dev` → the repo root. */
const REPO_ROOT = path.resolve(HERE, "../../..");

/**
 * Events retained per suite for replay.
 *
 * The cap is on the server as well as in the page because this is what a
 * reconnecting tab is handed: a failing Playwright run can print thousands of
 * lines, and replaying all of them into a freshly-loaded page is a stall you can
 * watch. The head is dropped — the tail holds the summary.
 */
const MAX_REPLAY_EVENTS = 4000;

interface StoredRun {
  events: RunEvent[];
  dropped: number;
  finished: boolean;
  handle: RunHandle | null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    // The graph describes the tree as it is right now; a cached copy is a lie
    // the moment a file is saved.
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Wraps a handler so it answers one method only, and never takes the dev server
 *  down on a throw. */
function only(
  method: "GET" | "POST",
  handler: (req: IncomingMessage, res: ServerResponse, url: URL) => void,
): Connect.NextHandleFunction {
  return (req, res, next) => {
    if (req.method !== method) {
      next();
      return;
    }
    try {
      handler(req, res, new URL(req.url ?? "/", "http://localhost"));
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

export function devToolsPlugin(): Plugin {
  /** Every run this dev server has done, by suite id. Kept after finishing so a
   *  reloaded page still shows the last result. */
  const runs = new Map<string, StoredRun>();
  /** Pages watching the stream. */
  const listeners = new Set<(message: DevStreamMessage) => void>();

  /**
   * At most one suite runs at a time, and the rest wait here.
   *
   * Not a nicety: the E2E suite binds 3002/4001 and resets the test database, and
   * two Vitest runs would fight over the same worker pool. The queue lives on the
   * server rather than in the page so that reloading — or closing — the tab does
   * not strand it.
   */
  let active: string | null = null;
  let queue: string[] = [];

  const broadcast = (message: DevStreamMessage): void => {
    for (const listener of listeners) listener(message);
  };

  const publishState = (): void => {
    broadcast({ kind: "state", active, queued: [...queue] });
  };

  const record = (suiteId: string, event: RunEvent): void => {
    const stored = runs.get(suiteId);
    if (!stored) return;
    stored.events.push(event);
    if (stored.events.length > MAX_REPLAY_EVENTS) {
      stored.dropped += stored.events.length - MAX_REPLAY_EVENTS;
      stored.events = stored.events.slice(-MAX_REPLAY_EVENTS);
    }
    broadcast({ kind: "run", suite: suiteId, event });
  };

  /** Declared before `startRun` so the two can call each other — a finished run
   *  drains the queue, and draining the queue starts a run. */
  const drain = (): void => {
    if (active !== null) return;
    const next = queue.shift();
    if (!next) {
      publishState();
      return;
    }
    startRun(next);
  };

  function startRun(suiteId: string): void {
    const suite = findSuite(suiteId);
    if (!suite) return;

    const stored: StoredRun = {
      events: [],
      dropped: 0,
      finished: false,
      handle: null,
    };
    runs.set(suiteId, stored);
    active = suiteId;
    publishState();

    stored.handle = runSuite(suite, REPO_ROOT, (event) => {
      record(suiteId, event);
      if (event.type !== "end") return;
      stored.finished = true;
      stored.handle = null;
      active = null;
      // Straight on to whatever is waiting. `drain` republishes the state, so a
      // watching page sees the handover as one update.
      drain();
    });
  }

  return {
    name: "ticket-devtools",
    apply: "serve",

    configureServer(server) {
      server.middlewares.use(
        DEVTOOLS_API.graph,
        only("GET", (_req, res) => sendJson(res, 200, scanProject(REPO_ROOT))),
      );

      server.middlewares.use(
        DEVTOOLS_API.suites,
        only("GET", (_req, res) => sendJson(res, 200, { suites: suiteDescriptors })),
      );

      server.middlewares.use(
        DEVTOOLS_API.events,
        only("GET", (req, res) => {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          });

          const send = (message: DevStreamMessage): void => {
            res.write(`data: ${JSON.stringify(message)}\n\n`);
          };

          // Backlog first, then live. Both happen in this one tick, so no event
          // can slip between the replay and the subscription.
          for (const [suiteId, stored] of runs) {
            if (stored.dropped > 0) {
              send({
                kind: "run",
                suite: suiteId,
                event: {
                  type: "line",
                  text: `… ${stored.dropped} earlier lines are no longer held by the dev server`,
                  stream: "out",
                },
              });
            }
            for (const event of stored.events) {
              send({ kind: "run", suite: suiteId, event });
            }
          }
          send({ kind: "state", active, queued: [...queue] });

          listeners.add(send);
          req.on("close", () => {
            listeners.delete(send);
          });
        }),
      );

      server.middlewares.use(
        DEVTOOLS_API.start,
        only("POST", (_req, res, url) => {
          // Comma-separated so "run everything" is one request and the queue is
          // never half-built.
          const requested = (url.searchParams.get("suites") ?? "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean);

          const unknown = requested.filter((id) => !findSuite(id));
          if (requested.length === 0 || unknown.length > 0) {
            sendJson(res, 400, {
              error: unknown.length > 0 ? `No such suite: ${unknown.join(", ")}` : "No suites given",
            });
            return;
          }

          // Whatever is already running stays running; the rest replaces the
          // queue, so pressing "run all" twice does not queue six suites.
          queue = requested.filter((id) => id !== active);
          drain();
          sendJson(res, 200, { active, queued: queue });
        }),
      );

      server.middlewares.use(
        DEVTOOLS_API.cancel,
        only("POST", (_req, res) => {
          queue = [];
          const stored = active ? runs.get(active) : null;
          // `cancel` emits the terminal `end` itself, which is what moves the
          // page's state — nothing here has to fake one.
          stored?.handle?.cancel();
          if (!stored?.handle) publishState();
          sendJson(res, 200, { cancelled: active });
        }),
      );

      server.middlewares.use(
        DEVTOOLS_API.clear,
        only("POST", (_req, res, url) => {
          const id = url.searchParams.get("suite") ?? "";
          if (id === active) {
            sendJson(res, 409, { error: "That suite is still running." });
            return;
          }
          runs.delete(id);
          // No event for this: the page drops its own copy optimistically, and a
          // second tab picks up the change on its next connect.
          sendJson(res, 200, { cleared: id });
        }),
      );

      // A dev-server restart (editing this file, or vite.config.ts) must not
      // leave a Playwright run holding ports 3002 and 4001.
      server.httpServer?.once("close", () => {
        queue = [];
        for (const stored of runs.values()) stored.handle?.cancel();
      });

      // Printed plainly rather than dressed up in Vite's colours: this is the
      // only hint the two pages exist, so it should survive a piped log.
      server.config.logger.info("  dev tools:  /__dev/map  /__dev/tests");
    },
  };
}
