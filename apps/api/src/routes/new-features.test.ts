/**
 * Unit tests for `apps/api/src/routes/new-features.ts`.
 *
 * The router only, on a real Express app over a real socket — and, since #169,
 * over a real database: `../db` is still replaced, but what it is replaced
 * *with* is a genuine Prisma client on a genuine Postgres running inside this
 * process (`../test/pg`, ADR-0014). The hand-written `newFeatureSeen` fake
 * that used to live here is gone, so the `featureKey: { in: … }` filter and
 * the `@@unique([userId, featureKey])` behind the upsert are Postgres' own
 * answers rather than a `filter`/`findIndex` written above the assertions.
 *
 * The `../middleware/auth` stub is deliberately identical to
 * `tutorials.test.ts`'s, for the reason explained in that file's header:
 * `mock.module` registrations are process-wide, and a stub that disagreed
 * about where the identity comes from would make one file's tests pass alone
 * and fail in the suite.
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
  NEW_FEATURE_KEYS,
  NEW_FEATURE_VERSIONS,
  type NewFeatureStatusResponse,
} from "@ticket/shared";
import { Prisma, prisma, resetDb } from "../test/pg";

/* ── The world behind the router ─────────────────────────────────────────── */

const NOW = new Date("2026-08-29T12:00:00.000Z");

mock.module("../db", () => ({ Prisma, prisma }));

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
const CURRENT_VERSION = NEW_FEATURE_VERSIONS[KEY];

/** `NewFeatureSeen.userId` is a foreign key, so the caller has to be a real
 *  colleague — which is itself something the old fake could not have told us. */
beforeEach(async () => {
  await resetDb();
  await prisma.user.createMany({
    data: [
      {
        id: "u_agent",
        name: "Aaron Agent",
        email: "agent@example.com",
        emailVerified: true,
      },
      {
        id: "u_admin",
        name: "Ada Admin",
        email: "ada@example.com",
        emailVerified: true,
      },
    ],
  });
});

/** Insert a seen mark directly, for the "already behind" cases. */
function markSeenAt(userId: string, featureKey: string, seenVersion: number) {
  return prisma.newFeatureSeen.create({
    data: { userId, featureKey, seenVersion, seenAt: NOW },
  });
}

/** Read the marks back out of the table, ignoring the autoincrement id. */
function seenRows() {
  return prisma.newFeatureSeen.findMany({
    select: { userId: true, featureKey: true, seenVersion: true },
    orderBy: [{ userId: "asc" }, { featureKey: "asc" }],
  });
}

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
    await markSeenAt("u_agent", KEY, 0);

    const sent = await get<NewFeatureStatusResponse>("/status");

    expect(sent.body.statuses[KEY]).toBe(true);
  });

  test("is per user: one agent's seen mark doesn't hide it from another", async () => {
    await post(`/${KEY}/seen`, AGENT);

    const sent = await get<NewFeatureStatusResponse>("/status", ADMIN);

    expect(sent.body.statuses[KEY]).toBe(true);
  });

  test("a row for a key that has aged out of the registry is inert", async () => {
    // `featureKey` is a plain String, not a Postgres enum, precisely so that
    // retiring a key leaves its rows behind harmlessly. The route's
    // `featureKey: { in: NEW_FEATURE_KEYS }` is what keeps them out of the
    // answer, and that is now Postgres applying the filter, not this file.
    await markSeenAt("u_agent", "aRetiredKey", 99);

    const sent = await get<NewFeatureStatusResponse>("/status");

    expect(Object.keys(sent.body.statuses)).not.toContain("aRetiredKey");
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
    expect(await seenRows()).toEqual([
      { userId: "u_agent", featureKey: KEY, seenVersion: CURRENT_VERSION },
    ]);
  });

  test("updates rather than duplicates on a second interaction", async () => {
    // `@@unique([userId, featureKey])` is what makes this an update, and it is
    // now the constraint deciding rather than a `findIndex` in this file.
    await markSeenAt("u_agent", KEY, 0);

    await post(`/${KEY}/seen`);

    expect(await seenRows()).toEqual([
      { userId: "u_agent", featureKey: KEY, seenVersion: CURRENT_VERSION },
    ]);
  });

  test("404s an unknown feature key", async () => {
    const sent = await post("/not-a-real-key/seen");
    expect(sent.status).toBe(404);
    expect(await seenRows()).toEqual([]);
  });
});
