/**
 * Unit tests for the unread-assignment surface added to `./tickets`
 * (ADR-0013 / #28): `GET /api/tickets/unread`, the conditional
 * `assignmentSeenAt` write inside `GET /:id`, and the assignee route clearing
 * it back to null. Not a test of the whole router — everything else on it is
 * either covered elsewhere or, like `/stats` and `/effectiveness`, untouched
 * by this change and never invoked below.
 *
 * `routes/tickets.ts` is not imported by any other test file, so this is the
 * first (and only) place `../db` is mocked with a `ticket`/`user` shape for
 * it — same reasoning as the note atop `outbound.test.ts`. `Prisma` is
 * included (the real export, like `routes/ai.test.ts` uses) because `./tickets`
 * pulls in `./ticket-stats` and `./ticket-effectiveness`, and both bind
 * `import { Prisma } from "../db"` the moment this file's `await import("./tickets")`
 * evaluates them for the first time in the suite.
 *
 * `writeActivity` (from `../ticket-activity`) is exercised for real rather
 * than mocked: it takes the transaction handle as a parameter rather than
 * importing its own `prisma`, so it writes through *this* file's `tx` mock
 * regardless of what `../db` was bound to wherever `../ticket-activity` was
 * first evaluated.
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
import type { TicketDetailResponse, TicketUnreadResponse, UpdateTicketResponse } from "@ticket/shared";

/* ── The world behind the router ─────────────────────────────────────────── */

interface TicketRow {
  id: number;
  subject: string;
  status: string;
  category: string | null;
  customerEmail: string;
  customerName: string;
  assignedToId: string | null;
  assignmentSeenAt: Date | null;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
  autoReplyDecline: string | null;
  autoReplyDeclinedAt: Date | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  deletedAt: Date | null;
  automated: boolean;
}

let tickets: TicketRow[];
let users: UserRow[];
let activity: { ticketId: number; action: string }[];

const NOW = new Date("2026-08-27T12:00:00.000Z");

function assigneeOf(row: TicketRow) {
  const user = row.assignedToId
    ? (users.find((u) => u.id === row.assignedToId) ?? null)
    : null;
  return user && { id: user.id, name: user.name, email: user.email };
}

const ticketFindUnique = mock((args: { where: { id: number } }) => {
  const row = tickets.find((t) => t.id === args.where.id);
  if (!row) return Promise.resolve(null);
  return Promise.resolve({ ...row, assignedTo: assigneeOf(row), messages: [] });
});

const ticketFindMany = mock(
  (args: {
    where: { assignedToId: string; assignmentSeenAt: null };
    orderBy: { updatedAt: "desc" };
  }) => {
    const rows = tickets
      .filter(
        (t) =>
          t.assignedToId === args.where.assignedToId &&
          t.assignmentSeenAt === null,
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return Promise.resolve(rows.map((t) => ({ id: t.id, subject: t.subject })));
  },
);

const ticketUpdateMany = mock(
  (args: {
    where: { id: number; assignedToId: string; assignmentSeenAt: null };
    data: { assignmentSeenAt: Date };
  }) => {
    const row = tickets.find(
      (t) =>
        t.id === args.where.id &&
        t.assignedToId === args.where.assignedToId &&
        t.assignmentSeenAt === null,
    );
    if (!row) return Promise.resolve({ count: 0 });
    row.assignmentSeenAt = args.data.assignmentSeenAt;
    return Promise.resolve({ count: 1 });
  },
);

const ticketUpdate = mock(
  (args: { where: { id: number }; data: Record<string, unknown> }) => {
    const row = tickets.find((t) => t.id === args.where.id);
    if (!row) throw new Error("no such ticket");
    Object.assign(row, args.data);
    row.updatedAt = NOW;
    return Promise.resolve({ ...row, assignedTo: assigneeOf(row) });
  },
);

const userFindFirst = mock(
  (args: { where: { id: string; deletedAt: null; automated: false } }) =>
    Promise.resolve(
      users.find(
        (u) =>
          u.id === args.where.id && u.deletedAt === null && !u.automated,
      ) ?? null,
    ),
);

const ticketActivityCreate = mock(
  (args: { data: { ticketId: number; action: string } }) => {
    activity.push({ ticketId: args.data.ticketId, action: args.data.action });
    return Promise.resolve(args.data);
  },
);

const txClient = {
  ticket: { update: ticketUpdate },
  ticketActivity: { create: ticketActivityCreate },
};

const { Prisma } = await import("../generated/prisma/client");

mock.module("../db", () => ({
  Prisma,
  prisma: {
    ticket: {
      findUnique: ticketFindUnique,
      findMany: ticketFindMany,
      updateMany: ticketUpdateMany,
    },
    user: { findFirst: userFindFirst },
    $transaction: (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: typeof txClient) => unknown)(txClient)
        : Promise.all(arg as Promise<unknown>[]),
  },
}));

