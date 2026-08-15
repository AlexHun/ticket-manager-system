/**
 * Unit tests for the handoff — who ends up with a ticket the assistant could not
 * finish. Both halves: the resolution rules in `./automation`, and the route in
 * `./routes/automation` that writes the setting they read.
 *
 * The rules are worth pinning down because every branch in them is a *fallback*.
 * Each fires on a day nobody planned for — an admin leaves, a chosen colleague
 * is deleted, a database predates the feature — none is reachable from the UI,
 * and getting one wrong means tickets pile up silently under somebody who is
 * gone. There is no visible failure to notice.
 *
 * **One file for both on purpose.** `bun test` runs every file in one process
 * and `mock.module` registrations are global, so two files mocking `./db` and
 * both importing `./automation` would fight over which fake the cached module
 * bound against — and the loser's tests would pass alone and fail in the suite.
 * Sharing one fake removes the question. `./routes/ai.test.ts` is unaffected: it
 * mocks the same paths but nothing it imports is imported here.
 *
 * The database is a small in-memory table rather than a switch over expected
 * arguments. That is a deliberate trade: a stub hand-wired to return "the admin"
 * would pass whatever `longestServingAdmin` ordered by, so the two assertions
 * that matter most — oldest admin wins, id breaks a tie — would be tautologies.
 * The fake implements only what the modules actually ask for: equality on `id`,
 * `role`, `automated` and `deletedAt`, and the two-key `orderBy`. Anything else
 * throws rather than quietly matching, so a query this file does not model shows
 * up as a failure instead of as a pass.
 *
 * What is *not* covered, and cannot be: `requireAdmin` is stubbed out, so
 * nothing below says anything about who may reach these routes. That guard is
 * one line on each route in the source, and a stubbed copy of it would only
 * assert that the stub runs.
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
import { HANDOFF_TARGET, USER_ROLE, type HandoffTarget } from "@ticket/shared";

/* ── The world behind the modules ────────────────────────────────────────── */

interface FakeUser {
  id: string;
  name: string;
  email: string;
  role: string;
  automated: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}

interface UserWhere {
  id?: string;
  role?: string;
  automated?: boolean;
  deletedAt?: null;
}

/** The user table, rewritten per test. */
let users: FakeUser[];

/**
 * What `automationSettings.findUnique` answers with. `null` is the case that
 * matters most — a deployment nobody has configured, which has no row at all.
 */
interface SettingsRow {
  target: HandoffTarget;
  handoffUser: { id: string; name: string; email: string } | null;
  updatedAt: Date;
  updatedByName: string | null;
}

let settingsRow: SettingsRow | null;

const KNOWN_KEYS = ["id", "role", "automated", "deletedAt"] as const;

function matches(user: FakeUser, where: UserWhere): boolean {
  for (const key of Object.keys(where)) {
    if (!KNOWN_KEYS.some((k) => k === key)) {
      throw new Error(
        `the fake user table does not model \`${key}\` — add it, or the test is asserting nothing`,
      );
    }
  }
  if (where.id !== undefined && user.id !== where.id) return false;
  if (where.role !== undefined && user.role !== where.role) return false;
  if (where.automated !== undefined && user.automated !== where.automated) {
    return false;
  }
  // The only form used, and the only one worth modelling: `deletedAt: null`
  // means "still on the roster".
  if (where.deletedAt === null && user.deletedAt !== null) return false;
  return true;
}

const findFirst = mock((args: { where: UserWhere }) => {
  const found = users
    .filter((u) => matches(u, args.where))
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );
  return Promise.resolve(found[0] ?? null);
});

const settingsFindUnique = mock(() => Promise.resolve(settingsRow));

