/**
 * Unit tests for `apps/api/src/routes/dashboard-layout.ts`.
 *
 * The router only, on a real Express app over a real socket — and, since #169,
 * over a real database: `../db` is still replaced, but what it is replaced
 * *with* is a genuine Prisma client on a genuine Postgres running inside this
 * process (`../test/pg`, ADR-0014). The hand-written `dashboardLayout` fake
 * that used to live here is gone, so "reset deletes rather than overwrites"
 * and "two users never collide" are now answered by the table's primary key
 * and by `deleteMany`'s own `where`, not by a `filter` in this file.
 *
 * `panels` is a `Json` column, which is the part the old fake was least able
 * to speak for: it stored whatever object it was handed and gave it straight
 * back. What a `PUT` writes now makes a round trip through Postgres' `jsonb`
 * before a `GET` reads it, so the response really is the stored layout.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import express from "express";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  type DashboardLayoutResponse,
  type DashboardPanelPlacement,
} from "@ticket/shared";
import { Prisma, prisma, resetDb } from "../test/pg";
import { COLLEAGUE, seedColleagues } from "../test/fixtures";

/* ── The world behind the router ─────────────────────────────────────────── */

mock.module("../db", () => ({ Prisma, prisma }));

const fakeGuard = (req: Request, res: Response, next: NextFunction) => {
  res.locals.session = {
    user: {
      id: req.header("x-test-user") ?? "agent-1",
      name: req.header("x-test-agent-name") ?? "Aaron Agent",
      email: req.header("x-test-user-email") ?? "agent@example.com",
    },
    session: { id: req.header("x-test-session") ?? "sess-1" },
  };
  next();
};

mock.module("../middleware/auth", () => ({
  requireAuth: fakeGuard,
  requireAdmin: fakeGuard,
  sessionOf: (res: Response) => res.locals.session,
}));

const { dashboardLayoutRouter } = await import("./dashboard-layout");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const AGENT = { "x-test-user": COLLEAGUE.agent.id };
const OTHER_AGENT = { "x-test-user": COLLEAGUE.other.id };

const REVERSED_LAYOUT = [...DEFAULT_DASHBOARD_LAYOUT].reverse();

/** `DashboardLayout.userId` is a foreign key, so the caller has to be a real
 *  colleague — itself something the old fake could not have told us. */
beforeEach(async () => {
  await resetDb();
  await seedColleagues("agent", "other");
});

/**
 * Read the saved rows back, one per user who has customized.
 *
 * `panels` comes off a `Json` column as `Prisma.JsonValue`; narrowing it here
 * is the same cast the route itself makes on the way out, and it is what lets
 * a test compare against a `DashboardPanelPlacement[]` rather than an `any`.
 */
async function savedLayouts(): Promise<
  { userId: string; panels: DashboardPanelPlacement[] }[]
> {
  const rows = await prisma.dashboardLayout.findMany({
    select: { userId: true, panels: true },
    orderBy: { userId: "asc" },
  });
  return rows.map((row) => ({
    userId: row.userId,
    panels: row.panels as unknown as DashboardPanelPlacement[],
  }));
}

/* ── The app ─────────────────────────────────────────────────────────────── */

let server: Server;
let origin: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/dashboard-layout", dashboardLayoutRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

interface Sent<T> {
  status: number;
  body: T & { error?: string };
}

