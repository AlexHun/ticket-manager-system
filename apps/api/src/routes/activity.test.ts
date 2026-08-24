/**
 * Unit tests for `GET /api/activity`, the unified admin activity feed.
 *
 * `bun test` mocks the database (`docs/standards/testing.md`), so nothing
 * here can prove the `UNION ALL` actually merges five Postgres tables in the
 * right order — that is `ticket-stats.ts`'s situation too, and this codebase
 * already answers it by not unit-testing that route at all
 * (`ticket-effectiveness.test.ts` tests only the two pieces expressible as
 * pure functions over plain rows, and pulls in nothing that reaches `../db`).
 *
 * What *is* worth pinning down without a real database:
 *   - `toActivityEntry`, the one pure function here — a plain-object mapping
 *     with no I/O, tested directly.
 *   - the route's request/response contract: validation, defaulting,
 *     pagination echoed back, and raw rows shaped onto the wire.
 *   - which branches a given `entityType` filter includes or excludes, and
 *     that `actorId`/`from`/`to` reach the query as bind parameters rather
 *     than being silently dropped — checked by inspecting the `Prisma.Sql`
 *     fragments handed to a stubbed `$queryRaw`, never by executing them.
 *
 * `../db` and `../middleware/auth` are mocked, same as every other route
 * test in this workspace. The `../middleware/auth` stub is deliberately
 * identical to the one in `../automation.test.ts` and `./ai.test.ts` — see
 * the comment on `fakeGuard` there — because `mock.module` registrations
 * are process-wide and neither factory spreads the real module. The `../db`
 * stub is unique to this file (nothing else needs `$queryRaw` or the real
 * `Prisma` tag), and pulls the real `Prisma` namespace off the generated
 * client rather than reimplementing `Prisma.sql`/`join`/`empty`: those are
 * pure query-string builders with no connection behind them, so importing
 * them costs nothing a hand-rolled fake wouldn't, and stays exactly right by
 * construction.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import express from "express";
import { ACTIVITY_ENTITY_TYPE, DEFAULT_PAGE_SIZE, FIRST_PAGE } from "@ticket/shared";

/* ── The world behind the route ──────────────────────────────────────────── */

const { Prisma } = await import("../generated/prisma/client");

/** What each queued `$queryRaw` call answers with, in call order. */
let queryRawQueue: unknown[][];

const queryRaw = mock((_sql: unknown) => Promise.resolve(queryRawQueue.shift() ?? []));
const transaction = mock((ops: Promise<unknown>[]) => Promise.all(ops));

mock.module("../db", () => ({
  Prisma,
  prisma: { $queryRaw: queryRaw, $transaction: transaction },
}));

/** Deliberately identical to `automation.test.ts` / `routes/ai.test.ts` — see
 *  this file's header comment. */
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

const { activityRouter, toActivityEntry } = await import("./activity");

beforeEach(() => {
  queryRawQueue = [];
  queryRaw.mockClear();
  transaction.mockClear();
});

/* ── toActivityEntry: the one pure function ─────────────────────────────── */

describe("toActivityEntry", () => {
  test("carries every column straight across and formats the date", () => {
    const row = {
      id: "ticket_activity:42",
      entityType: "ticket",
      entityId: "7",
      action: "status_changed",
      actorId: "u_agent",
      actorName: "Aaron Agent",
      fromValue: "Open",
      toValue: "Resolved",
      createdAt: new Date("2026-08-24T09:00:00.000Z"),
    };

    expect(toActivityEntry(row)).toEqual({
      id: "ticket_activity:42",
      entityType: "ticket",
      entityId: "7",
      action: "status_changed",
      actorId: "u_agent",
      actorName: "Aaron Agent",
      fromValue: "Open",
      toValue: "Resolved",
      createdAt: "2026-08-24T09:00:00.000Z",
    });
  });

  test("preserves nulls rather than coercing them", () => {
    const row = {
      id: "automation_revision:3",
      entityType: "automation",
      entityId: null,
      action: "handoff_changed",
      actorId: null,
      actorName: "Ada Admin",
      fromValue: null,
      toValue: "admin",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    };

    const entry = toActivityEntry(row);
    expect(entry.entityId).toBeNull();
    expect(entry.actorId).toBeNull();
    expect(entry.fromValue).toBeNull();
  });
});

/* ── The route ───────────────────────────────────────────────────────────── */

let server: Server;
let origin: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/activity", activityRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

interface Sent {
  status: number;
  body: {
    entries?: unknown[];
    total?: number;
    page?: number;
    pageSize?: number;
    error?: string;
  };
}

async function get(qs = ""): Promise<Sent> {
  const res = await fetch(`${origin}/api/activity${qs ? `?${qs}` : ""}`);
  return { status: res.status, body: (await res.json()) as Sent["body"] };
}

/** The `Prisma.Sql` handed to the page query on the most recent request. */
function lastPageSql(): { text: string; values: unknown[] } {
  const call = queryRaw.mock.calls[0];
  if (!call) throw new Error("$queryRaw was never called");
  const sql = call[0] as { sql: string; values: unknown[] };
  return { text: sql.sql, values: sql.values };
}

