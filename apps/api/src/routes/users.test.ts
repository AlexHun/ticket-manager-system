/**
 * Unit tests for the admin-activity audit trail wired into `./users` — the
 * account-management analogue of `TicketActivity`. Covers every action
 * `routes/users.ts` can write today: `user_created`, `user_invited` (both the
 * initial invite and a resend), `user_edited`, and `user_deleted`.
 * `role_changed` is untested because nothing writes it — see the schema
 * comment on `AdminActivityAction`.
 *
 * `./admin-activity`'s pure helper (`userEditChanges`) is exercised directly,
 * with no mocking, alongside the route so a failure in either shows up next
 * to its cause.
 *
 * `../db`, `../middleware/auth` and `../auth` are all mocked. `../auth` is
 * mocked nowhere else in this suite, so there is no cross-file registration
 * risk there (see `testing.md`'s note on the shared module registry). The
 * `../middleware/auth` stub is **deliberately identical** to the one in
 * `../automation.test.ts`, `./ai.test.ts` and `./knowledge.test.ts` for the
 * same reason theirs are identical to each other — if one changes, change
 * all four.
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
import { userEditChanges } from "../admin-activity";

/* ── userEditChanges — no mocking needed, it touches nothing ────────────── */

describe("userEditChanges", () => {
  test("writes nothing when neither field moved", () => {
    expect(
      userEditChanges(
        { name: "Aaron Agent", email: "aaron@example.com" },
        { name: "Aaron Agent", email: "aaron@example.com" },
      ),
    ).toEqual([]);
  });

  test("one row for a name change alone", () => {
    const entries = userEditChanges(
      { name: "Aaron Agent", email: "aaron@example.com" },
      { name: "Aaron A. Gent", email: "aaron@example.com" },
    );

    expect(entries).toEqual([
      {
        action: "user_edited",
        fromValue: "Name: Aaron Agent",
        toValue: "Name: Aaron A. Gent",
      },
    ]);
  });

  test("one row for an email change alone", () => {
    const entries = userEditChanges(
      { name: "Aaron Agent", email: "aaron@example.com" },
      { name: "Aaron Agent", email: "aaron@new-example.com" },
    );

    expect(entries).toEqual([
      {
        action: "user_edited",
        fromValue: "Email: aaron@example.com",
        toValue: "Email: aaron@new-example.com",
      },
    ]);
  });

  test("two rows when both moved in one PATCH", () => {
    const entries = userEditChanges(
      { name: "Aaron Agent", email: "aaron@example.com" },
      { name: "Aaron A. Gent", email: "aaron@new-example.com" },
    );

    expect(entries).toHaveLength(2);
    expect(entries[0]?.toValue).toBe("Name: Aaron A. Gent");
    expect(entries[1]?.toValue).toBe("Email: aaron@new-example.com");
  });
});

/* ── The world behind the modules ────────────────────────────────────────── */

interface FakeUser {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerified: boolean;
  automated: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}

let users: FakeUser[];
let tickets: { id: number; assignedToId: string | null }[];
let adminActivityLog: Record<string, unknown>[];
let nextNewUserId: number;

function findUser(id: string): FakeUser | null {
  return users.find((u) => u.id === id) ?? null;
}

const userFindUnique = mock((args: { where: { id: string } }) =>
  Promise.resolve(findUser(args.where.id)),
);

const userFindUniqueOrThrow = mock((args: { where: { id: string } }) => {
  const found = findUser(args.where.id);
  if (!found) throw new Error(`no fake user ${args.where.id}`);
  return Promise.resolve(found);
});

const userUpdate = mock(
  (args: { where: { id: string }; data: Partial<FakeUser> }) => {
    users = users.map((u) =>
      u.id === args.where.id ? { ...u, ...args.data } : u,
    );
    return Promise.resolve(findUser(args.where.id));
  },
);

const sessionDeleteMany = mock(() => Promise.resolve({ count: 0 }));

const ticketFindMany = mock((args: { where: { assignedToId: string } }) =>
  Promise.resolve(
    tickets
      .filter((t) => t.assignedToId === args.where.assignedToId)
      .map((t) => ({ id: t.id })),
  ),
);

const ticketUpdateMany = mock(
  (args: { where: { assignedToId: string }; data: { assignedToId: null } }) => {
    const matched = tickets.filter(
      (t) => t.assignedToId === args.where.assignedToId,
    );
    tickets = tickets.map((t) =>
      t.assignedToId === args.where.assignedToId
        ? { ...t, assignedToId: null }
        : t,
    );
    return Promise.resolve({ count: matched.length });
  },
);

