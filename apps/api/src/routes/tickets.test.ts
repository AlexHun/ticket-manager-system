/**
 * Unit tests for the unread-assignment surface added to `./tickets`
 * (ADR-0013 / #28): `GET /api/tickets/unread`, the conditional
 * `assignmentSeenAt` write inside `GET /:id`, and the assignee route clearing
 * it back to null. Not a test of the whole router — everything else on it is
 * either covered elsewhere or, like `/stats` and `/effectiveness`, untouched
 * by this change and never invoked below.
 *
 * **The seam here is the database, not the Prisma client (#152).** `../db` is
 * still replaced, but what it is replaced *with* is a real Prisma client on a
 * real Postgres running in this process — see `../test/pg`. Everything this
 * file used to hand-write is now Postgres' own answer:
 *
 *   - the conditional `updateMany` behind "mark the assignment seen" is matched
 *     by the database, so "no-ops on a ticket already seen" tests the route's
 *     `where` clause instead of a re-implementation of it in this file;
 *   - `GET /unread`'s `select` is honoured, so the response really is `{ id,
 *     subject }` rather than whatever the fake chose to return;
 *   - `updateTicket`'s `$transaction` commits or rolls back for real, taking
 *     the audit-trail rows with it.
 *
 * The old fakes also could not have caught a route asking for a column that
 * does not exist, or an assignee `include` reaching for a field the select
 * withholds. Those are now type-checked by Prisma *and* executed by Postgres.
 *
 * `mock.module` is still how the client reaches the router, and the registry is
 * still process-wide — but a binding to the shared real client is one every
 * other converted file wants too, so two files sharing it is no longer a
 * hazard (`docs/standards/testing.md`).
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
import type {
  TicketDetailResponse,
  TicketUnreadResponse,
  UpdateTicketResponse,
} from "@ticket/shared";
import { Prisma, prisma, resetDb } from "../test/pg";

/* ── The world behind the router ─────────────────────────────────────────── */

mock.module("../db", () => ({ Prisma, prisma }));

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

const NOW = new Date("2026-08-27T12:00:00.000Z");

/**
 * Insert a ticket. Ids are given explicitly and the sequence is restarted by
 * `resetDb()`, so a test reads `/1` and means the row it just wrote.
 */
function makeTicket(row: {
  id: number;
  subject?: string;
  status?: "New" | "Open" | "Processing" | "Resolved" | "Closed";
  assignedToId?: string | null;
  assignmentSeenAt?: Date | null;
}) {
  return prisma.ticket.create({
    data: {
      id: row.id,
      subject: row.subject ?? "Cannot log in",
      status: row.status ?? "Open",
      customerEmail: "customer@example.com",
      customerName: "Marta",
      assignedToId: row.assignedToId ?? null,
      assignmentSeenAt: row.assignmentSeenAt ?? null,
      lastMessageAt: NOW,
      createdAt: NOW,
    },
  });
}

/** Read the one column these tests are about, straight from the table. */
async function seenAt(id: number): Promise<Date | null> {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { assignmentSeenAt: true },
  });
  return row.assignmentSeenAt;
}