/** Deliberately identical in shape to every other route test's stub — see
 *  the file header and `docs/standards/testing.md`. */
const fakeGuard = (req: Request, res: Response, next: NextFunction) => {
  res.locals.session = {
    user: {
      id: req.header("x-test-user") ?? "u_agent",
      name: req.header("x-test-agent-name") ?? "Aaron Agent",
      email: req.header("x-test-user-email") ?? "agent@example.com",
    },
    session: { id: "sess-1" },
  };
  next();
};

mock.module("../middleware/auth", () => ({
  requireAuth: fakeGuard,
  requireAdmin: fakeGuard,
  sessionOf: (res: Response) => res.locals.session,
}));

const { ticketsRouter } = await import("./tickets");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const AGENT = { "x-test-user": "u_agent", "x-test-agent-name": "Aaron Agent" };
const OTHER = { "x-test-user": "u_other", "x-test-agent-name": "Olivia Other" };

function ticketRow(overrides: Partial<TicketRow>): TicketRow {
  return {
    id: 1,
    subject: "Cannot log in",
    status: "Open",
    category: null,
    customerEmail: "customer@example.com",
    customerName: "Marta",
    assignedToId: null,
    assignmentSeenAt: null,
    lastMessageAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    autoReplyDecline: null,
    autoReplyDeclinedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  tickets = [];
  users = [
    { id: "u_agent", name: "Aaron Agent", email: "agent@example.com", deletedAt: null, automated: false },
    { id: "u_other", name: "Olivia Other", email: "olivia@example.com", deletedAt: null, automated: false },
  ];
  activity = [];
  ticketFindUnique.mockClear();
  ticketFindMany.mockClear();
  ticketUpdateMany.mockClear();
  ticketUpdate.mockClear();
  userFindFirst.mockClear();
  ticketActivityCreate.mockClear();
});

/* ── The app ─────────────────────────────────────────────────────────────── */

let server: Server;
let origin: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/tickets", ticketsRouter);
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
  const res = await fetch(`${origin}/api/tickets${path}`, { headers });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

