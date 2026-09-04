/**
 * Unit tests for the admin-activity audit trail wired into `./users` — the
 * account-management analogue of `TicketActivity`. Covers every action
 * `routes/users.ts` can write: `user_created`, `user_invited` (both the
 * initial invite and a resend), `user_edited`, `role_changed`, and
 * `user_deleted` — plus the one thing `PATCH` refuses outright, an admin
 * moving their own role.
 *
 * `./admin-activity`'s pure helper (`userEditChanges`) is exercised directly,
 * with no mocking, alongside the route so a failure in either shows up next
 * to its cause.
 *
 * The last block is not about the trail: it counts how many times a request
 * reads the account it is acting on, which is a property `rejectAssistant`'s
 * shape can silently undo (see #115).
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
import { USER_ROLE } from "@ticket/shared";
import { userEditChanges } from "../admin-activity";

/* ── userEditChanges — no mocking needed, it touches nothing ────────────── */

describe("userEditChanges", () => {
  const BEFORE = {
    name: "Aaron Agent",
    email: "aaron@example.com",
    role: USER_ROLE.agent,
  };

  test("writes nothing when no field moved", () => {
    expect(userEditChanges(BEFORE, { ...BEFORE })).toEqual([]);
  });

  test("one row for a name change alone", () => {
    const entries = userEditChanges(BEFORE, {
      ...BEFORE,
      name: "Aaron A. Gent",
    });

    expect(entries).toEqual([
      {
        action: "user_edited",
        fromValue: "Name: Aaron Agent",
        toValue: "Name: Aaron A. Gent",
      },
    ]);
  });

  test("one row for an email change alone", () => {
    const entries = userEditChanges(BEFORE, {
      ...BEFORE,
      email: "aaron@new-example.com",
    });

    expect(entries).toEqual([
      {
        action: "user_edited",
        fromValue: "Email: aaron@example.com",
        toValue: "Email: aaron@new-example.com",
      },
    ]);
  });

  // Its own action, and the values are bare — no `"Role: "` prefix. The label
  // exists on the other two only because they share `user_edited` and
  // something has to say which of them moved.
  test("one unprefixed row for a promotion", () => {
    const entries = userEditChanges(BEFORE, {
      ...BEFORE,
      role: USER_ROLE.admin,
    });

    expect(entries).toEqual([
      { action: "role_changed", fromValue: "agent", toValue: "admin" },
    ]);
  });

  test("three rows when everything moved in one PATCH", () => {
    const entries = userEditChanges(BEFORE, {
      name: "Aaron A. Gent",
      email: "aaron@new-example.com",
      role: USER_ROLE.admin,
    });

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.toValue)).toEqual([
      "Name: Aaron A. Gent",
      "Email: aaron@new-example.com",
      "admin",
    ]);
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

// `Prisma` is included even though nothing in this file calls `Prisma.sql`:
// `mock.module("../db", …)` shares one process-wide registry with every
// other file that mocks this specifier, the first factory registered fixes
// which export names exist at all, and `./activity.test.ts` needs `Prisma`
// on this same module. Omitting it here would make that file's collision
// depend on load order. See the comment on its own `mock.module` call.
const { Prisma } = await import("../generated/prisma/client");

mock.module("../db", () => ({
  Prisma,
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
/**
 * Both fakes lowercase `email`, because the real thing does and the difference
 * is load-bearing here: Better Auth's `internalAdapter` writes
 * `email.toLowerCase()` on create *and* update, which is what made a case-only
 * edit look like a change to the audit trail (#118). A fake that stored the
 * submitted casing would keep passing with the normalisation removed.
 */
const createUser = mock((args: { body: { name: string; email: string } }) => {
  const id = `u_new_${++nextNewUserId}`;
  const created: FakeUser = {
    id,
    name: args.body.name,
    email: args.body.email.toLowerCase(),
    role: USER_ROLE.agent,
    emailVerified: true,
    automated: false,
    deletedAt: null,
    createdAt: new Date("2026-08-24T08:00:00.000Z"),
  };
  users.push(created);
  return Promise.resolve({ user: created });
});

const adminUpdateUser = mock(
  (args: {
    body: {
      userId: string;
      data: { name: string; email: string; role: string };
    };
  }) => {
    const { email, ...rest } = args.body.data;
    users = users.map((u) =>
      u.id === args.body.userId
        ? { ...u, ...rest, email: email.toLowerCase() }
        : u,
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
    role: USER_ROLE.agent,
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
  role: USER_ROLE.admin,
});

const AGENT = user({ id: "u_agent", name: "Aaron Agent", email: "aaron@example.com" });

const OTHER_ADMIN = user({
  id: "u_other_admin",
  name: "Bo Admin",
  email: "bo@example.com",
  role: USER_ROLE.admin,
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
  body: { error?: string; user?: { id: string; email: string } };
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

  // Nothing was broken here before #118 — Better Auth lowercases what it
  // stores, and the 201 is read back off what it returned. `createUserSchema`
  // normalises anyway so that both forms send the same thing, and so that the
  // address in the invitation is the one that will be in the row.
  test("an address typed with capitals is created lowercase", async () => {
    const sent = await post("/", {
      name: "Nadia New",
      email: "Nadia.New@Example.com",
    });

    expect(sent.status).toBe(201);
    expect(createUser.mock.calls[0]?.[0].body.email).toBe(
      "nadia.new@example.com",
    );
    expect(sent.body.user?.email).toBe("nadia.new@example.com");
  });
});

describe("PATCH /api/users/:id — user_edited", () => {
  test("no row when the PATCH re-sends what the account already had", async () => {
    const sent = await patch(`/${AGENT.id}`, {
      name: AGENT.name,
      email: AGENT.email,
      role: AGENT.role,
    });

    expect(sent.status).toBe(200);
    expect(adminActivityLog).toEqual([]);
  });

  test("one row, labelled, for a name-only change", async () => {
    await patch(`/${AGENT.id}`, {
      name: "Aaron A. Gent",
      email: AGENT.email,
      role: AGENT.role,
    });

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
      role: AGENT.role,
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
      role: ASSISTANT.role,
    });

    expect(sent.status).toBe(403);
    expect(adminActivityLog).toEqual([]);
  });

  /**
   * #118. Better Auth lowercases the address on the way in, so re-sending
   * `Aaron@Example.com` over a stored `aaron@example.com` changes nothing —
   * and used to write a `user_edited` row saying it had. `updateUserSchema`
   * normalises now, so the route diffs like against like.
   */
  test("no row when only the capitals of the email changed", async () => {
    const sent = await patch(`/${AGENT.id}`, {
      name: AGENT.name,
      email: AGENT.email.toUpperCase(),
      role: AGENT.role,
    });

    expect(sent.status).toBe(200);
    expect(adminActivityLog).toEqual([]);
    // And the row was not quietly rewritten either — what reaches Better Auth
    // is the address the account already had.
    expect(adminUpdateUser.mock.calls[0]?.[0].body.data.email).toBe(AGENT.email);
    expect(sent.body.user?.email).toBe(AGENT.email);
  });

  // The other half of the same bug: a real edit, typed with capitals. The row
  // it writes has to say what the database will hold, not what was typed.
  test("a genuine email change is recorded as it is stored", async () => {
    await patch(`/${AGENT.id}`, {
      name: AGENT.name,
      email: "Aaron.New@Example.com",
      role: AGENT.role,
    });

    expect(adminActivityLog).toEqual([
      expect.objectContaining({
        action: "user_edited",
        fromValue: `Email: ${AGENT.email}`,
        toValue: "Email: aaron.new@example.com",
      }),
    ]);
  });

  test("rejects a body with no role at all — this is not a partial update", async () => {
    const sent = await patch(`/${AGENT.id}`, {
      name: AGENT.name,
      email: AGENT.email,
    });

    expect(sent.status).toBe(400);
    expect(adminUpdateUser).not.toHaveBeenCalled();
    expect(adminActivityLog).toEqual([]);
  });

  test("rejects a role the app does not have", async () => {
    const sent = await patch(`/${AGENT.id}`, {
      name: AGENT.name,
      email: AGENT.email,
      role: "superadmin",
    });

    expect(sent.status).toBe(400);
    expect(adminUpdateUser).not.toHaveBeenCalled();
    expect(adminActivityLog).toEqual([]);
  });
});

describe("PATCH /api/users/:id — role_changed", () => {
  test("one row for a promotion, and the role reaches Better Auth", async () => {
    const sent = await patch(`/${AGENT.id}`, {
      name: AGENT.name,
      email: AGENT.email,
      role: USER_ROLE.admin,
    });

    expect(sent.status).toBe(200);
    expect(adminUpdateUser.mock.calls[0]?.[0].body.data.role).toBe(
      USER_ROLE.admin,
    );
    expect(adminActivityLog).toEqual([
      expect.objectContaining({
        action: "role_changed",
        fromValue: USER_ROLE.agent,
        toValue: USER_ROLE.admin,
        actorId: ADMIN.id,
        targetUserId: AGENT.id,
        targetUserName: AGENT.name,
      }),
    ]);
  });

  test("one row for a demotion of another admin", async () => {
    const sent = await patch(`/${OTHER_ADMIN.id}`, {
      name: OTHER_ADMIN.name,
      email: OTHER_ADMIN.email,
      role: USER_ROLE.agent,
    });

    expect(sent.status).toBe(200);
    expect(adminActivityLog).toEqual([
      expect.objectContaining({
        action: "role_changed",
        fromValue: USER_ROLE.admin,
        toValue: USER_ROLE.agent,
      }),
    ]);
  });

  // The only rule keeping at least one admin on the desk: a sole admin cannot
  // demote themselves, so there is no count to keep anywhere.
  test("refuses an admin demoting themselves, before any write", async () => {
    const sent = await patch(`/${ADMIN.id}`, {
      name: ADMIN.name,
      email: ADMIN.email,
      role: USER_ROLE.agent,
    });

    expect(sent.status).toBe(403);
    expect(sent.body.error).toBe("You cannot change your own role");
    expect(adminUpdateUser).not.toHaveBeenCalled();
    expect(adminActivityLog).toEqual([]);
  });

  test("an admin editing their own name, role unchanged, still works", async () => {
    const sent = await patch(`/${ADMIN.id}`, {
      name: "Ada Administrator",
      email: ADMIN.email,
      role: ADMIN.role,
    });

    expect(sent.status).toBe(200);
    expect(adminActivityLog).toEqual([
      expect.objectContaining({
        action: "user_edited",
        toValue: "Name: Ada Administrator",
      }),
    ]);
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

  // The assistant has no credential row and is not getting one; this link is
  // the door `rejectAssistant` exists to keep shut. Checked *before* the 404,
  // so the answer is 403 either way.
  test("refuses the assistant, and mails nothing", async () => {
    const sent = await post(`/${ASSISTANT.id}/invite`, {});

    expect(sent.status).toBe(403);
    expect(sent.body.error).toBe("The assistant's account cannot be changed");
    expect(requestPasswordReset).not.toHaveBeenCalled();
    expect(adminActivityLog).toEqual([]);
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

/* ── How many times one request reads the same row (#115) ────────────────── */

/**
 * `rejectAssistant` used to take an id and fetch `automated` itself, which left
 * every caller reading the same row a second time for the fields it actually
 * needed. It takes the row now, so these counts are the change — assert them,
 * or the next guard that takes an id puts the extra query back unnoticed.
 */
describe("reads per request", () => {
  test("PATCH reads twice: once before the write, once to observe it", async () => {
    await patch(`/${AGENT.id}`, {
      name: "Aaron A. Gent",
      email: AGENT.email,
      role: AGENT.role,
    });

    // The second is unavoidable — Better Auth lowercases `email` on the way
    // in, so the response has to come off the row rather than off the body.
    expect(userFindUniqueOrThrow).toHaveBeenCalledTimes(2);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  test("a refused PATCH reads once and stops", async () => {
    await patch(`/${ASSISTANT.id}`, {
      name: "Renamed",
      email: ASSISTANT.email,
      role: ASSISTANT.role,
    });

    expect(userFindUniqueOrThrow).toHaveBeenCalledTimes(1);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  test("POST /:id/invite reads once", async () => {
    await post(`/${AGENT.id}/invite`, {});

    expect(userFindUnique).toHaveBeenCalledTimes(1);
    expect(userFindUniqueOrThrow).not.toHaveBeenCalled();
  });

  test("DELETE reads the user once", async () => {
    await del(`/${AGENT.id}`);

    expect(userFindUnique).toHaveBeenCalledTimes(1);
    expect(userFindUniqueOrThrow).not.toHaveBeenCalled();
  });
});