async function assigneeOf(id: number): Promise<string | null> {
  const row = await prisma.ticket.findUniqueOrThrow({
    where: { id },
    select: { assignedToId: true },
  });
  return row.assignedToId;
}

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
        id: "u_other",
        name: "Olivia Other",
        email: "olivia@example.com",
        emailVerified: true,
      },
    ],
  });
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
    await makeTicket({ id: 1, assignedToId: "u_agent", assignmentSeenAt: null });
    await makeTicket({ id: 2, assignedToId: "u_agent", assignmentSeenAt: NOW });
    await makeTicket({ id: 3, assignedToId: "u_other", assignmentSeenAt: null });

    const sent = await get<TicketUnreadResponse>("/unread");

    expect(sent.status).toBe(200);
    expect(sent.body.tickets.map((t) => t.id)).toEqual([1]);
  });

  test("returns only the two columns the route selects", async () => {
    // Not assertable against the old fake, which returned `{ id, subject }`
    // whatever the route asked for. Now the shape is Postgres', so an `include`
    // that leaked the customer's address onto this endpoint would fail here.
    await makeTicket({ id: 1, assignedToId: "u_agent" });

    const sent = await get<TicketUnreadResponse>("/unread");

    expect(sent.body.tickets).toEqual([{ id: 1, subject: "Cannot log in" }]);
  });

  test("a Resolved or Closed ticket still counts — no status filter", async () => {
    await makeTicket({
      id: 1,
      status: "Closed",
      assignedToId: "u_agent",
      assignmentSeenAt: null,
    });

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
    await makeTicket({ id: 1, assignedToId: "u_agent", assignmentSeenAt: null });

    const sent = await get<TicketDetailResponse>("/1");

    expect(sent.status).toBe(200);
    expect(await seenAt(1)).not.toBeNull();
  });

  test("does not touch a ticket assigned to somebody else", async () => {
    await makeTicket({ id: 1, assignedToId: "u_other", assignmentSeenAt: null });

    await get<TicketDetailResponse>("/1");

    expect(await seenAt(1)).toBeNull();
  });

  test("no-ops on a ticket already seen", async () => {
    await makeTicket({ id: 1, assignedToId: "u_agent", assignmentSeenAt: NOW });

    await get<TicketDetailResponse>("/1");

    // The route still fires the conditional write — it is the `where` clause,
    // not the route, that has to make it a no-op — and it is now Postgres
    // deciding that rather than a matcher written in this file.
    expect(await seenAt(1)).toEqual(NOW);
  });

  test("removes the ticket from the unread list once opened", async () => {
    await makeTicket({ id: 1, assignedToId: "u_agent", assignmentSeenAt: null });

    await get<TicketDetailResponse>("/1");
    const sent = await get<TicketUnreadResponse>("/unread");

    expect(sent.body.tickets).toEqual([]);
  });

  test("404s on a ticket that does not exist", async () => {
    const sent = await get<TicketDetailResponse>("/999");
    expect(sent.status).toBe(404);
  });
});

/* ── PATCH /:id/assignee clears assignmentSeenAt ────────────────────────── */

describe("PATCH /api/tickets/:id/assignee — assignmentSeenAt reset", () => {
  test("a fresh assignment is unread from the instant it lands", async () => {
    await makeTicket({ id: 1, assignedToId: null, assignmentSeenAt: NOW });

    const sent = await patch<UpdateTicketResponse>("/1/assignee", {
      assignedToId: "u_agent",
    });

    expect(sent.status).toBe(200);
    expect(await seenAt(1)).toBeNull();

    const unread = await get<TicketUnreadResponse>("/unread");
    expect(unread.body.tickets.map((t) => t.id)).toEqual([1]);
  });

  test("reassigning to someone else also clears it for the new owner", async () => {
    await makeTicket({ id: 1, assignedToId: "u_agent", assignmentSeenAt: NOW });

    await patch("/1/assignee", { assignedToId: "u_other" }, AGENT);

    expect(await seenAt(1)).toBeNull();
    expect(await assigneeOf(1)).toBe("u_other");
  });

  test("writes the assignee change to the ticket's audit trail", async () => {
    // The trail shares `updateTicket`'s transaction with the row itself. The
    // old fake ran the callback against a stub `tx` and could not have told a
    // committed write from a rolled-back one.
    await makeTicket({ id: 1, assignedToId: null });

    await patch("/1/assignee", { assignedToId: "u_agent" }, AGENT);

    const trail = await prisma.ticketActivity.findMany({
      where: { ticketId: 1 },
      select: { action: true, fromValue: true, toValue: true },
    });
    expect(trail).toEqual([
      { action: "assignee_changed", fromValue: null, toValue: "Aaron Agent" },
    ]);
  });

  test("unassigning clears it too, and the ticket drops off everyone's unread list", async () => {
    await makeTicket({ id: 1, assignedToId: "u_agent", assignmentSeenAt: null });

    await patch("/1/assignee", { assignedToId: null }, OTHER);

    expect(await assigneeOf(1)).toBeNull();
    const unread = await get<TicketUnreadResponse>("/unread");
    expect(unread.body.tickets).toEqual([]);
  });

  test("rejects an assignee that isn't assignable", async () => {
    await makeTicket({ id: 1 });

    const sent = await patch("/1/assignee", { assignedToId: "nobody" });

    expect(sent.status).toBe(400);
  });

  test("rejects a soft-deleted colleague the picker was drawn before", async () => {
    // The FK would have accepted this row; `ASSIGNABLE_USER` is what refuses
    // it. With a hand-written `findFirst` fake, that predicate was only ever
    // as real as the fake's copy of it.
    await makeTicket({ id: 1 });
    await prisma.user.update({
      where: { id: "u_other" },
      data: { deletedAt: new Date() },
    });

    const sent = await patch("/1/assignee", { assignedToId: "u_other" });

    expect(sent.status).toBe(400);
    expect(await assigneeOf(1)).toBeNull();
  });
});
