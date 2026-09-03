/**
 * Unit tests for `apps/api/src/routes/dashboard-layout.ts`.
 *
 * The router only, on a real Express app over a real socket, with the
 * database replaced by a small in-memory table — same shape as
 * `tutorials.test.ts` and `new-features.test.ts` (see `testing.md`). What's
 * worth pinning down without a real database: the "missing row reads as
 * default" fallback, that a write is revalidated against the current panel
 * set, that two users' layouts never collide, and that reset deletes rather
 * than overwrites.
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
} from "@ticket/shared";

/* ── The world behind the router ─────────────────────────────────────────── */

interface LayoutRow {
  userId: string;
  panels: unknown;
  updatedAt: Date;
}

let layouts: LayoutRow[];

const NOW = new Date("2026-08-29T12:00:00.000Z");

const layoutFindUnique = mock((args: { where: { userId: string } }) =>
  Promise.resolve(
    layouts.find((l) => l.userId === args.where.userId) ?? null,
  ),
);

const layoutUpsert = mock(
  (args: {
    where: { userId: string };
    create: { userId: string; panels: unknown };
    update: { panels: unknown };
  }) => {
    const idx = layouts.findIndex((l) => l.userId === args.where.userId);
    if (idx === -1) {
      const row: LayoutRow = {
        userId: args.create.userId,
        panels: args.create.panels,
        updatedAt: NOW,
      };
      layouts.push(row);
      return Promise.resolve(row);
    }
    const updated: LayoutRow = {
      ...layouts[idx]!,
      panels: args.update.panels,
      updatedAt: NOW,
    };
    layouts[idx] = updated;
    return Promise.resolve(updated);
  },
);

const layoutDeleteMany = mock((args: { where: { userId: string } }) => {
  const before = layouts.length;
  layouts = layouts.filter((l) => l.userId !== args.where.userId);
  return Promise.resolve({ count: before - layouts.length });
});

// `Prisma` is included even though nothing in this file calls `Prisma.sql` —
// see the note above `users.test.ts`'s own `mock.module("../db", …)`. Every
// factory for this specifier has to carry it: `routes/activity.ts`,
// `ticket-stats.ts` and `ticket-effectiveness.ts` import it as a *value*, and
// a factory that leaves it out can be the one in force when one of those is
// linked, which fails the run with `SyntaxError: Export named 'Prisma' not
// found in module .../src/db.ts` — intermittently, since it depends on the
// order `bun test` reaches the files in.
const { Prisma } = await import("../generated/prisma/client");

mock.module("../db", () => ({
  Prisma,
  prisma: {
    dashboardLayout: {
      findUnique: layoutFindUnique,
      upsert: layoutUpsert,
      deleteMany: layoutDeleteMany,
    },
  },
}));

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

const AGENT = { "x-test-user": "u_agent" };
const OTHER_AGENT = { "x-test-user": "u_other" };

const REVERSED_LAYOUT = [...DEFAULT_DASHBOARD_LAYOUT].reverse();

beforeEach(() => {
  layouts = [];
  layoutFindUnique.mockClear();
  layoutUpsert.mockClear();
  layoutDeleteMany.mockClear();
});

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
    expect(layouts).toHaveLength(0);
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
    await put({ layout: REVERSED_LAYOUT });
    await put({ layout: DEFAULT_DASHBOARD_LAYOUT });

    expect(layouts).toHaveLength(1);
    expect(layouts[0]?.panels).toEqual(DEFAULT_DASHBOARD_LAYOUT);
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
    expect(layouts).toHaveLength(0);
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
  });
});
