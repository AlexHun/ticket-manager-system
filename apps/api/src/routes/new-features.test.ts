/**
 * Unit tests for `apps/api/src/routes/new-features.ts`.
 *
 * The router only, on a real Express app over a real socket, with the
 * database replaced by a small in-memory table — same shape as
 * `tutorials.test.ts` (see `testing.md`). The `../middleware/auth` stub is
 * deliberately identical to theirs, for the reason explained in that file's
 * header: `mock.module` registrations are process-wide, and a stub that
 * disagreed about where the identity comes from would make one file's tests
 * pass alone and fail in the suite.
 *
 * What's worth pinning down without a real database: no row reads as "should
 * show", the version comparison, that marking a key seen actually stops it
 * from showing again, that it's per user, and that an unknown key 404s
 * instead of silently upserting garbage.
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
import { NEW_FEATURE_KEYS, type NewFeatureStatusResponse } from "@ticket/shared";

/* ── The world behind the router ─────────────────────────────────────────── */

interface SeenRow {
  userId: string;
  featureKey: string;
  seenVersion: number;
  seenAt: Date;
}

let seen: SeenRow[];

const NOW = new Date("2026-08-29T12:00:00.000Z");

const seenFindMany = mock(
  (args: { where: { userId: string; featureKey: { in: string[] } } }) =>
    Promise.resolve(
      seen.filter(
        (row) =>
          row.userId === args.where.userId &&
          args.where.featureKey.in.includes(row.featureKey),
      ),
    ),
);

const seenUpsert = mock(
  (args: {
    where: { userId_featureKey: { userId: string; featureKey: string } };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => {
    const { userId, featureKey } = args.where.userId_featureKey;
    const idx = seen.findIndex(
      (row) => row.userId === userId && row.featureKey === featureKey,
    );
    if (idx === -1) {
      const row: SeenRow = {
        userId,
        featureKey,
        seenVersion: args.create.seenVersion as number,
        seenAt: NOW,
      };
      seen.push(row);
      return Promise.resolve(row);
    }
    const updated: SeenRow = { ...seen[idx]!, ...args.update } as SeenRow;
    seen[idx] = updated;
    return Promise.resolve(updated);
  },
);

mock.module("../db", () => ({
  prisma: {
    newFeatureSeen: {
      findMany: seenFindMany,
      upsert: seenUpsert,
    },
  },
}));

/** Deliberately identical to `tutorials.test.ts` — see this file's header. */
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

const { newFeaturesRouter } = await import("./new-features");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const AGENT = {
  "x-test-user": "u_agent",
  "x-test-agent-name": "Aaron Agent",
  "x-test-user-email": "agent@example.com",
};

const ADMIN = {
  "x-test-user": "u_admin",
  "x-test-agent-name": "Ada Admin",
  "x-test-user-email": "ada@example.com",
};

const KEY = NEW_FEATURE_KEYS[0];

beforeEach(() => {
  seen = [];
  seenFindMany.mockClear();
  seenUpsert.mockClear();
});

/* ── The app ─────────────────────────────────────────────────────────────── */

let server: Server;
let origin: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/new-features", newFeaturesRouter);
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
  path: string,
  headers: Record<string, string> = AGENT,
): Promise<Sent<T>> {
  const res = await fetch(`${origin}/api/new-features${path}`, { headers });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

async function post<T>(
  path: string,
  headers: Record<string, string> = AGENT,
): Promise<Sent<T>> {
  const res = await fetch(`${origin}/api/new-features${path}`, {
    method: "POST",
    headers,
  });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

/* ── GET /status ─────────────────────────────────────────────────────────── */

describe("GET /api/new-features/status", () => {
  test("a key nobody has seen shows", async () => {
    const sent = await get<NewFeatureStatusResponse>("/status");

    expect(sent.status).toBe(200);
    expect(sent.body.statuses[KEY]).toBe(true);
  });

  test("does not show once marked seen at the current version", async () => {
    await post(`/${KEY}/seen`);

    const sent = await get<NewFeatureStatusResponse>("/status");

    expect(sent.body.statuses[KEY]).toBe(false);
  });

  test("shows again for a seen row behind the current version", async () => {
    seen.push({ userId: "u_agent", featureKey: KEY, seenVersion: 0, seenAt: NOW });

    const sent = await get<NewFeatureStatusResponse>("/status");

    expect(sent.body.statuses[KEY]).toBe(true);
  });

  test("is per user: one agent's seen mark doesn't hide it from another", async () => {
    await post(`/${KEY}/seen`, AGENT);

    const sent = await get<NewFeatureStatusResponse>("/status", ADMIN);

    expect(sent.body.statuses[KEY]).toBe(true);
  });

  test("returns a status for every known key", async () => {
    const sent = await get<NewFeatureStatusResponse>("/status");

    expect(Object.keys(sent.body.statuses).sort()).toEqual(
      [...NEW_FEATURE_KEYS].sort(),
    );
  });
});

/* ── POST /:featureKey/seen ──────────────────────────────────────────────── */

describe("POST /api/new-features/:featureKey/seen", () => {
  test("creates a seen row on first interaction", async () => {
    const sent = await post(`/${KEY}/seen`);

    expect(sent.status).toBe(200);
    expect(seen).toContainEqual(
      expect.objectContaining({ userId: "u_agent", featureKey: KEY }),
    );
  });

  test("404s an unknown feature key", async () => {
    const sent = await post("/not-a-real-key/seen");
    expect(sent.status).toBe(404);
    expect(seen).toHaveLength(0);
  });
});
