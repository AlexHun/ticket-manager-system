/**
 * Who a router refuses, asserted as a table (#367).
 *
 * Since #366 every route test runs the real guards, so a route mounted on the
 * wrong one can fail a unit test instead of only `demo-session.spec.ts`. This
 * is the table each router's test file fills in with its own requests:
 *
 * - `refusesAgentAndDemo` — an admin-only route (`requireAdmin`) answers 403 to
 *   an agent and to a demo visitor. Every admin write is one, and so is the
 *   demo usage figures' read, which belongs to no screen of its own.
 * - `screenReads` — a screen's reads, named by their `AdminScreen` (#368).
 *   Whether they are showcase reads (`requireAdminView`: 200 to a demo
 *   visitor, 403 to an agent) or admin only, like a write, is
 *   `DEMO_SEES_ADMIN_SCREEN`'s answer and not the file's, so the guard and the
 *   table disagreeing is red. Users and Outbox are the two it answers `false`.
 *
 * **The 403 is the guard's own `{ error: "Forbidden" }`, never just the
 * status.** A handler that refuses on its own (the assistant's row in
 * `routes/users`, self-approval in `routes/knowledge`) answers 403 too, with a
 * different message; asserting the body is what keeps a route that lost its
 * guard from passing on its handler's refusal. The requests carry an empty
 * body and ids that need not exist, for the reason the E2E spec gives: the
 * guard answers before the handler looks.
 *
 * **The callers are seeded inside each test, not in a `beforeEach`.** With a
 * `beforeEach` registered here, `tutorials.test.ts`'s demo rows answered 401
 * while its agent rows passed: the file's own `resetDb()` ran after this seed,
 * and only the agent came back, because the file seeds it again.
 * `skipDuplicates` lets the seed sit on top of whatever the file wrote.
 *
 * **An admin route is also asserted mounted on `requireAdmin` itself, by
 * reading the router**, because one wrong guard is invisible to every request.
 * `requireAdminView` on a write refuses an agent (no admin role) and a demo
 * (`mayUseAdminView` lets a demo send only `GET` and `HEAD`) — exactly what
 * `requireAdmin` answers, to every caller there is. Measured (#367): with each
 * of the 17 writes swapped to it, the behavioural rows stayed green; swapped to
 * `requireAuth`, all 20 admin routes went red on both rows. The route is read
 * the way `testing-api.md` says a query no response shows must be: by a check
 * on the thing itself, not a request pretending to see it. A showcase read is
 * read the same way, against `requireAdminView`.
 */
import { describe, expect, test } from "bun:test";
import type { Router } from "express";
import { DEMO_SEES_ADMIN_SCREEN, type AdminScreen } from "@ticket/shared";
import { requireAdmin, requireAdminView } from "../middleware/auth";
import { asCaller } from "./caller";
import { COLLEAGUE, type ColleagueKey } from "./fixtures";
import { prisma } from "./pg";
import type { serveRouter } from "./route-app";

type Url = ReturnType<typeof serveRouter>;

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** A request as `METHOD /path`, the path under the router's mount. */
export type Endpoint = `${Method} /${string}`;

/**
 * A showcase read, in one of three shapes, each named by its `route`:
 *
 * - the request itself, which answers a demo 200;
 * - `seed`, for a path that names a row: `GET /runs/:id` answers 404 for an id
 *   nobody wrote, so `seed` writes the row and returns the request;
 * - `unreachable`, for a handler no unit test can bring to 200, saying why.
 *   The demo is then asserted past the guard — neither 401 nor 403 — which is
 *   the half of the claim this suite can see.
 */
export type ShowcaseRead =
  | Endpoint
  | { route: Endpoint; seed: () => Promise<Endpoint> }
  | { route: Endpoint; unreachable: string };

const FORBIDDEN = { error: "Forbidden" };

function split(endpoint: Endpoint): [method: string, path: string] {
  const space = endpoint.indexOf(" ");
  return [endpoint.slice(0, space), endpoint.slice(space + 1)];
}

/**
 * The parts of Express 5's router stack this reads: `route.methods` and each
 * handler's `handle` are plain fields, and `match` is the layer's own test of
 * a path against its pattern — the one the router dispatches with.
 */
interface StackLayer {
  match(path: string): boolean;
  route?: {
    methods: Record<string, boolean | undefined>;
    stack: { handle: unknown }[];
  };
}