interface UpsertArgs {
  where: { id: number };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

/**
 * Writes the row the way the real upsert would, so the response the route
 * assembles afterwards describes what was actually stored rather than what was
 * asked for. Without that, "PATCH answers with the new settings" would pass on a
 * route that saved nothing.
 */
const upsert = mock((args: UpsertArgs) => {
  const data = args.update;
  const handoffUserId = data.handoffUserId as string | null;
  const named = users.find((u) => u.id === handoffUserId) ?? null;
  settingsRow = {
    target: data.target as HandoffTarget,
    handoffUser: named
      ? { id: named.id, name: named.name, email: named.email }
      : null,
    updatedAt: new Date("2026-08-15T10:00:00.000Z"),
    updatedByName: data.updatedByName as string | null,
  };
  return Promise.resolve(settingsRow);
});

mock.module("./db", () => ({
  prisma: {
    user: { findFirst },
    automationSettings: { findUnique: settingsFindUnique, upsert },
  },
}));

/**
 * The session the audit columns are written from.
 *
 * The real `requireAdmin` pulls in `./auth`, which throws at import without
 * `BETTER_AUTH_SECRET`. **Deliberately identical to the stub in
 * `./routes/ai.test.ts`, headers and defaults and all** — `mock.module`
 * registrations are process-global and neither factory spreads the real module,
 * so whichever file `bun test` loads last owns `./middleware/auth` for every
 * router imported after it. Two stubs that disagreed about where the identity
 * comes from would make one file's tests pass alone and fail in the suite. If
 * one changes, change both.
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

mock.module("./middleware/auth", () => ({
  requireAuth: fakeGuard,
  requireAdmin: fakeGuard,
  sessionOf: (res: Response) => res.locals.session,
}));

const {
  assistantUser,
  readHandoffSettings,
  resolveHandoff,
  resolveHandoffUser,
} = await import("./automation");

const { automationRouter } = await import("./routes/automation");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

function user(overrides: Partial<FakeUser> & { id: string }): FakeUser {
  return {
    name: overrides.id,
    email: `${overrides.id}@example.com`,
    role: USER_ROLE.agent,
    automated: false,
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** The founding admin: earliest `createdAt`, so "longest-serving" means them. */
const FOUNDER = user({
  id: "u_founder",
  name: "Ada Admin",
  email: "admin@example.com",
  role: USER_ROLE.admin,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
});

/** A second admin, hired later. Never the answer while the founder is here. */
const SECOND_ADMIN = user({
  id: "u_second",
  name: "Bo Admin",
  role: USER_ROLE.admin,
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
});

const AGENT = user({
  id: "u_agent",
  name: "Aaron Agent",
  createdAt: new Date("2026-02-01T00:00:00.000Z"),
});

/** On the roster once, and gone since — the case a soft delete leaves behind. */
const GONE = user({
  id: "u_gone",
  name: "Gwen Gone",
  deletedAt: new Date("2026-07-01T00:00:00.000Z"),
});

const ASSISTANT = user({
  id: "u_assistant",
  name: "AI Assistant",
  email: "assistant@automation.invalid",
  automated: true,
  createdAt: new Date("2026-03-01T00:00:00.000Z"),
});

function pointAt(target: HandoffTarget, at: FakeUser | null = null) {
  settingsRow = {
    target,
    handoffUser: at ? { id: at.id, name: at.name, email: at.email } : null,
    updatedAt: new Date("2026-08-01T09:00:00.000Z"),
    updatedByName: "Ada Admin",
  };
}

function softDelete(id: string) {
  users = users.map((u) => (u.id === id ? { ...u, deletedAt: new Date() } : u));
}

beforeEach(() => {
  findFirst.mockClear();
  settingsFindUnique.mockClear();
  upsert.mockClear();
  users = [FOUNDER, SECOND_ADMIN, AGENT, GONE, ASSISTANT].map((u) => ({ ...u }));
  settingsRow = null;
});

/* ── Reading the setting ─────────────────────────────────────────────────── */

describe("readHandoffSettings", () => {
  test("a deployment with no row reads as the admin default, not as an error", async () => {
    // The case every other test rests on: nothing seeds this table, so "never
    // configured" has to be a working answer rather than a missing one.
    expect(await readHandoffSettings()).toEqual({
      target: HANDOFF_TARGET.admin,
      user: null,
      updatedAt: null,
      updatedByName: null,
    });
  });

  test("carries the audit trail back when a row exists", async () => {
    pointAt(HANDOFF_TARGET.user, AGENT);

    const settings = await readHandoffSettings();

    expect(settings.target).toBe(HANDOFF_TARGET.user);
    expect(settings.user?.id).toBe(AGENT.id);
    expect(settings.updatedByName).toBe("Ada Admin");
  });

  test("returns a soft-deleted target rather than pretending nobody was chosen", async () => {
    // The read deliberately does not filter. `resolveHandoffUser` is where the
    // fallback happens, because the settings screen has to be able to say "the
    // person you picked has left" — which it cannot do if the read hides them.
    pointAt(HANDOFF_TARGET.user, GONE);

    expect((await readHandoffSettings()).user?.id).toBe(GONE.id);
  });
});

/* ── Resolving it ────────────────────────────────────────────────────────── */

describe("resolveHandoffUser — the admin target", () => {
  test("with no row at all, lands on the longest-serving admin", async () => {
    expect(await resolveHandoffUser()).toMatchObject({ id: FOUNDER.id });
  });

  test("picks the oldest admin, not the newest and not an agent", async () => {
    pointAt(HANDOFF_TARGET.admin);

    const resolved = await resolveHandoffUser();

    expect(resolved?.id).toBe(FOUNDER.id);
    expect(resolved?.id).not.toBe(SECOND_ADMIN.id);
  });

  test("skips an admin who has been soft-deleted", async () => {
    softDelete(FOUNDER.id);

    expect(await resolveHandoffUser()).toMatchObject({ id: SECOND_ADMIN.id });
  });

  test("breaks a same-instant tie on id, so two tickets cannot disagree", async () => {
    const same = new Date("2025-01-01T00:00:00.000Z");
    users = [
      user({ id: "u_bbb", role: USER_ROLE.admin, createdAt: same }),
      user({ id: "u_aaa", role: USER_ROLE.admin, createdAt: same }),
    ];

    expect(await resolveHandoffUser()).toMatchObject({ id: "u_aaa" });
    expect(await resolveHandoffUser()).toMatchObject({ id: "u_aaa" });
  });

  test("is nobody when every admin has gone, rather than inventing one", async () => {
    // Unreachable through the API — `DELETE /api/users/:id` refuses admins —
    // but reachable in a database, and an unowned ticket somebody eventually
    // notices beats a ticket filed under a stranger.
    users = users.filter((u) => u.role !== USER_ROLE.admin);

    expect(await resolveHandoffUser()).toBeNull();
  });

  test("never falls back to the assistant", async () => {
    // The one wrong answer that would look right: it is a user row, it is on
    // the roster, and a ticket filed under it is work nothing will ever do.
    users = [ASSISTANT];

    expect(await resolveHandoffUser()).toBeNull();
  });
});

describe("resolveHandoffUser — a named person", () => {
  test("resolves to them", async () => {
    pointAt(HANDOFF_TARGET.user, AGENT);

    expect(await resolveHandoffUser()).toMatchObject({
      id: AGENT.id,
      name: "Aaron Agent",
    });
  });

  test("degrades to an admin once they are soft-deleted", async () => {
    // The FK's `SetNull` never fires on a soft delete, so the id stays
    // valid-looking forever. Without this check the setting would look
    // configured while every ticket landed on somebody who had left.
    pointAt(HANDOFF_TARGET.user, GONE);

    expect(await resolveHandoffUser()).toMatchObject({ id: FOUNDER.id });
  });

  test("degrades to an admin when the row is gone entirely", async () => {
    // A hard delete does fire `SetNull`, leaving `target: user` with no user.
    pointAt(HANDOFF_TARGET.user, null);

    expect(await resolveHandoffUser()).toMatchObject({ id: FOUNDER.id });
  });

  test("degrades to an admin rather than honouring the assistant", async () => {
    // The route rejects this at write time; this is the same rule at read time,
    // for a row written before that check existed or edited around it.
    pointAt(HANDOFF_TARGET.user, ASSISTANT);

    expect(await resolveHandoffUser()).toMatchObject({ id: FOUNDER.id });
  });
});

describe("resolveHandoffUser — unassigned", () => {
  test("is honoured exactly, with no fallback", async () => {
    pointAt(HANDOFF_TARGET.unassigned);

    expect(await resolveHandoffUser()).toBeNull();
  });

  test("does not go looking for an admin", async () => {
    pointAt(HANDOFF_TARGET.unassigned);

    await resolveHandoffUser();

    // The whole point of the target: the admin chose the old behaviour, so
    // nothing should be searching for somebody to overrule it with.
    expect(findFirst).not.toHaveBeenCalled();
  });

  test("still means nobody when a stale user id is attached", async () => {
    pointAt(HANDOFF_TARGET.unassigned, AGENT);

    expect(await resolveHandoffUser()).toBeNull();
  });
});

describe("resolveHandoff", () => {
  test("is the id of whoever resolveHandoffUser named", async () => {
    pointAt(HANDOFF_TARGET.user, AGENT);

    expect(await resolveHandoff()).toBe(AGENT.id);
  });

  test("is null when that is nobody", async () => {
    pointAt(HANDOFF_TARGET.unassigned);

    expect(await resolveHandoff()).toBeNull();
  });

  test("agrees with resolveHandoffUser on the fallback path too", async () => {
    // The two must walk the same branches — the job writes one and the settings
    // screen shows the other, and a disagreement is a page that reports a name
    // no ticket ever lands on.
    pointAt(HANDOFF_TARGET.user, GONE);

    expect(await resolveHandoff()).toBe(
      (await resolveHandoffUser())?.id ?? null,
    );
  });
});

describe("assistantUser", () => {
  test("finds the automated row", async () => {
    expect(await assistantUser()).toMatchObject({
      id: ASSISTANT.id,
      email: "assistant@automation.invalid",
    });
  });

  test("is null on a database seeded before the flag existed", async () => {
    // A survivable answer, not an error: the auto-reply still resolves the
    // ticket, it just has nobody to file it under.
    users = users.filter((u) => !u.automated);

    expect(await assistantUser()).toBeNull();
  });

  test("ignores a soft-deleted assistant", async () => {
    softDelete(ASSISTANT.id);

    expect(await assistantUser()).toBeNull();
  });

  test("takes the oldest if a second one is ever hand-inserted", async () => {
    // The invariant is held by the seed being the only writer, not by a
    // constraint — so the lookup is ordered, and which account tickets have
    // been filed under cannot change under a planner's whim.
    users = [
      user({ id: "u_zz", automated: true, createdAt: new Date("2026-07-01") }),
      ASSISTANT,
    ];

    expect(await assistantUser()).toMatchObject({ id: ASSISTANT.id });
  });
});

/* ── The route ───────────────────────────────────────────────────────────── */

let server: Server;
let origin: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/automation", automationRouter);
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
    settings?: {
      target: HandoffTarget;
      user: { id: string; name: string } | null;
      resolvedTo: { id: string; name: string } | null;
      assistant: { id: string; name: string } | null;
      updatedAt: string | null;
      updatedByName: string | null;
    };
    error?: string;
  };
}

