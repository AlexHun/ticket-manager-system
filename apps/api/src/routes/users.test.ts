/**
 * Unit tests for `./users` — the account-management router ADR-0011 and
 * ADR-0009 built: `POST /` creates a colleague with no password and invites
 * them, `PATCH /:id` edits one, `POST /:id/invite` sends the invitation again,
 * and `DELETE /:id` soft-deletes, bans, signs out and unassigns in a single
 * transaction. The admin-activity audit trail is written beside every one of
 * them, so every action it can record — `user_created`, `user_invited` (initial
 * and resend), `user_edited`, `role_changed`, `user_deleted` — is covered here
 * along with the two things `PATCH` refuses outright.
 *
 * `./admin-activity`'s pure helper (`userEditChanges`) is exercised directly at
 * the top, with no mocking, so a failure in it shows up next to its cause.
 *
 * ## The seam is the database, and `../auth` is on the real side of it (#172)
 *
 * This was the last file in the suite mocking the Prisma client (#152), and the
 * last one whose `../auth` was an object of `mock()`s. Both are gone. `../db` is
 * bound to `../test/pg` — a real Prisma client on a real Postgres in this
 * process — and `../auth` is **the real `auth.ts`**, Better Auth and its Prisma
 * adapter included, pointed at that same database.
 *
 * The ticket asked for that decision to be made and recorded. It is: *real*,
 * and the reason is that the old fake could not test the two claims this router
 * exists to make.
 *
 *   - **ADR-0011's claim is an absence.** `POST /` creates an account with no
 *     password, which in Better Auth means no `credential` row — that absence
 *     is what stops anyone but the owner ever knowing the password, and it is
 *     what `sendResetPassword` reads to tell an invitation from a reset. A fake
 *     `createUser` can only assert that it was called; the real one lets the
 *     `account` table answer, which is where the claim actually lives.
 *   - **ADR-0009's outbox row is written by `auth.ts`, not by this router.**
 *     The invitation is `sendResetPassword` writing an `OutboundEmail`, two
 *     modules below the route. Asserting it against a stub would have been
 *     asserting the stub — the row would have been composed in this file, by
 *     this file, and read back by this file. Against the real thing the
 *     invitation's wording, its `kind` and the live link in it are the shipped
 *     ones.
 *
 * It also removes a class of quiet agreement. The old fake lowercased `email`
 * because Better Auth does, and #118 turned on exactly that: remove the
 * normalisation and the fake would have kept passing. There is nothing left
 * here to keep in step.
 *
 * **What it costs.** `auth.ts` reads two environment variables at import and
 * throws without them, so they are set below before it is loaded; and Better
 * Auth's admin plugin refuses `createUser`/`adminUpdateUser` without a real
 * admin session, so `beforeAll` mints one — one scrypt hash and one sign-in,
 * about 700ms, once for the file. `beforeEach` replays the session *row* rather
 * than signing in again, because `resetDb()` truncates it; the cookie is signed
 * over the token, so re-inserting the same token keeps it valid.
 *
 * ## Mocks
 *
 * Three, and each is here for a reason the others are not.
 *
 * `../db` is the shared client every converted file binds — no longer a hazard,
 * since sharing it is the point (`docs/standards/testing.md`).
 *
 * `../middleware/auth` is **deliberately identical** to the one in
 * `../automation.test.ts`, `./ai.test.ts`, `./knowledge.test.ts` and
 * `./activity.test.ts`, for the reason given there: the `mock.module` registry
 * is one process wide, so if one changes, change all of them. Note the seam
 * this leaves: the *route's* guard is stubbed, as in every other route test,
 * while Better Auth's own permission check is not — which is why a request here
 * carries both the `x-test-*` headers and a genuine session cookie, and why the
 * two must name the same admin.
 *
 * `../jobs/send-email` is stubbed through `../test/send-email`, shared with
 * `../outbound.test.ts` so that one factory serves both files. Without it the
 * invitation cannot be observed at all: the real `enqueueEmail` wraps its insert
 * in a transaction and then calls `getBoss()`, which throws with no queue
 * started and takes the row down with it. That module's header has the rest.
 */

