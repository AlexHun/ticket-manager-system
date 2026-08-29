/**
 * Unit tests for `apps/api/src/routes/changelog.ts`.
 *
 * Same shape as `new-features.test.ts` next to it — the router only, on a
 * real Express app, with the database replaced by a small in-memory table.
 * The `../middleware/auth` stub is deliberately identical to theirs, for the
 * reason explained there: `mock.module` registrations are process-wide.
 *
 * `@ticket/shared` is also mocked, but only to pin `CHANGELOG_LATEST_VERSION`
 * to a known value for the test run — everything else is spread from the real
 * module (`...actual`) so no other test file sharing this process sees
 * anything different from the genuine package.
 *
 * What's worth pinning down without a real database: no row reads as "should
 * show", the version comparison, that marking seen actually stops it from
 * showing again, that it's per user, and that the version written is always
 * the server's own constant, never something a caller could supply.
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

/* ── The world behind the router ─────────────────────────────────────────── */

const LATEST_VERSION = "0.5.10";

interface SeenRow {
  userId: string;
  seenVersion: string;
  seenAt: Date;
}

let seen: SeenRow[];

const NOW = new Date("2026-08-29T12:00:00.000Z");

const seenFindUnique = mock((args: { where: { userId: string } }) =>
  Promise.resolve(seen.find((row) => row.userId === args.where.userId) ?? null),
);

const seenUpsert = mock(
  (args: {
    where: { userId: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }) => {
    const { userId } = args.where;
    const idx = seen.findIndex((row) => row.userId === userId);
    if (idx === -1) {
      const row: SeenRow = {
        userId,
        seenVersion: args.create.seenVersion as string,
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
    changelogSeen: {
      findUnique: seenFindUnique,
      upsert: seenUpsert,
    },
  },
}));

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

beforeEach(() => {
  seen = [];
  seenFindUnique.mockClear();
  seenUpsert.mockClear();
});

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
    seen.push({ userId: "u_agent", seenVersion: "0.4.9", seenAt: NOW });

    const sent = await get<ChangelogStatusResponse>("/status");

    expect(sent.body.shouldShow).toBe(true);
  });

  test("compares numerically, not lexically: 0.5.9 is behind 0.5.10", async () => {
    // A lexical compare gets this backwards ("0.5.9" > "0.5.10" as strings),
    // which would wrongly hide an entry the user hasn't actually seen yet.
    seen.push({ userId: "u_agent", seenVersion: "0.5.9", seenAt: NOW });

    const sent = await get<ChangelogStatusResponse>("/status");

    expect(sent.body.shouldShow).toBe(true);
  });

  test("is per user: one agent's seen mark doesn't hide it from another", async () => {
    await post("/seen", AGENT);

    const sent = await get<ChangelogStatusResponse>("/status", ADMIN);

    expect(sent.body.shouldShow).toBe(true);
  });
});

/* ── POST /seen ──────────────────────────────────────────────────────────── */

describe("POST /api/changelog/seen", () => {
  test("creates a seen row on first interaction, at the server's own version", async () => {
    const sent = await post("/seen");

    expect(sent.status).toBe(200);
    expect(seen).toContainEqual(
      expect.objectContaining({ userId: "u_agent", seenVersion: LATEST_VERSION }),
    );
  });

  test("updates rather than duplicates on a second call", async () => {
    await post("/seen");
    await post("/seen");

    expect(seen.filter((row) => row.userId === "u_agent")).toHaveLength(1);
  });
});