/**
 * The signed-in admin, sent as headers rather than baked into the guard — see
 * the note on `fakeGuard`. These have to be explicit: if `./routes/ai.test.ts`
 * won the registration, the defaults are its agent and not ours.
 */
const AS_ADMIN = {
  "x-test-user": FOUNDER.id,
  "x-test-agent-name": FOUNDER.name,
  "x-test-user-email": FOUNDER.email,
};

async function get(): Promise<Sent> {
  const res = await fetch(`${origin}/api/automation`, { headers: AS_ADMIN });
  return { status: res.status, body: (await res.json()) as Sent["body"] };
}

async function patch(body: unknown): Promise<Sent> {
  const res = await fetch(`${origin}/api/automation/handoff`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...AS_ADMIN },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Sent["body"] };
}

/** What the most recent accepted write stored. */
function lastWrite(): Record<string, unknown> {
  const call = upsert.mock.calls.at(-1);
  if (!call) throw new Error("upsert was never called");
  return call[0].update;
}

describe("GET /api/automation", () => {
  test("a deployment with no row reports the admin default and who it means", async () => {
    const sent = await get();

    expect(sent.status).toBe(200);
    expect(sent.body.settings).toMatchObject({
      target: HANDOFF_TARGET.admin,
      user: null,
      resolvedTo: { id: FOUNDER.id, name: "Ada Admin" },
      updatedAt: null,
      updatedByName: null,
    });
  });

  test("carries the assistant, so the page can say when there isn't one", async () => {
    expect((await get()).body.settings?.assistant).toMatchObject({
      id: ASSISTANT.id,
    });
  });

  test("reports a missing assistant rather than omitting it", async () => {
    users = users.filter((u) => !u.automated);

    expect((await get()).body.settings?.assistant).toBeNull();
  });

  test("resolvedTo answers the question the target only implies", async () => {
    // `target: user` pointing at somebody deleted still reads as configured in
    // the picker. This is the field that tells the truth about where the next
    // ticket lands, and it has to be the server's answer rather than the
    // client's guess.
    pointAt(HANDOFF_TARGET.user, GONE);

    const settings = (await get()).body.settings;

    expect(settings?.user).toMatchObject({ id: GONE.id });
    expect(settings?.resolvedTo).toMatchObject({ id: FOUNDER.id });
  });
});