import type { NextFunction, Request, Response } from "express";
import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  OUTBOUND_EMAIL_KIND,
  TICKET_ACTOR_KIND,
  USER_ROLE,
} from "@ticket/shared";
import { userEditChanges } from "../admin-activity";
import { COLLEAGUE, seedColleagues, seedTicket } from "../test/fixtures";
import { Prisma, dbCalls, prisma, resetDb } from "../test/pg";
import { serveRouter } from "../test/route-app";
import { stubSendEmail } from "../test/send-email";

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

/**
 * Set before `../auth` is imported, because it reads both at module scope and
 * throws without them. Assigned rather than defaulted with `??=`, so the file
 * does not quietly run against whatever a developer's `.env` happens to hold —
 * `TRUSTED_ORIGINS[0]` becomes `appOrigin`, which is the origin every
 * invitation link below is checked against.
 *
 * This is the one file in the suite that loads `auth.ts`, so nothing else is
 * reading these.
 */
process.env.TRUSTED_ORIGINS = "http://localhost:5173";
process.env.BETTER_AUTH_SECRET =
  "users-route-test-secret-of-at-least-32-chars";

mock.module("../db", () => ({ Prisma, prisma }));
await stubSendEmail();

/**
 * Deliberately identical to `../automation.test.ts`, `./ai.test.ts`,
 * `./knowledge.test.ts` and `./activity.test.ts` — see the file header.
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

const { appOrigin, auth } = await import("../auth");
const { usersRouter } = await import("./users");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const ADMIN = COLLEAGUE.admin;
const AGENT = COLLEAGUE.agent;
const OTHER_ADMIN = COLLEAGUE.otherAdmin;
const ASSISTANT = COLLEAGUE.assistant;

/** Only ever used to mint the sessions below. Nothing asserts on it. */
const PASSWORD = "correct-horse-battery-staple";

/**
 * The admin's session, minted once and replayed after every `resetDb()`.
 *
 * Better Auth's admin plugin answers `UNAUTHORIZED` to `createUser` and
 * `adminUpdateUser` whenever headers are present and no session is behind them,
 * and this router always forwards the request's headers — so there is no way to
 * exercise it without one. Signing in per test would cost a scrypt verify each
 * time; the row is cheap to re-insert, and the cookie is signed over the token
 * rather than over the row, so the same token stays valid.
 */
let sessionRow: Prisma.SessionUncheckedCreateInput;
let sessionCookie = "";

beforeAll(async () => {
  await resetDb();
  await seedColleagues("admin");

  const ctx = await auth.$context;
  await ctx.internalAdapter.linkAccount({
    accountId: ADMIN.id,
    providerId: "credential",
    password: await ctx.password.hash(PASSWORD),
    userId: ADMIN.id,
  });

  const res = await auth.api.signInEmail({
    body: { email: ADMIN.email, password: PASSWORD },
    asResponse: true,
  });
  if (res.status !== 200) {
    throw new Error(`could not mint a session: ${res.status}`);
  }

  // `set-cookie` may carry several cookies in one header; split on the comma
  // that precedes a `name=` and keep the name and value of each.
  sessionCookie = (res.headers.get("set-cookie") ?? "")
    .split(/,(?=[^;=]+=)/)
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");

  sessionRow = await prisma.session.findFirstOrThrow({
    where: { userId: ADMIN.id },
  });
});

beforeEach(async () => {
  await resetDb();
  await seedColleagues("admin", "agent", "otherAdmin", "assistant");
  await prisma.session.create({ data: sessionRow });
});

/* ── The route ───────────────────────────────────────────────────────────── */

const url = serveRouter("/api/users", usersRouter);

/**
 * Both halves of "the admin is making this request": the `x-test-*` headers the
 * stubbed route guard reads, and the real cookie Better Auth's own check reads.
 * They name the same account on purpose — the audit trail's actor comes from
 * the first and the permission from the second, and a test where those differed
 * would be describing a request that cannot happen.
 */