async function patch<T>(
  path: string,
  body: unknown,
  headers: Record<string, string> = AGENT,
): Promise<Sent<T>> {
  const res = await fetch(`${origin}/api/tickets${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Sent<T>["body"] };
}

/* ── GET /unread ─────────────────────────────────────────────────────────── */

describe("GET /api/tickets/unread", () => {
  test("lists tickets assigned to the caller that they have not opened", async () => {
    tickets.push(
      ticketRow({ id: 1, assignedToId: "u_agent", assignmentSeenAt: null }),
      ticketRow({ id: 2, assignedToId: "u_agent", assignmentSeenAt: NOW }),
      ticketRow({ id: 3, assignedToId: "u_other", assignmentSeenAt: null }),
    );

    const sent = await get<TicketUnreadResponse>("/unread");

    expect(sent.status).toBe(200);
    expect(sent.body.tickets.map((t) => t.id)).toEqual([1]);
  });

  test("a Resolved or Closed ticket still counts — no status filter", async () => {
    tickets.push(
      ticketRow({ id: 1, status: "Closed", assignedToId: "u_agent", assignmentSeenAt: null }),
    );

    const sent = await get<TicketUnreadResponse>("/unread");

    expect(sent.body.tickets.map((t) => t.id)).toEqual([1]);
  });

  test("empty when nothing is unread", async () => {
    const sent = await get<TicketUnreadResponse>("/unread");
    expect(sent.body.tickets).toEqual([]);
  });
});

/* ── GET /:id marks the assignment seen ─────────────────────────────────── */

describe("GET /api/tickets/:id — assignmentSeenAt side effect", () => {
  test("clears assignmentSeenAt when the caller opens their own unread ticket", async () => {
    tickets.push(
      ticketRow({ id: 1, assignedToId: "u_agent", assignmentSeenAt: null }),
    );

    const sent = await get<TicketDetailResponse>("/1");

    expect(sent.status).toBe(200);
    expect(tickets[0].assignmentSeenAt).not.toBeNull();
    expect(ticketUpdateMany).toHaveBeenCalledTimes(1);
  });

  test("does not touch a ticket assigned to somebody else", async () => {
    tickets.push(
      ticketRow({ id: 1, assignedToId: "u_other", assignmentSeenAt: null }),
    );

    await get<TicketDetailResponse>("/1");

    expect(tickets[0].assignmentSeenAt).toBeNull();
    expect(ticketUpdateMany).not.toHaveBeenCalled();
  });

  test("no-ops on a ticket already seen", async () => {
    tickets.push(
      ticketRow({ id: 1, assignedToId: "u_agent", assignmentSeenAt: NOW }),
    );

    await get<TicketDetailResponse>("/1");

    // The guard still fires the conditional write — it is the `where` clause,
    // not this route, that has to make it a no-op — but the timestamp must
    // not move.
    expect(tickets[0].assignmentSeenAt).toEqual(NOW);
  });

  test("removes the ticket from the unread list once opened", async () => {
    tickets.push(
      ticketRow({ id: 1, assignedToId: "u_agent", assignmentSeenAt: null }),
    );

    await get<TicketDetailResponse>("/1");
    const sent = await get<TicketUnreadResponse>("/unread");

    expect(sent.body.tickets).toEqual([]);
  });
});

/* ── PATCH /:id/assignee clears assignmentSeenAt ────────────────────────── */

describe("PATCH /api/tickets/:id/assignee — assignmentSeenAt reset", () => {
  test("a fresh assignment is unread from the instant it lands", async () => {
    tickets.push(ticketRow({ id: 1, assignedToId: null, assignmentSeenAt: NOW }));

    const sent = await patch<UpdateTicketResponse>("/1/assignee", {
      assignedToId: "u_agent",
    });

    expect(sent.status).toBe(200);
    expect(tickets[0].assignmentSeenAt).toBeNull();

    const unread = await get<TicketUnreadResponse>("/unread");
    expect(unread.body.tickets.map((t) => t.id)).toEqual([1]);
  });

  test("reassigning to someone else also clears it for the new owner", async () => {
    tickets.push(
      ticketRow({ id: 1, assignedToId: "u_agent", assignmentSeenAt: NOW }),
    );

    await patch("/1/assignee", { assignedToId: "u_other" }, AGENT);

    expect(tickets[0].assignmentSeenAt).toBeNull();
    expect(tickets[0].assignedToId).toBe("u_other");
  });

  test("unassigning clears it too, and the ticket drops off everyone's unread list", async () => {
    tickets.push(
      ticketRow({ id: 1, assignedToId: "u_agent", assignmentSeenAt: null }),
    );

    await patch("/1/assignee", { assignedToId: null }, OTHER);

    expect(tickets[0].assignedToId).toBeNull();
    const unread = await get<TicketUnreadResponse>("/unread");
    expect(unread.body.tickets).toEqual([]);
  });

  test("rejects an assignee that isn't assignable", async () => {
    const sent = await patch("/1/assignee", { assignedToId: "nobody" });
    expect(sent.status).toBe(400);
  });
});