/** The first handler of the route `endpoint` dispatches to: its guard. */
function guardOf(router: Router, endpoint: Endpoint): unknown {
  const [method, path] = split(endpoint);
  const layer = (router.stack as unknown as StackLayer[]).find(
    (l) => l.route?.methods[method.toLowerCase()] && l.match(path),
  );
  return layer?.route?.stack[0]?.handle;
}

/** Send `endpoint` as `who`, with the two callers this table uses seeded. */
async function sendAs(
  url: Url,
  endpoint: Endpoint,
  who: Extract<ColleagueKey, "agent" | "demoVisitor">,
) {
  await prisma.user.createMany({
    data: [COLLEAGUE.agent, COLLEAGUE.demoVisitor],
    skipDuplicates: true,
  });
  const [method, path] = split(endpoint);
  const res = await fetch(url(path), {
    method,
    headers: { "content-type": "application/json", ...asCaller(who) },
    ...(method === "GET" ? {} : { body: "{}" }),
  });
  // Text first: an `unreachable` handler's throw is Express's HTML 500.
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: kept as text, which no 403 assertion will mistake for one.
  }
  return { status: res.status, body };
}

/**
 * Every one of `endpoints` answers the guard's 403 to an agent and a demo, and
 * is mounted on `requireAdmin` in `router`.
 */
export function refusesAgentAndDemo(
  url: Url,
  router: Router,
  endpoints: readonly Endpoint[],
) {
  describe("who it refuses — admin only", () => {
    test.each([...endpoints])("%s is mounted on requireAdmin", (endpoint) => {
      expect(guardOf(router, endpoint)).toBe(requireAdmin);
    });

    test.each(
      endpoints.flatMap((endpoint) =>
        (["agent", "demoVisitor"] as const).map(
          (who) => [endpoint, who] as const,
        ),
      ),
    )("%s answers 403 to %s", async (endpoint, who) => {
      expect(await sendAs(url, endpoint, who)).toEqual({
        status: 403,
        body: FORBIDDEN,
      });
    });
  });
}

/**
 * Every one of `reads` is a read of `screen`, guarded as
 * `DEMO_SEES_ADMIN_SCREEN` says it must be (#368): on a screen a demo sees, a
 * showcase read; on one it does not, admin only, like a write.
 *
 * This is where the API is checked against the table rather than derived from
 * it. The guard stays chosen where the route is mounted, and the two disagreeing
 * either way is red: a read left on `requireAdmin` under a `true`, or opened
 * with `requireAdminView` under a `false`.
 */
export function screenReads(
  url: Url,
  router: Router,
  screen: AdminScreen,
  reads: readonly ShowcaseRead[],
) {
  describe(`the ${screen} screen's reads, as DEMO_SEES_ADMIN_SCREEN says`, () => {
    if (DEMO_SEES_ADMIN_SCREEN[screen]) {
      opensToDemo(url, router, reads);
    } else {
      refusesAgentAndDemo(
        url,
        router,
        reads.map((read) => (typeof read === "string" ? read : read.route)),
      );
    }
  });
}

/**
 * Every one of `reads` answers 200 to a demo and the guard's 403 to an agent,
 * and is mounted on `requireAdminView` in `router`.
 */
function opensToDemo(url: Url, router: Router, reads: readonly ShowcaseRead[]) {
  describe("who it refuses — showcase reads", () => {
    // Each shape read once, into the three things a row needs.
    const rows = reads.map((read) =>
      typeof read === "string"
        ? { route: read, request: async () => read, reachable: true }
        : "seed" in read
          ? { route: read.route, request: read.seed, reachable: true }
          : {
              route: read.route,
              request: async () => read.route,
              reachable: false,
            },
    );

    test.each(rows)("$route is mounted on requireAdminView", (row) => {
      expect(guardOf(router, row.route)).toBe(requireAdminView);
    });

    test.each(rows)("$route opens to a demo visitor", async (row) => {
      const sent = await sendAs(url, await row.request(), "demoVisitor");

      if (row.reachable) {
        expect(sent.status).toBe(200);
      } else {
        expect([401, 403]).not.toContain(sent.status);
      }
    });

    test.each(rows)("$route answers 403 to an agent", async (row) => {
      expect(await sendAs(url, await row.request(), "agent")).toEqual({
        status: 403,
        body: FORBIDDEN,
      });
    });
  });
}