const ticketActivityCreateMany = mock(
  (args: { data: Record<string, unknown>[] }) =>
    Promise.resolve({ count: args.data.length }),
);

const adminActivityCreate = mock((args: { data: Record<string, unknown> }) => {
  adminActivityLog.push(args.data);
  return Promise.resolve(args.data);
});

const adminActivityCreateMany = mock(
  (args: { data: Record<string, unknown>[] }) => {
    adminActivityLog.push(...args.data);
    return Promise.resolve({ count: args.data.length });
  },
);

mock.module("../db", () => ({
  prisma: {
    user: {
      findUnique: userFindUnique,
      findUniqueOrThrow: userFindUniqueOrThrow,
      update: userUpdate,
    },
    session: { deleteMany: sessionDeleteMany },
    ticket: { findMany: ticketFindMany, updateMany: ticketUpdateMany },
    ticketActivity: { createMany: ticketActivityCreateMany },
    adminActivity: { create: adminActivityCreate, createMany: adminActivityCreateMany },
    // The array form: each element is already a settled promise by the time
    // it reaches here under this fake, so this only has to wait on them.
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

/**
 * Deliberately identical to `../automation.test.ts`, `./ai.test.ts` and
 * `./knowledge.test.ts` — see the file header.
 */
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

/** Only `routes/users.ts` imports `../auth` among tested modules — no other
 * file registers a mock for this specifier, so there is nothing to collide
 * with. See the file header. */
const createUser = mock((args: { body: { name: string; email: string } }) => {
  const id = `u_new_${++nextNewUserId}`;
  const created: FakeUser = {
    id,
    name: args.body.name,
    email: args.body.email,
    role: "agent",
    emailVerified: true,
    automated: false,
    deletedAt: null,
    createdAt: new Date("2026-08-24T08:00:00.000Z"),
  };
  users.push(created);
  return Promise.resolve({ user: created });
});

const adminUpdateUser = mock(
  (args: { body: { userId: string; data: { name: string; email: string } } }) => {
    users = users.map((u) =>
      u.id === args.body.userId ? { ...u, ...args.body.data } : u,
    );
    return Promise.resolve({});
  },
);

const requestPasswordReset = mock(() => Promise.resolve({}));

mock.module("../auth", () => ({
  appOrigin: "http://localhost:5173",
  auth: { api: { createUser, adminUpdateUser, requestPasswordReset } },
}));

const { usersRouter } = await import("./users");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

function user(overrides: Partial<FakeUser> & { id: string }): FakeUser {
  return {
    name: overrides.id,
    email: `${overrides.id}@example.com`,
    role: "agent",
    emailVerified: true,
    automated: false,
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const ADMIN = user({
  id: "u_admin",
  name: "Ada Admin",
  email: "admin@example.com",
  role: "admin",
});

const AGENT = user({ id: "u_agent", name: "Aaron Agent", email: "aaron@example.com" });

const OTHER_ADMIN = user({
  id: "u_other_admin",
  name: "Bo Admin",
  email: "bo@example.com",
  role: "admin",
});

const ASSISTANT = user({
  id: "u_assistant",
  name: "AI Assistant",
  email: "assistant@automation.invalid",
  automated: true,
});

beforeEach(() => {
  userFindUnique.mockClear();
  userFindUniqueOrThrow.mockClear();
  userUpdate.mockClear();
  sessionDeleteMany.mockClear();
  ticketFindMany.mockClear();
  ticketUpdateMany.mockClear();
  ticketActivityCreateMany.mockClear();
  adminActivityCreate.mockClear();
  adminActivityCreateMany.mockClear();
  createUser.mockClear();
  adminUpdateUser.mockClear();
  requestPasswordReset.mockClear();

  users = [ADMIN, AGENT, OTHER_ADMIN, ASSISTANT].map((u) => ({ ...u }));
  tickets = [];
  adminActivityLog = [];
  nextNewUserId = 0;
});

/* ── The route ───────────────────────────────────────────────────────────── */

let server: Server;
let origin: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/users", usersRouter);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

const AS_ADMIN = {
  "x-test-user": ADMIN.id,
  "x-test-agent-name": ADMIN.name,
  "x-test-user-email": ADMIN.email,
};

interface Sent {
  status: number;
  body: { error?: string; user?: { id: string } };
}

async function post(path: string, body: unknown): Promise<Sent> {
  const res = await fetch(`${origin}/api/users${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...AS_ADMIN },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Sent["body"] };
}

async function patch(path: string, body: unknown): Promise<Sent> {
  const res = await fetch(`${origin}/api/users${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...AS_ADMIN },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Sent["body"] };
}

async function del(path: string): Promise<Sent> {
  const res = await fetch(`${origin}/api/users${path}`, {
    method: "DELETE",
    headers: AS_ADMIN,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

describe("POST /api/users — user_created and the initial user_invited", () => {
  test("writes both rows, actor is the signed-in admin", async () => {
    const sent = await post("/", { name: "Nadia New", email: "nadia@example.com" });

    expect(sent.status).toBe(201);
    expect(adminActivityLog).toHaveLength(2);
    expect(adminActivityLog).toEqual([
      expect.objectContaining({
        action: "user_created",
        actorId: ADMIN.id,
        actorName: ADMIN.name,
        actorEmail: ADMIN.email,
        targetUserId: sent.body.user?.id,
        targetUserName: "Nadia New",
      }),
      expect.objectContaining({
        action: "user_invited",
        toValue: "initial",
        targetUserId: sent.body.user?.id,
        targetUserName: "Nadia New",
      }),
    ]);
  });
});

describe("PATCH /api/users/:id — user_edited", () => {
  test("no row when the PATCH re-sends what the account already had", async () => {
    const sent = await patch(`/${AGENT.id}`, {
      name: AGENT.name,
      email: AGENT.email,
    });

    expect(sent.status).toBe(200);
    expect(adminActivityLog).toEqual([]);
  });

  test("one row, labelled, for a name-only change", async () => {
    await patch(`/${AGENT.id}`, { name: "Aaron A. Gent", email: AGENT.email });

    expect(adminActivityLog).toEqual([
      expect.objectContaining({
        action: "user_edited",
        fromValue: `Name: ${AGENT.name}`,
        toValue: "Name: Aaron A. Gent",
        actorId: ADMIN.id,
        targetUserId: AGENT.id,
        targetUserName: "Aaron A. Gent",
      }),
    ]);
  });

  test("two rows when name and email both change in one PATCH", async () => {
    await patch(`/${AGENT.id}`, {
      name: "Aaron A. Gent",
      email: "aaron.new@example.com",
    });

    expect(adminActivityLog).toHaveLength(2);
    expect(adminActivityLog.map((e) => e.toValue)).toEqual([
      "Name: Aaron A. Gent",
      "Email: aaron.new@example.com",
    ]);
  });

  test("refuses the assistant before writing anything", async () => {
    const sent = await patch(`/${ASSISTANT.id}`, {
      name: "Renamed",
      email: ASSISTANT.email,
    });

    expect(sent.status).toBe(403);
    expect(adminActivityLog).toEqual([]);
  });
});

describe("POST /api/users/:id/invite — user_invited, resend", () => {
  test("records toValue: resend, not initial", async () => {
    const sent = await post(`/${AGENT.id}/invite`, {});

    expect(sent.status).toBe(204);
    expect(adminActivityLog).toEqual([
      expect.objectContaining({
        action: "user_invited",
        toValue: "resend",
        actorId: ADMIN.id,
        targetUserId: AGENT.id,
        targetUserName: AGENT.name,
      }),
    ]);
  });
});

describe("DELETE /api/users/:id — user_deleted", () => {
  test("writes one row, actor the deleting admin, target the deleted account", async () => {
    const sent = await del(`/${AGENT.id}`);

    expect(sent.status).toBe(204);
    expect(adminActivityLog).toEqual([
      expect.objectContaining({
        action: "user_deleted",
        actorId: ADMIN.id,
        actorName: ADMIN.name,
        targetUserId: AGENT.id,
        targetUserName: AGENT.name,
      }),
    ]);
  });

  test("writes nothing when the delete is refused (an admin target)", async () => {
    const sent = await del(`/${OTHER_ADMIN.id}`);

    expect(sent.status).toBe(403);
    expect(adminActivityLog).toEqual([]);
  });

  test("writes nothing when the delete is refused (the assistant)", async () => {
    const sent = await del(`/${ASSISTANT.id}`);

    expect(sent.status).toBe(403);
    expect(adminActivityLog).toEqual([]);
  });
});
