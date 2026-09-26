/**
 * Unit tests for `./demo-usage` — the admin's weekly demo figures on the wire
 * (#327, PRD R14). The counting itself is `../demo/usage.test.ts`'s; this is
 * the shape the Users page reads.
 *
 * The `../middleware/auth` stub is deliberately identical to
 * `new-features.test.ts`'s: `mock.module` registrations are process-wide. It
 * lets everyone through, so that `requireAdmin` refuses a demo session is held
 * by `tests/e2e/demo-session.spec.ts`, against the real guard.
 */

import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { DemoUsageResponse } from "@ticket/shared";
import { resetDb } from "../test/pg";
import { serveRouter } from "../test/route-app";

/** Deliberately identical to `new-features.test.ts` — see this file's header. */
const fakeGuard = (req: Request, res: Response, next: NextFunction) => {
  res.locals.session = {
    user: {
      id: req.header("x-test-user") ?? "agent-1",
      name: req.header("x-test-agent-name") ?? "Aaron Agent",
      email: req.header("x-test-user-email") ?? "agent@example.com",
      isAnonymous: req.header("x-test-demo") === "true",
    },
    session: { id: req.header("x-test-session") ?? "sess-1" },
  };
  next();
};

mock.module("../middleware/auth", () => ({
  requireAuth: fakeGuard,
  requireAdmin: fakeGuard,
  requireAdminView: fakeGuard,
  sessionOf: (res: Response) => res.locals.session,
}));

const { markDemoTicketOpened, recordDemoStart } = await import("../demo/usage");
const { demoUsageRouter } = await import("./demo-usage");

const url = serveRouter("/api/demo/usage", demoUsageRouter);

beforeEach(async () => {
  await resetDb();
});

describe("GET /api/demo/usage", () => {
  test("answers this week's two figures and the Monday they count from", async () => {
    await recordDemoStart("visitor-a", new Date());
    await recordDemoStart("visitor-b", new Date());
    await markDemoTicketOpened("visitor-b");

    const res = await fetch(url("/"));
    const body = (await res.json()) as DemoUsageResponse;

    expect(res.status).toBe(200);
    expect({ started: body.started, openedTicket: body.openedTicket }).toEqual({
      started: 2,
      openedTicket: 1,
    });
    const monday = new Date(body.weekStartsAt);
    expect(monday.getUTCDay()).toBe(1);
    expect(monday.toISOString().endsWith("T00:00:00.000Z")).toBe(true);
    expect(monday.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