const asAdmin = () => ({
  "x-test-user": ADMIN.id,
  "x-test-agent-name": ADMIN.name,
  "x-test-user-email": ADMIN.email,
  cookie: sessionCookie,
});

interface Sent {
  status: number;
  body: {
    error?: string;
    user?: { id: string; name: string; email: string; role: string };
  };
}

async function send(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Sent> {
  const res = await fetch(url(path), {
    method,
    headers: { "content-type": "application/json", ...asAdmin() },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

const post = (path: string, body: unknown) => send("POST", path, body);
const patch = (path: string, body: unknown) => send("PATCH", path, body);
const del = (path: string) => send("DELETE", path);

/* ── Reading the tables back ─────────────────────────────────────────────── */

function adminActivityRows() {
  return prisma.adminActivity.findMany({ orderBy: { id: "asc" } });
}

function userRow(id: string) {
  return prisma.user.findFirst({ where: { id } });
}

/**
 * Wait for the outbox row an invitation produces.
 *
 * It has to be a wait rather than a read. `POST /` does not await
 * `requestPasswordReset` at all — an admin is holding a spinner and a failure
 * there is recoverable by resending — and even on `POST /:id/invite`, which
 * does await it, `sendResetPassword` starts its own un-awaited task so that the
 * time it takes cannot be used to probe whether an address exists. So the row
 * lands a tick or two after the response, and polling is what that shape leaves
 * available.
 */
async function waitForOutbox(count = 1) {
  const deadline = Date.now() + 2000;
  for (;;) {
    const rows = await prisma.outboundEmail.findMany({
      orderBy: { id: "asc" },
    });
    if (rows.length >= count) return rows;
    if (Date.now() > deadline) {
      throw new Error(
        `no outbox row after 2s (wanted ${count}, saw ${rows.length})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Give the un-awaited invitation task a chance to write, so "nothing was
 *  sent" means nothing was sent rather than nothing has been sent *yet*. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * The link an invitation carries, asserted in two halves because it is two
 * things joined.
 *
 * The href itself is **Better Auth's** `/reset-password/:token` on this API,
 * not the app's page: that endpoint is what consumes the single-use token, and
 * only then does it forward the browser on. Where it forwards is the
 * `callbackURL`, which is the app origin `auth.ts` derives from
 * `TRUSTED_ORIGINS` — checked against that same list before it is honoured, so
 * a bad value fails closed — with `invite=1` so the page can say "welcome"
 * rather than "reset your password".
 *
 * Worth pinning both. A link that skipped the API would land somebody on a form
 * holding a token nothing had validated, and a `callbackURL` pointing at this
 * process would send a colleague to a JSON endpoint.
 */
function expectInviteLink(textBody: string | undefined) {
  expect(textBody).toContain("/api/auth/reset-password/");
  expect(textBody).toContain(
    `callbackURL=${encodeURIComponent(`${appOrigin}/reset-password?invite=1`)}`,
  );
}

/* ── POST /api/users ─────────────────────────────────────────────────────── */

describe("POST /api/users — the account", () => {
  test("creates a real row, in the state the roster expects", async () => {
    const sent = await post("/", {
      name: "Nadia New",
      email: "nadia@example.com",
    });

    expect(sent.status).toBe(201);
    expect(await userRow(sent.body.user?.id ?? "")).toMatchObject({
      name: "Nadia New",
      email: "nadia@example.com",
      role: USER_ROLE.agent,
      // ADR-0010: no verification flow exists, so the column is set here rather
      // than leaving a badge on the roster nothing could ever clear.
      emailVerified: true,
      // Never from this route — only `prisma/seed.ts` writes it (ADR-0002).
      automated: false,
      deletedAt: null,
    });
  });

  /**
   * ADR-0011, stated as the absence it actually is: the account has no
   * `credential` row, so no password to it has ever been known to anyone. The
   * old fake could not say this — it had no `account` table to leave empty —
   * and the same absence is what `sendResetPassword` reads to decide that the
   * mail it is about to write is an invitation rather than a reset.
   */
  test("creates no credential account — there is no password to know", async () => {
    const sent = await post("/", {
      name: "Nadia New",
      email: "nadia@example.com",
    });

    expect(
      await prisma.account.findMany({
        where: { userId: sent.body.user?.id, providerId: "credential" },
      }),
    ).toEqual([]);
  });

  // Nothing was broken here before #118 — Better Auth lowercases what it
  // stores. `createUserSchema` normalises anyway so that both forms send the
  // same thing, and so that the address in the invitation is the one in the row.
  test("an address typed with capitals is created lowercase", async () => {
    const sent = await post("/", {
      name: "Nadia New",
      email: "Nadia.New@Example.com",
    });

    expect(sent.status).toBe(201);
    expect(sent.body.user?.email).toBe("nadia.new@example.com");
    expect(await userRow(sent.body.user?.id ?? "")).toMatchObject({
      email: "nadia.new@example.com",
    });
  });
});

describe("POST /api/users — user_created and the initial user_invited", () => {
  test("writes both rows, actor is the signed-in admin", async () => {
    const sent = await post("/", {
      name: "Nadia New",
      email: "nadia@example.com",
    });

    expect(sent.status).toBe(201);
    expect(await adminActivityRows()).toEqual([
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

describe("POST /api/users — the invitation (ADR-0009)", () => {
  /**
   * The outbox row, written by `auth.ts`'s `sendResetPassword` and not by this
   * router. It is `invitation` rather than `passwordReset` because the account
   * has no credential row, which is the derivation ADR-0011 leans on: no caller
   * has to say which of the two flows this is.
   */
  test("an invitation lands in the outbox, addressed to the new colleague", async () => {
    const sent = await post("/", {
      name: "Nadia New",
      email: "nadia@example.com",
    });
    expect(sent.status).toBe(201);

    const [invitation] = await waitForOutbox();
    expect(invitation).toMatchObject({
      kind: OUTBOUND_EMAIL_KIND.invitation,
      toEmail: "nadia@example.com",
      toName: "Nadia New",
      subject: "You have been given a support desk account",
      // Auth mail carries no thread message; only a reply does.
      messageId: null,
    });
    expectInviteLink(invitation?.textBody);
  });

  /**
   * The row is `queued` and nothing here sent it. On a deployment with no mail
   * provider — which is every deployment today — that is the delivery
   * mechanism rather than a degraded one: an admin reads the link off
   * `/outbox`.
   */
  test("the invitation is left queued for the outbox worker", async () => {
    await post("/", { name: "Nadia New", email: "nadia@example.com" });

    const [invitation] = await waitForOutbox();
    expect(invitation?.status).toBe("queued");
    expect(invitation?.sentAt).toBeNull();
  });
});

/* ── PATCH /api/users/:id ────────────────────────────────────────────────── */

describe("PATCH /api/users/:id — user_edited", () => {
  test("no row when the PATCH re-sends what the account already had", async () => {
    const sent = await patch(`/${AGENT.id}`, {
      name: AGENT.name,
      email: AGENT.email,
      role: AGENT.role,
    });

    expect(sent.status).toBe(200);
    expect(await adminActivityRows()).toEqual([]);
  });

  /**
   * The target name is the one the account *had*, not the one it was given —
   * every row goes through `writeAdminActivity`, which takes the account read
   * before the mutation rather than two columns a call site assembled from the
   * request body. This route is the only one where the two differ, which is why
   * it is the one that used to get it wrong: a rename was filed under the new
   * name, so the feed said "Ada Admin edited Aaron A. Gent" about the moment
   * there was no Aaron A. Gent yet.
   */
  test("one row, labelled, for a name-only change, filed under the old name", async () => {
    await patch(`/${AGENT.id}`, {
      name: "Aaron A. Gent",
      email: AGENT.email,
      role: AGENT.role,
    });

    expect(await adminActivityRows()).toEqual([
      expect.objectContaining({
        action: "user_edited",
        fromValue: `Name: ${AGENT.name}`,
        toValue: "Name: Aaron A. Gent",
        actorId: ADMIN.id,
        targetUserId: AGENT.id,
        targetUserName: AGENT.name,
      }),
    ]);
    // And the rename really happened, which is what the response is read off.
    expect(await userRow(AGENT.id)).toMatchObject({ name: "Aaron A. Gent" });
  });

  test("two rows when name and email both change in one PATCH", async () => {
    await patch(`/${AGENT.id}`, {
      name: "Aaron A. Gent",
      email: "aaron.new@example.com",
      role: AGENT.role,
    });

    const rows = await adminActivityRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.toValue)).toEqual([
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
    expect(await adminActivityRows()).toEqual([]);
    expect(await userRow(ASSISTANT.id)).toMatchObject({ name: ASSISTANT.name });
  });
});

describe("PATCH /api/users/:id — the address, lowercased on both sides (#118)", () => {
  /**
   * Better Auth lowercases the address on the way in, so re-sending
   * `AGENT@EXAMPLE.COM` over a stored `agent@example.com` changes nothing —
   * and used to write a `user_edited` row saying it had. `updateUserSchema`
   * normalises now, so the route diffs like against like. This is the assertion
   * the old fake could only make about itself: it lowercased because the real
   * adapter does, so removing the normalisation would have left it green.
   */
  test("no row when only the capitals of the email changed", async () => {
    const sent = await patch(`/${AGENT.id}`, {
      name: AGENT.name,
      email: AGENT.email.toUpperCase(),
      role: AGENT.role,
    });

    expect(sent.status).toBe(200);
    expect(await adminActivityRows()).toEqual([]);
    // And the row was not quietly rewritten either.
    expect(sent.body.user?.email).toBe(AGENT.email);
    expect(await userRow(AGENT.id)).toMatchObject({ email: AGENT.email });
  });

  // The other half of the same bug: a real edit, typed with capitals. The row
  // it writes has to say what the database will hold, not what was typed.
  test("a genuine email change is recorded as it is stored", async () => {
    await patch(`/${AGENT.id}`, {
      name: AGENT.name,
      email: "Aaron.New@Example.com",
      role: AGENT.role,
    });

    expect(await adminActivityRows()).toEqual([
      expect.objectContaining({
        action: "user_edited",
        fromValue: `Email: ${AGENT.email}`,
        toValue: "Email: aaron.new@example.com",
      }),
    ]);
    expect(await userRow(AGENT.id)).toMatchObject({
      email: "aaron.new@example.com",
    });
  });
});

describe("PATCH /api/users/:id — what the schema refuses", () => {
  test("rejects a body with no role at all — this is not a partial update", async () => {
    const sent = await patch(`/${AGENT.id}`, {
      name: "Aaron A. Gent",
      email: AGENT.email,
    });

    expect(sent.status).toBe(400);
    expect(await adminActivityRows()).toEqual([]);
    expect(await userRow(AGENT.id)).toMatchObject({ name: AGENT.name });
  });

  test("rejects a role the app does not have", async () => {
    const sent = await patch(`/${AGENT.id}`, {
      name: AGENT.name,
      email: AGENT.email,
      role: "superadmin",
    });

    expect(sent.status).toBe(400);
    expect(await adminActivityRows()).toEqual([]);
    expect(await userRow(AGENT.id)).toMatchObject({ role: USER_ROLE.agent });
  });
});

describe("PATCH /api/users/:id — role_changed", () => {
  test("one row for a promotion, and the role really moves", async () => {
    const sent = await patch(`/${AGENT.id}`, {
      name: AGENT.name,
      email: AGENT.email,
      role: USER_ROLE.admin,
    });

    expect(sent.status).toBe(200);
    expect(sent.body.user?.role).toBe(USER_ROLE.admin);
    expect(await userRow(AGENT.id)).toMatchObject({ role: USER_ROLE.admin });
    expect(await adminActivityRows()).toEqual([
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
    expect(await userRow(OTHER_ADMIN.id)).toMatchObject({
      role: USER_ROLE.agent,
    });
    expect(await adminActivityRows()).toEqual([
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
    expect(await adminActivityRows()).toEqual([]);
    expect(await userRow(ADMIN.id)).toMatchObject({ role: USER_ROLE.admin });
  });

  test("an admin editing their own name, role unchanged, still works", async () => {
    const sent = await patch(`/${ADMIN.id}`, {
      name: "Ada Administrator",
      email: ADMIN.email,
      role: ADMIN.role,
    });

    expect(sent.status).toBe(200);
    expect(await adminActivityRows()).toEqual([
      expect.objectContaining({
        action: "user_edited",
        toValue: "Name: Ada Administrator",
      }),
    ]);
  });
});

/* ── POST /api/users/:id/invite ──────────────────────────────────────────── */

describe("POST /api/users/:id/invite — user_invited, resend", () => {
  test("records toValue: resend, not initial", async () => {
    const sent = await post(`/${AGENT.id}/invite`, {});

    expect(sent.status).toBe(204);
    expect(await adminActivityRows()).toEqual([
      expect.objectContaining({
        action: "user_invited",
        toValue: "resend",
        actorId: ADMIN.id,
        targetUserId: AGENT.id,
        targetUserName: AGENT.name,
      }),
    ]);
  });

  /**
   * The resend writes its own outbox row, and it is still an `invitation`:
   * `AGENT` has no credential account, so this colleague never accepted the
   * first one. That is `auth.ts` deriving the flow from the account row rather
   * than being told which of the three doors the caller came through.
   */
  test("a second invitation lands in the outbox, with a fresh link", async () => {
    await post(`/${AGENT.id}/invite`, {});

    const [invitation] = await waitForOutbox();
    expect(invitation).toMatchObject({
      kind: OUTBOUND_EMAIL_KIND.invitation,
      toEmail: AGENT.email,
      toName: AGENT.name,
      subject: "You have been given a support desk account",
    });
    expectInviteLink(invitation?.textBody);
  });

  /**
   * The other side of the same derivation: a colleague who *has* set a password
   * is not being invited, so the same call writes a `passwordReset` with the
   * other wording. One mechanism, and the account row decides which it is.
   */
  test("a colleague who already has a password gets a reset, not an invitation", async () => {
    const ctx = await auth.$context;
    await ctx.internalAdapter.linkAccount({
      accountId: AGENT.id,
      providerId: "credential",
      password: await ctx.password.hash(PASSWORD),
      userId: AGENT.id,
    });

    await post(`/${AGENT.id}/invite`, {});

    const [mail] = await waitForOutbox();
    expect(mail).toMatchObject({
      kind: OUTBOUND_EMAIL_KIND.passwordReset,
      toEmail: AGENT.email,
      subject: "Reset your support desk password",
    });
  });

  // The assistant has no credential row and is not getting one; this link is
  // the door `rejectAssistant` exists to keep shut. Checked *before* the 404,
  // so the answer is 403 either way.
  test("refuses the assistant, and mails nothing", async () => {
    const sent = await post(`/${ASSISTANT.id}/invite`, {});

    expect(sent.status).toBe(403);
    expect(sent.body.error).toBe("The assistant's account cannot be changed");
    await settle();
    expect(await prisma.outboundEmail.findMany()).toEqual([]);
    expect(await adminActivityRows()).toEqual([]);
  });

  test("404s a deleted colleague, and mails nothing", async () => {
    await prisma.user.update({
      where: { id: AGENT.id },
      data: { deletedAt: new Date(), banned: true },
    });

    const sent = await post(`/${AGENT.id}/invite`, {});

    expect(sent.status).toBe(404);
    await settle();
    expect(await prisma.outboundEmail.findMany()).toEqual([]);
    expect(await adminActivityRows()).toEqual([]);
  });

  test("404s an id that is not an account at all", async () => {
    const sent = await post("/u_nobody/invite", {});

    expect(sent.status).toBe(404);
    expect(await adminActivityRows()).toEqual([]);
  });
});

/* ── DELETE /api/users/:id ───────────────────────────────────────────────── */

describe("DELETE /api/users/:id", () => {
  const TICKET_ID = 1;
  const OTHER_TICKET_ID = 2;

  /** A colleague mid-shift: signed in, and holding a ticket. */
  async function agentAtWork() {
    await prisma.session.create({
      data: {
        id: "sess_agent",
        token: "token_agent",
        userId: AGENT.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await seedTicket({ id: TICKET_ID, assignedToId: AGENT.id, status: "Open" });
    await seedTicket({
      id: OTHER_TICKET_ID,
      assignedToId: OTHER_ADMIN.id,
      status: "Open",
    });
  }

  /**
   * The whole of the multi-table transaction, in one test, because that is what
   * it is: five statements that either all happened or none did. Against the
   * old fake `$transaction` — `Promise.all` over an array — this said nothing
   * at all; every row below was written by a hand-rolled mock into an array
   * this file then read back.
   */
  test("soft-deletes, bans, signs out and unassigns, all together", async () => {
    await agentAtWork();

    const sent = await del(`/${AGENT.id}`);
    expect(sent.status).toBe(204);

    expect(await userRow(AGENT.id)).toMatchObject({
      deletedAt: expect.any(Date),
      banned: true,
      banReason: "Deleted by admin",
    });
    // Deleting the sessions is what signs the user out; the soft delete alone
    // only stops future sign-ins.
    expect(
      await prisma.session.findMany({ where: { userId: AGENT.id } }),
    ).toEqual([]);

    // `Ticket.assignedTo` is `SetNull`, but this is a *soft* delete — the row
    // stays, so the foreign key never fires and the clearing has to be done by
    // hand. Without it the ticket points at somebody `/assignees` will not
    // offer and the assignment guard will not re-select: a dead end.
    expect(
      await prisma.ticket.findUniqueOrThrow({ where: { id: TICKET_ID } }),
    ).toMatchObject({ assignedToId: null });
    // Somebody else's ticket is untouched — the `updateMany`'s `where` is real
    // now, and matched by Postgres rather than by a filter in this file.
    expect(
      await prisma.ticket.findUniqueOrThrow({ where: { id: OTHER_TICKET_ID } }),
    ).toMatchObject({ assignedToId: OTHER_ADMIN.id });
  });

  /**
   * One row per orphaned ticket, actor the admin who deleted the account rather
   * than the agent who lost it — the actor is whoever caused the change. This
   * is the entry that stops a ticket going unassigned overnight with nothing in
   * its history to say why.
   */
  test("writes an assignee_changed row on each orphaned ticket", async () => {
    await agentAtWork();

    await del(`/${AGENT.id}`);

    const activity = await prisma.ticketActivity.findMany({
      orderBy: { id: "asc" },
    });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      ticketId: TICKET_ID,
      action: "assignee_changed",
      // Captured before the delete — the account is about to be gone, which is
      // exactly what the denormalised name is for.
      fromValue: AGENT.name,
      toValue: null,
      actorKind: TICKET_ACTOR_KIND.agent,
      actorId: ADMIN.id,
      actorName: ADMIN.name,
    });
  });

  test("writes one user_deleted row, in the same transaction as the delete", async () => {
    await agentAtWork();

    const sent = await del(`/${AGENT.id}`);

    expect(sent.status).toBe(204);
    expect(await adminActivityRows()).toEqual([
      expect.objectContaining({
        action: "user_deleted",
        actorId: ADMIN.id,
        actorName: ADMIN.name,
        targetUserId: AGENT.id,
        targetUserName: AGENT.name,
      }),
    ]);
  });

  test("refuses an admin target, and changes nothing", async () => {
    const sent = await del(`/${OTHER_ADMIN.id}`);

    expect(sent.status).toBe(403);
    expect(sent.body.error).toBe("Admin users cannot be deleted");
    expect(await userRow(OTHER_ADMIN.id)).toMatchObject({ deletedAt: null });
    expect(await adminActivityRows()).toEqual([]);
  });

  // Deleting it would clear the assignee on every ticket the machine ever
  // resolved, and nothing but the seed can put the row back.
  test("refuses the assistant, and changes nothing", async () => {
    const sent = await del(`/${ASSISTANT.id}`);

    expect(sent.status).toBe(403);
    expect(sent.body.error).toBe("The assistant's account cannot be deleted");
    expect(await userRow(ASSISTANT.id)).toMatchObject({ deletedAt: null });
    expect(await adminActivityRows()).toEqual([]);
  });

  test("404s an account that is already deleted", async () => {
    await prisma.user.update({
      where: { id: AGENT.id },
      data: { deletedAt: new Date() },
    });

    const sent = await del(`/${AGENT.id}`);

    expect(sent.status).toBe(404);
    expect(await adminActivityRows()).toEqual([]);
  });
});

/* ── GET /api/users ──────────────────────────────────────────────────────── */

describe("GET /api/users", () => {
  async function roster() {
    const res = await fetch(url("/"), { headers: asAdmin() });
    return (await res.json()) as { users: { id: string; automated: boolean }[] };
  }

  test("lists everyone still on the desk, oldest first", async () => {
    const { users } = await roster();

    expect(users.map((user) => user.id)).toEqual([
      ADMIN.id,
      AGENT.id,
      OTHER_ADMIN.id,
      ASSISTANT.id,
    ]);
    // The assistant is on the roster and flagged, because an admin should be
    // able to see the thing tickets are being filed under (ADR-0002).
    expect(users.at(-1)).toMatchObject({ automated: true });
  });

  test("a deleted colleague drops off it", async () => {
    await del(`/${AGENT.id}`);

    const { users } = await roster();
    expect(users.map((user) => user.id)).not.toContain(AGENT.id);
  });
});

/* ── How many times one request reads the same row (#115) ────────────────── */

/**
 * `rejectAssistant` used to take an id and fetch `automated` itself, which left
 * every caller reading the same row a second time for the fields it actually
 * needed. It takes the row now, so these counts are the change — assert them,
 * or the next guard that takes an id puts the extra query back unnoticed.
 *
 * The counts come from `../test/pg`'s `dbCalls`, which is what replaced the
 * per-method `mock()`s they used to be read off; the header on it explains why
 * it is a counting proxy rather than a client extension. Better Auth's own
 * reads do not land in them — its Prisma adapter goes through `findFirst` — so
 * `user.findUnique` still counts this router's reads and nothing else. The one
 * exception is called out where it happens.
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
    expect(dbCalls("user.findUniqueOrThrow")).toBe(2);
    expect(dbCalls("user.findUnique")).toBe(0);
  });

  test("a refused PATCH reads once and stops", async () => {
    await patch(`/${ASSISTANT.id}`, {
      name: "Renamed",
      email: ASSISTANT.email,
      role: ASSISTANT.role,
    });

    expect(dbCalls("user.findUniqueOrThrow")).toBe(1);
    expect(dbCalls("user.findUnique")).toBe(0);
  });

  /**
   * Two, and the second is not this router's: `sendResetPassword` reads the
   * account again to refuse the assistant and anyone deleted — the guard on the
   * public `/request-password-reset` door, which never comes through this file.
   * The route's own read is still the single one #115 is about.
   */
  test("POST /:id/invite reads once here, and once more in auth.ts", async () => {
    await post(`/${AGENT.id}/invite`, {});
    await waitForOutbox();

    expect(dbCalls("user.findUnique")).toBe(2);
    expect(dbCalls("user.findUniqueOrThrow")).toBe(0);
  });

  test("DELETE reads the user once", async () => {
    await del(`/${AGENT.id}`);

    expect(dbCalls("user.findUnique")).toBe(1);
    expect(dbCalls("user.findUniqueOrThrow")).toBe(0);
  });
});