describe("PATCH /api/automation/handoff — the pair", () => {
  test("stores a named person", async () => {
    const sent = await patch({ target: HANDOFF_TARGET.user, userId: AGENT.id });

    expect(sent.status).toBe(200);
    expect(sent.body.settings).toMatchObject({
      target: HANDOFF_TARGET.user,
      user: { id: AGENT.id },
      resolvedTo: { id: AGENT.id },
    });
    expect(lastWrite()).toMatchObject({
      target: HANDOFF_TARGET.user,
      handoffUserId: AGENT.id,
    });
  });

  test("clears the stored id on any target but `user`", async () => {
    // Otherwise a switch to `admin` leaves the old person behind in the row,
    // looking like a decision that is no longer in force.
    await patch({ target: HANDOFF_TARGET.user, userId: AGENT.id });
    await patch({ target: HANDOFF_TARGET.admin, userId: null });

    expect(lastWrite()).toMatchObject({
      target: HANDOFF_TARGET.admin,
      handoffUserId: null,
    });
  });

  test("`unassigned` resolves to nobody", async () => {
    const sent = await patch({
      target: HANDOFF_TARGET.unassigned,
      userId: null,
    });

    expect(sent.status).toBe(200);
    expect(sent.body.settings?.resolvedTo).toBeNull();
  });

  test("refuses `user` with nobody named", async () => {
    const sent = await patch({ target: HANDOFF_TARGET.user, userId: null });

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe("Choose a person");
    expect(upsert).not.toHaveBeenCalled();
  });

  test("refuses a person attached to an automatic target", async () => {
    // An id under `admin` would sit in the database looking like a decision
    // while nothing read it.
    const sent = await patch({ target: HANDOFF_TARGET.admin, userId: AGENT.id });

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe(
      "Only the 'a specific person' target takes a user",
    );
    expect(upsert).not.toHaveBeenCalled();
  });

  test("refuses a target that is not one of the three", async () => {
    const sent = await patch({ target: "everyone", userId: null });

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe("Choose who picks these up");
    expect(upsert).not.toHaveBeenCalled();
  });

  test("refuses an empty body rather than writing a default", async () => {
    const sent = await patch({});

    expect(sent.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/automation/handoff — who may be named", () => {
  test("refuses somebody who is not on the roster", async () => {
    const sent = await patch({
      target: HANDOFF_TARGET.user,
      userId: "u_nobody",
    });

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe("Assignee not found");
    expect(upsert).not.toHaveBeenCalled();
  });

  test("refuses somebody soft-deleted since the page was drawn", async () => {
    // Same predicate `PATCH /api/tickets/:id/assignee` uses. Storing an id the
    // assignment route would refuse is how a setting comes to look configured
    // while silently falling back on every ticket.
    const sent = await patch({ target: HANDOFF_TARGET.user, userId: GONE.id });

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe("Assignee not found");
    expect(upsert).not.toHaveBeenCalled();
  });

  test("refuses the assistant", async () => {
    // Routing handed-back tickets to the thing that handed them back is the one
    // choice here that would quietly stop the queue moving.
    const sent = await patch({
      target: HANDOFF_TARGET.user,
      userId: ASSISTANT.id,
    });

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe("Assignee not found");
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/automation/handoff — the audit trail", () => {
  test("records the session's user, not anything from the body", async () => {
    await patch({
      target: HANDOFF_TARGET.admin,
      userId: null,
      updatedById: "u_someone_else",
      updatedByName: "Somebody Else",
    });

    expect(lastWrite()).toMatchObject({
      updatedById: FOUNDER.id,
      updatedByName: "Ada Admin",
    });
  });

  test("denormalises the name so it survives the account", async () => {
    await patch({ target: HANDOFF_TARGET.admin, userId: null });

    expect((await get()).body.settings?.updatedByName).toBe("Ada Admin");
  });
});