async function get<T>(
  headers: Record<string, string> = AGENT,
): Promise<Sent<T>> {
  const res = await fetch(`${origin}/api/dashboard-layout`, { headers });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

async function put<T>(
  body: unknown,
  headers: Record<string, string> = AGENT,
): Promise<Sent<T>> {
  const res = await fetch(`${origin}/api/dashboard-layout`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

async function del<T>(
  headers: Record<string, string> = AGENT,
): Promise<Sent<T>> {
  const res = await fetch(`${origin}/api/dashboard-layout`, {
    method: "DELETE",
    headers,
  });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

/* ── GET / ───────────────────────────────────────────────────────────────── */

describe("GET /api/dashboard-layout", () => {
  test("a user with no saved layout gets the default, flagged as such", async () => {
    const sent = await get<DashboardLayoutResponse>();

    expect(sent.status).toBe(200);
    expect(sent.body.layout).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect(sent.body.isDefault).toBe(true);
  });

  test("a saved layout is returned instead, not flagged as default", async () => {
    await put({ layout: REVERSED_LAYOUT });

    const sent = await get<DashboardLayoutResponse>();

    expect(sent.body.layout).toEqual(REVERSED_LAYOUT);
    expect(sent.body.isDefault).toBe(false);
  });

  test("the layout survives the jsonb round trip, order included", async () => {
    // Not assertable against the old fake, which handed back the very object
    // it had been given. `panels` is a `Json` column, so what a `GET` reads is
    // what Postgres stored — array order and every field of every panel.
    await put({ layout: REVERSED_LAYOUT });

    expect(await savedLayouts()).toEqual([
      { userId: "u_agent", panels: REVERSED_LAYOUT },
    ]);
  });

  test("two users hold independent layouts", async () => {
    await put({ layout: REVERSED_LAYOUT }, AGENT);

    const other = await get<DashboardLayoutResponse>(OTHER_AGENT);

    expect(other.body.layout).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect(other.body.isDefault).toBe(true);
  });
});

/* ── PUT / ───────────────────────────────────────────────────────────────── */

describe("PUT /api/dashboard-layout", () => {
  test("saves a reordered/resized layout", async () => {
    const layout = DEFAULT_DASHBOARD_LAYOUT.map((p, i) =>
      i === 0 ? { ...p, width: "narrow" as const } : p,
    );

    const sent = await put<DashboardLayoutResponse>({ layout });

    expect(sent.status).toBe(200);
    expect(sent.body.layout).toEqual(layout);
    expect(sent.body.isDefault).toBe(false);
  });

  test("rejects a layout missing a panel", async () => {
    const sent = await put({
      layout: DEFAULT_DASHBOARD_LAYOUT.slice(1),
    });

    expect(sent.status).toBe(400);
    expect(await savedLayouts()).toEqual([]);
  });

  test("rejects a layout with a duplicated panel", async () => {
    const layout = [
      ...DEFAULT_DASHBOARD_LAYOUT.slice(1),
      DEFAULT_DASHBOARD_LAYOUT[1]!,
    ];

    const sent = await put({ layout });

    expect(sent.status).toBe(400);
  });

  test("rejects a layout naming an unknown panel", async () => {
    const layout = DEFAULT_DASHBOARD_LAYOUT.map((p, i) =>
      i === 0 ? { ...p, panelId: "notARealPanel" } : p,
    );

    const sent = await put({ layout });

    expect(sent.status).toBe(400);
  });

  test("rejects a width outside the 4 options", async () => {
    const layout = DEFAULT_DASHBOARD_LAYOUT.map((p, i) =>
      i === 0 ? { ...p, width: "huge" } : p,
    );

    const sent = await put({ layout });

    expect(sent.status).toBe(400);
  });

  test("overwrites a previous save for the same user", async () => {
    // `userId` is the table's primary key, so a second save cannot land beside
    // the first one — that is now the constraint, not this file, refusing it.
    await put({ layout: REVERSED_LAYOUT });
    await put({ layout: DEFAULT_DASHBOARD_LAYOUT });

    expect(await savedLayouts()).toEqual([
      { userId: "u_agent", panels: DEFAULT_DASHBOARD_LAYOUT },
    ]);
  });
});

/* ── DELETE / ────────────────────────────────────────────────────────────── */

describe("DELETE /api/dashboard-layout", () => {
  test("resets a customized layout back to default", async () => {
    await put({ layout: REVERSED_LAYOUT });

    const sent = await del<DashboardLayoutResponse>();

    expect(sent.status).toBe(200);
    expect(sent.body.layout).toEqual(DEFAULT_DASHBOARD_LAYOUT);
    expect(sent.body.isDefault).toBe(true);
    expect(await savedLayouts()).toEqual([]);
  });

  test("is a no-op for a user who never customized", async () => {
    const sent = await del<DashboardLayoutResponse>();

    expect(sent.status).toBe(200);
    expect(sent.body.isDefault).toBe(true);
  });

  test("only clears the caller's own row", async () => {
    await put({ layout: REVERSED_LAYOUT }, AGENT);
    await put({ layout: REVERSED_LAYOUT }, OTHER_AGENT);

    await del(AGENT);

    const other = await get<DashboardLayoutResponse>(OTHER_AGENT);
    expect(other.body.isDefault).toBe(false);
    const left = (await savedLayouts()).map((row) => row.userId);
    expect(left).toEqual([COLLEAGUE.other.id]);
  });
});