describe("query validation", () => {
  test("rejects an unknown entity type", async () => {
    queryRawQueue = [[], [{ total: 0 }]];
    const sent = await get("entityType=nonsense");

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe("Invalid entity type filter");
    expect(queryRaw).not.toHaveBeenCalled();
  });

  test("rejects a non-numeric page", async () => {
    const sent = await get("page=abc");
    expect(sent.status).toBe(400);
  });

  test("rejects a page size over the ceiling", async () => {
    const sent = await get("pageSize=1000");
    expect(sent.status).toBe(400);
  });

  test("rejects a start date after the end date", async () => {
    const sent = await get("from=2026-08-20&to=2026-08-01");

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe("Start date must be before end date");
  });

  test("defaults page and pageSize when omitted", async () => {
    queryRawQueue = [[], [{ total: 0 }]];
    const sent = await get();

    expect(sent.body.page).toBe(FIRST_PAGE);
    expect(sent.body.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("response shape", () => {
  test("maps raw rows onto the wire shape and reports the total", async () => {
    queryRawQueue = [
      [
        {
          id: "admin_activity:9",
          entityType: "admin",
          entityId: "u_target",
          action: "user_edited",
          actorId: "u_admin",
          actorName: "Ada Admin",
          fromValue: "Name: Old",
          toValue: "Name: New",
          createdAt: new Date("2026-08-24T10:00:00.000Z"),
        },
      ],
      [{ total: 1 }],
    ];

    const sent = await get();

    expect(sent.status).toBe(200);
    expect(sent.body.total).toBe(1);
    expect(sent.body.entries).toEqual([
      {
        id: "admin_activity:9",
        entityType: "admin",
        entityId: "u_target",
        action: "user_edited",
        actorId: "u_admin",
        actorName: "Ada Admin",
        fromValue: "Name: Old",
        toValue: "Name: New",
        createdAt: "2026-08-24T10:00:00.000Z",
      },
    ]);
  });

  test("an empty page still reports the total", async () => {
    queryRawQueue = [[], [{ total: 0 }]];
    const sent = await get("page=5");

    expect(sent.body.entries).toEqual([]);
    expect(sent.body.total).toBe(0);
  });

  test("runs the page and count queries in one transaction", async () => {
    queryRawQueue = [[], [{ total: 0 }]];
    await get();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe("entityType narrows which branches are unioned", () => {
  const TABLES = {
    ticket_activity: "ticket_activity",
    message: '"message"',
    knowledge: "knowledge_article_revision",
    admin: "admin_activity",
    automation: "automation_settings_revision",
  };

  test("no filter unions all five sources", async () => {
    queryRawQueue = [[], [{ total: 0 }]];
    await get();

    const { text } = lastPageSql();
    expect(text).toContain(TABLES.ticket_activity);
    expect(text).toContain(TABLES.message);
    expect(text).toContain(TABLES.knowledge);
    expect(text).toContain(TABLES.admin);
    expect(text).toContain(TABLES.automation);
  });

  test("entityType=knowledge includes only the knowledge branch", async () => {
    queryRawQueue = [[], [{ total: 0 }]];
    await get(`entityType=${ACTIVITY_ENTITY_TYPE.knowledge}`);

    const { text } = lastPageSql();
    expect(text).toContain(TABLES.knowledge);
    expect(text).not.toContain(TABLES.ticket_activity);
    expect(text).not.toContain(TABLES.admin);
    expect(text).not.toContain(TABLES.automation);
  });

  test("entityType=ticket includes both ticket sources and no others", async () => {
    queryRawQueue = [[], [{ total: 0 }]];
    await get(`entityType=${ACTIVITY_ENTITY_TYPE.ticket}`);

    const { text } = lastPageSql();
    expect(text).toContain(TABLES.ticket_activity);
    expect(text).toContain(TABLES.message);
    expect(text).not.toContain(TABLES.knowledge);
    expect(text).not.toContain(TABLES.admin);
    expect(text).not.toContain(TABLES.automation);
  });

  test("entityType=admin includes only the admin branch", async () => {
    queryRawQueue = [[], [{ total: 0 }]];
    await get(`entityType=${ACTIVITY_ENTITY_TYPE.admin}`);

    const { text } = lastPageSql();
    expect(text).toContain(TABLES.admin);
    expect(text).not.toContain(TABLES.ticket_activity);
    expect(text).not.toContain(TABLES.message);
    expect(text).not.toContain(TABLES.knowledge);
    expect(text).not.toContain(TABLES.automation);
  });

  test("entityType=automation includes only the automation branch", async () => {
    queryRawQueue = [[], [{ total: 0 }]];
    await get(`entityType=${ACTIVITY_ENTITY_TYPE.automation}`);

    const { text } = lastPageSql();
    expect(text).toContain(TABLES.automation);
    expect(text).not.toContain(TABLES.ticket_activity);
    expect(text).not.toContain(TABLES.message);
    expect(text).not.toContain(TABLES.knowledge);
    expect(text).not.toContain(TABLES.admin);
  });
});

describe("filters reach the query as bind parameters", () => {
  test("actorId is bound once per included branch, never spliced into the text", async () => {
    queryRawQueue = [[], [{ total: 0 }]];
    await get("actorId=u_someone");

    const { text, values } = lastPageSql();
    // Never inline — the whole point of a bind parameter.
    expect(text).not.toContain("u_someone");
    // Once per source branch: ticket_activity, message, knowledge, admin,
    // automation — five, with no entityType filter narrowing them.
    expect(values.filter((v) => v === "u_someone")).toHaveLength(5);
  });

  test("from/to are bound as UTC-cast timestamps, not concatenated", async () => {
    queryRawQueue = [[], [{ total: 0 }]];
    await get("from=2026-08-01T00:00:00.000Z&to=2026-08-20T00:00:00.000Z");

    const { text, values } = lastPageSql();
    expect(text).not.toContain("2026-08-01");
    expect(values).toContain("2026-08-01T00:00:00.000Z");
    expect(values).toContain("2026-08-20T00:00:00.000Z");
  });

  test("page and pageSize become LIMIT/OFFSET bind params", async () => {
    queryRawQueue = [[], [{ total: 0 }]];
    await get("page=3&pageSize=10");

    const { values } = lastPageSql();
    // page 3 at 10 per page: skip the first 20.
    expect(values).toContain(10);
    expect(values).toContain(20);
  });
});
