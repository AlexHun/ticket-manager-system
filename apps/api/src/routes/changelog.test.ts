/**
 * Unit tests for `apps/api/src/routes/changelog.ts`.
 *
 * The router only, on a real Express app over a real socket — and, since #169,
 * over a real database: `../db` is still replaced, but what it is replaced
 * *with* is a genuine Prisma client on a genuine Postgres running inside this
 * process (`../test/pg`, ADR-0014). The hand-written `changelogSeen` fake that
 * used to live here is gone, so "marking seen stops it showing again" is now
 * the route's own `upsert` against the table's primary key rather than a
 * `findIndex` written twenty lines above the assertion.
 *
 * `@ticket/shared` is still mocked, and deliberately: pinning
 * `CHANGELOG_LATEST_VERSION` to a known value is not a database concern, and
 * the version comparison is the whole subject of half this file. Everything
 * else is spread from the real module (`...actual`) so no other test file
 * sharing this process sees anything different from the genuine package.
 *
 * The `../middleware/auth` stub is deliberately identical to
 * `new-features.test.ts`'s, for the reason explained there: `mock.module`
 * registrations are process-wide.
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
import type { ChangelogStatusResponse } from "@ticket/shared";
import { Prisma, prisma, resetDb } from "../test/pg";

/* ── The world behind the router ─────────────────────────────────────────── */

const LATEST_VERSION = "0.5.10";

const NOW = new Date("2026-08-29T12:00:00.000Z");

mock.module("../db", () => ({ Prisma, prisma }));

const actualShared = await import("@ticket/shared");
mock.module("@ticket/shared", () => ({
  ...actualShared,
  CHANGELOG_LATEST_VERSION: LATEST_VERSION,
}));

/** Deliberately identical to `new-features.test.ts` — see this file's header. */
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

const { changelogRouter } = await import("./changelog");

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

/** `ChangelogSeen.userId` is a foreign key, so the caller has to be a real
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
function markSeenAt(userId: string, seenVersion: string) {
  return prisma.changelogSeen.create({
    data: { userId, seenVersion, seenAt: NOW },
  });
}

/** Read the marks back out of the table, one row per user. */
function seenRows() {
  return prisma.changelogSeen.findMany({
    select: { userId: true, seenVersion: true },
    orderBy: { userId: "asc" },
  });
}

/* ── The app ─────────────────────────────────────────────────────────────── */

let server: Server;
let origin: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/changelog", changelogRouter);
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
  const res = await fetch(`${origin}/api/changelog${path}`, { headers });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

async function post<T>(
  path: string,
  headers: Record<string, string> = AGENT,
): Promise<Sent<T>> {
  const res = await fetch(`${origin}/api/changelog${path}`, {
    method: "POST",
    headers,
  });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

/* ── GET /status ─────────────────────────────────────────────────────────── */

describe("GET /api/changelog/status", () => {
  test("shows when nobody has seen anything yet", async () => {
    const sent = await get<ChangelogStatusResponse>("/status");

    expect(sent.status).toBe(200);
    expect(sent.body.shouldShow).toBe(true);
  });

  test("does not show once marked seen at the latest version", async () => {
    await post("/seen");

    const sent = await get<ChangelogStatusResponse>("/status");

    expect(sent.body.shouldShow).toBe(false);
  });

  test("shows again for a seen row behind the latest version", async () => {
    await markSeenAt("u_agent", "0.4.9");

    const sent = await get<ChangelogStatusResponse>("/status");

    expect(sent.body.shouldShow).toBe(true);
  });

  test("compares numerically, not lexically: 0.5.9 is behind 0.5.10", async () => {
    // A lexical compare gets this backwards ("0.5.9" > "0.5.10" as strings),
    // which would wrongly hide an entry the user hasn't actually seen yet.
    await markSeenAt("u_agent", "0.5.9");

    const sent = await get<ChangelogStatusResponse>("/status");

    expect(sent.body.shouldShow).toBe(true);
  });

  test("is per user: one agent's seen mark doesn't hide it from another", async () => {
    await post("/seen", AGENT);

    const sent = await get<ChangelogStatusResponse>("/status", ADMIN);

    expect(sent.body.shouldShow).toBe(true);
    expect(await seenRows()).toEqual([
      { userId: "u_agent", seenVersion: LATEST_VERSION },
    ]);
  });
});

/* ── POST /seen ──────────────────────────────────────────────────────────── */

describe("POST /api/changelog/seen", () => {
  test("creates a seen row on first interaction, at the server's own version", async () => {
    const sent = await post("/seen");

    expect(sent.status).toBe(200);
    expect(await seenRows()).toEqual([
      { userId: "u_agent", seenVersion: LATEST_VERSION },
    ]);
  });

  test("updates rather than duplicates on a second call", async () => {
    // `userId` is the table's primary key, so this is now Postgres refusing a
    // second row rather than a `findIndex` in this file choosing not to push
    // one — and the refreshed `seenAt` is what proves the upsert took its
    // update branch instead of quietly doing nothing.
    await markSeenAt("u_agent", "0.4.9");

    await post("/seen");

    const rows = await prisma.changelogSeen.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.seenVersion).toBe(LATEST_VERSION);
    expect(rows[0]!.seenAt.getTime()).toBeGreaterThan(NOW.getTime());
  });
});
