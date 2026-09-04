import { matchPath } from "react-router-dom";
import { vi, type Mock } from "vitest";
import type { TutorialPageKey, TutorialStatusResponse } from "@ticket/shared";

/**
 * The shared HTTP stub: one place that knows how a request reaches a response,
 * so a test only has to say what each path answers.
 *
 * It stands in for `@/lib/api` wholesale, which is why the module exports `api`
 * alongside `apiStub` — the whole install is one line in a test file, and the
 * dynamic import inside it dodges `vi.mock`'s hoisting entirely:
 *
 * ```ts
 * vi.mock("@/lib/api", () => import("@/test/api-stub"));
 *
 * const ticketsGet = apiStub.get("/api/tickets");
 * beforeEach(() => apiStub.reset());
 * ```
 *
 * `apiStub.get(path)` hands back a plain `vi.fn` scoped to that method and
 * path, so every mock ergonomic a test already reaches for still applies —
 * `mockResolvedValue`, `mockResolvedValueOnce`, `mockRejectedValue`,
 * `mockReturnValue(new Promise(() => {}))` for a request that never settles —
 * and so does every assertion: `toHaveBeenCalledTimes`, `mock.calls[n]`. What
 * changes is that those counts and indices are now per path. The filtering the
 * old hand-rolled routers needed (`calls.filter(([url]) => url === …)`,
 * so a second endpoint's calls could not shift the first's indices) has no
 * subject any more.
 *
 * `path` may be a literal or a react-router pattern (`/api/tickets/:id`);
 * matching is exact-literal first, then patterns, and the query string is not
 * part of it — axios is handed `params` separately. A request that matches
 * nothing throws by name rather than resolving `undefined`, which is the
 * failure the old `mockGet`-catches-everything shape used to produce.
 */

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/** Axios-shaped: the URL first, then whatever config the caller passed. */
type Responder = Mock<(url: string, ...rest: unknown[]) => unknown>;

interface Route {
  method: HttpMethod;
  /** A literal path, or a react-router pattern like `/api/tickets/:id`. */
  path: string;
  responder: Responder;
}

const routes = new Map<string, Route>();

function keyOf(method: HttpMethod, path: string): string {
  return `${method} ${path}`;
}

function pathOf(url: string): string {
  return url.split("?")[0];
}

function isPattern(path: string): boolean {
  return path.includes(":") || path.includes("*");
}

/**
 * The responder for one method and path, created on first ask.
 *
 * Its starting implementation throws, and that is what `reset()` restores:
 * Vitest's `mockReset` puts back the function `vi.fn` was constructed with, so
 * a test that renders a page without saying what an endpoint answers fails
 * saying so, instead of feeding `undefined` into a query and failing four
 * assertions later on a missing row.
 */
function routeFor(method: HttpMethod, path: string): Responder {
  const existing = routes.get(keyOf(method, path));
  if (existing) return existing.responder;

  const responder: Responder = vi.fn(() => {
    throw new Error(
      `${method.toUpperCase()} ${path} was requested, but this test registered no response for it.`,
    );
  });
  routes.set(keyOf(method, path), { method, path, responder });
  return responder;
}

/** Registers a response that survives `reset()` — see the tutorial pair below. */
function defineDefault(
  method: HttpMethod,
  path: string,
  respond: (url: string, ...rest: unknown[]) => unknown,
): void {
  routes.set(keyOf(method, path), { method, path, responder: vi.fn(respond) });
}

function match(method: HttpMethod, url: string): Route | undefined {
  const path = pathOf(url);

  const literal = routes.get(keyOf(method, path));
  if (literal) return literal;

  for (const route of routes.values()) {
    if (route.method !== method || !isPattern(route.path)) continue;
    if (matchPath({ path: route.path, end: true }, path)) return route;
  }
  return undefined;
}

function dispatch(method: HttpMethod, url: string, rest: unknown[]): unknown {
  const route = match(method, url);
  if (!route) {
    throw new Error(
      `Unexpected ${method.toUpperCase()} ${url} — register it with apiStub.${method}("${pathOf(url)}").`,
    );
  }
  return route.responder(url, ...rest);
}

const TUTORIAL_STATUS_PATH = "/api/tutorials/:pageKey";
const TUTORIAL_SEEN_PATH = "/api/tutorials/:pageKey/seen";

/**
 * "Nothing to show", for every page's `<Tutorial>`.
 *
 * All eight main pages mount one, so before this every page test carried the
 * same `url.startsWith("/api/tutorials/")` branch and the same never-asserted
 * fake behind it — a callout no test exercised, answered by hand in four files
 * at once. Answering it here is what lets a page test declare only the
 * endpoints it is actually about.
 *
 * A test that *is* about the tutorial overrides this like any other response;
 * `reset()` puts it back.
 */
function tutorialStatus(url: string): Promise<{ data: TutorialStatusResponse }> {
  const pageKey = matchPath({ path: TUTORIAL_STATUS_PATH, end: true }, pathOf(url))
    ?.params.pageKey as TutorialPageKey;

  return Promise.resolve({
    data: {
      tutorial: {
        content: {
          pageKey,
          title: "",
          steps: [],
          updatedAt: null,
          updatedByName: null,
        },
        shouldShow: false,
      },
    },
  });
}

defineDefault("get", TUTORIAL_STATUS_PATH, tutorialStatus);
defineDefault("post", TUTORIAL_SEEN_PATH, () => Promise.resolve({ data: {} }));

/**
 * Declare what a path answers, and read back what it was called with.
 *
 * Each accessor returns the same `vi.fn` for the life of the file, so a test
 * file can name its endpoints once at the top and `reset()` between tests
 * without the handles going stale.
 */
export const apiStub = {
  get: (path: string): Responder => routeFor("get", path),
  post: (path: string): Responder => routeFor("post", path),
  put: (path: string): Responder => routeFor("put", path),
  patch: (path: string): Responder => routeFor("patch", path),
  delete: (path: string): Responder => routeFor("delete", path),

  /** Clears every recorded call and restores every default. */
  reset(): void {
    for (const route of routes.values()) route.responder.mockReset();
  },
};

/** The stand-in for the axios instance in `@/lib/api`. */
export const api = {
  get: (url: string, ...rest: unknown[]) => dispatch("get", url, rest),
  post: (url: string, ...rest: unknown[]) => dispatch("post", url, rest),
  put: (url: string, ...rest: unknown[]) => dispatch("put", url, rest),
  patch: (url: string, ...rest: unknown[]) => dispatch("patch", url, rest),
  delete: (url: string, ...rest: unknown[]) => dispatch("delete", url, rest),
};
