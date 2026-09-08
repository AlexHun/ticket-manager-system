/**
 * Unit tests for `apps/api/src/routes/automation.ts` — the two routes behind the
 * `/pipeline` screen's handoff card: read the setting, and change it.
 *
 * **This file is the second half of a split** (#173). These tests lived in
 * `../automation.test.ts` alongside the resolution rules, and not by preference:
 * `mock.module`'s registry is one process wide, so two files that both replaced
 * `../db` with their own hand-written fake would bind the module to whichever
 * factory ran first and the loser's tests would pass alone and fail in the
 * suite. Converting onto `../test/pg` (ADR-0014) removes the reason — both
 * files now bind the specifier to the *same* client, which is a no-op — so each
 * file can cover the module it is named after. The rules `../automation.ts`
 * applies are over there; what is here is the router.
 *
 * **The database is real, and that is what the writes are asserted against.**
 * The fake this replaced had to re-implement the upsert well enough that the
 * response the route assembles afterwards described what was stored — its own
 * comment said so — which is a re-implementation of Postgres standing between
 * the assertion and the thing asserted. Three things follow from dropping it:
 *
 *   - **`automation_settings` and `automation_settings_revision` are read
 *     back as rows.** "Stores a named person" is a `findUnique`, not an
 *     inspection of a mock's last call.
 *   - **The pair commits together or not at all.** The route writes both in one
 *     `$transaction` (the array form), and the old `$transaction` fake was
 *     `Promise.all` over already-resolved mocks — it could not fail, so it could
 *     not distinguish a commit from a rollback. See the last two tests.
 *   - **The audit columns are foreign keys.** `updatedById` and `changedById`
 *     point at `user`, so the admin these requests are sent as has to be a
 *     seeded row rather than a string typed into a header constant — which is
 *     why the headers are derived from `COLLEAGUE`.
 *
 * What is *not* covered, and cannot be: `requireAdmin` is stubbed out, so
 * nothing below says anything about who may reach these routes. That guard is
 * one line on each route in the source, and a stubbed copy of it would only
 * assert that the stub runs.
 */

import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { HANDOFF_TARGET, type HandoffTarget } from "@ticket/shared";
import { COLLEAGUE, seedColleagues, type ColleagueKey } from "../test/fixtures";
import { prisma, resetDb } from "../test/pg";
import { serveRouter } from "../test/route-app";

/* ── The world behind the router ─────────────────────────────────────────── */

/**
 * The session the audit columns are written from.
 *
 * The real `requireAdmin` pulls in `../auth`, which throws at import without
 * `BETTER_AUTH_SECRET`. **Deliberately identical to the stubs in
 * `./ai.test.ts`, `./knowledge.test.ts`, `./activity.test.ts`,
 * `./tutorials.test.ts` and `./users.test.ts`, headers and defaults and all**
 * — `mock.module`
 * registrations are process-global and none of those factories spreads the real
 * module, so whichever file `bun test` loads last owns `../middleware/auth` for
 * every router imported after it. Two stubs that disagreed about where the
 * identity comes from would make one file's tests pass alone and fail in the
 * suite. If one changes, change them all.
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

const { automationRouter } = await import("./automation");
const { SETTINGS_ID } = await import("../automation");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

/** The founding admin — the one `resolvedTo` names on the `admin` target. */
const FOUNDER = COLLEAGUE.admin;
const SECOND_ADMIN = COLLEAGUE.otherAdmin;
const AGENT = COLLEAGUE.agent;
/** Soft-deleted in `beforeEach`: the person a stale picker still offers. */
const GONE = COLLEAGUE.other;
const ASSISTANT = COLLEAGUE.assistant;

/**
 * Headers naming a seeded colleague, rather than three strings beside them.
 *
 * `updatedById` and `changedById` are foreign keys, so a header that drifted
 * from the seeded row would surface as a constraint violation in whichever test
 * wrote first rather than as the identity mix-up it actually is.
 */
function headersFor(who: ColleagueKey) {
  const { id, name, email } = COLLEAGUE[who];
  return {
    "x-test-user": id,
    "x-test-agent-name": name,
    "x-test-user-email": email,
  };
}

const AS_ADMIN = headersFor("admin");

beforeEach(async () => {
  await resetDb();
  await seedColleagues("admin", "otherAdmin", "agent", "other", "assistant");
  await prisma.user.update({
    where: { id: GONE.id },
    data: { deletedAt: new Date("2026-07-01T00:00:00.000Z") },
  });
});

/* ── The app ─────────────────────────────────────────────────────────────── */

const url = serveRouter("/api/automation", automationRouter);

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

async function get(): Promise<Sent> {
  const res = await fetch(url(), { headers: AS_ADMIN });
  return { status: res.status, body: (await res.json()) as Sent["body"] };
}

/** The raw response, for the one test whose request is answered with an error page. */
function sendPatch(body: unknown, headers: Record<string, string> = AS_ADMIN) {
  return fetch(url("/handoff"), {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function patch(
  body: unknown,
  headers: Record<string, string> = AS_ADMIN,
): Promise<Sent> {
  const res = await sendPatch(body, headers);
  return { status: res.status, body: (await res.json()) as Sent["body"] };
}

/** The stored setting — one row, or none on a deployment nobody has configured. */
function settingsRow() {
  return prisma.automationSettings.findUnique({ where: { id: SETTINGS_ID } });
}

/** The whole trail, oldest first, as `GET /api/activity` would read it. */
function revisionRows() {
  return prisma.automationSettingsRevision.findMany({ orderBy: { id: "asc" } });
}

describe("GET /api/automation", () => {
  test("a deployment with no row reports the admin default and who it means", async () => {
    const sent = await get();

    expect(sent.status).toBe(200);
    expect(sent.body.settings).toMatchObject({
      target: HANDOFF_TARGET.admin,
      user: null,
      resolvedTo: { id: FOUNDER.id, name: FOUNDER.name },
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
    await prisma.user.deleteMany({ where: { automated: true } });

    expect((await get()).body.settings?.assistant).toBeNull();
  });

  test("resolvedTo answers the question the target only implies", async () => {
    // `target: user` pointing at somebody deleted still reads as configured in
    // the picker. This is the field that tells the truth about where the next
    // ticket lands, and it has to be the server's answer rather than the
    // client's guess.
    await prisma.automationSettings.create({
      data: {
        id: SETTINGS_ID,
        target: HANDOFF_TARGET.user,
        handoffUserId: GONE.id,
        updatedById: FOUNDER.id,
        updatedByName: FOUNDER.name,
      },
    });

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
    expect(await settingsRow()).toMatchObject({
      target: HANDOFF_TARGET.user,
      handoffUserId: AGENT.id,
    });
  });

  test("clears the stored id on any target but `user`", async () => {
    // Otherwise a switch to `admin` leaves the old person behind in the row,
    // looking like a decision that is no longer in force.
    await patch({ target: HANDOFF_TARGET.user, userId: AGENT.id });
    await patch({ target: HANDOFF_TARGET.admin, userId: null });

    expect(await settingsRow()).toMatchObject({
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
    expect(await settingsRow()).toBeNull();
  });

  test("refuses a person attached to an automatic target", async () => {
    // An id under `admin` would sit in the database looking like a decision
    // while nothing read it.
    const sent = await patch({
      target: HANDOFF_TARGET.admin,
      userId: AGENT.id,
    });

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe(
      "Only the 'a specific person' target takes a user",
    );
    expect(await settingsRow()).toBeNull();
  });

  test("refuses a target that is not one of the three", async () => {
    const sent = await patch({ target: "everyone", userId: null });

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe("Choose who picks these up");
    expect(await settingsRow()).toBeNull();
  });

  test("refuses an empty body rather than writing a default", async () => {
    const sent = await patch({});

    expect(sent.status).toBe(400);
    expect(await settingsRow()).toBeNull();
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
    expect(await settingsRow()).toBeNull();
  });

  test("refuses somebody soft-deleted since the page was drawn", async () => {
    // Same predicate `PATCH /api/tickets/:id/assignee` uses. Storing an id the
    // assignment route would refuse is how a setting comes to look configured
    // while silently falling back on every ticket.
    const sent = await patch({ target: HANDOFF_TARGET.user, userId: GONE.id });

    expect(sent.status).toBe(400);
    expect(sent.body.error).toBe("Assignee not found");
    expect(await settingsRow()).toBeNull();
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
    expect(await settingsRow()).toBeNull();
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

    expect(await settingsRow()).toMatchObject({
      updatedById: FOUNDER.id,
      updatedByName: FOUNDER.name,
    });
  });

  test("denormalises the name so it survives the account", async () => {
    await patch({ target: HANDOFF_TARGET.admin, userId: null });

    expect((await get()).body.settings?.updatedByName).toBe(FOUNDER.name);
  });
});

describe("PATCH /api/automation/handoff — the revision trail", () => {
  test("writes nothing on the first PATCH when it only restates the default", async () => {
    // No row exists yet, so `readHandoffSettings` reads as `{ admin, null }` —
    // the same thing this PATCH asks for. Nothing changed, so nothing should be
    // written to the trail even though this is the very first write. The
    // setting itself is still stored: "no revision" is not "no write".
    await patch({ target: HANDOFF_TARGET.admin, userId: null });

    expect(await revisionRows()).toHaveLength(0);
    expect(await settingsRow()).toMatchObject({ target: HANDOFF_TARGET.admin });
  });

  test("records the target changing, and who made the change", async () => {
    const sent = await patch({ target: HANDOFF_TARGET.user, userId: AGENT.id });

    expect(sent.status).toBe(200);
    const revisions = await revisionRows();
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      fromTarget: HANDOFF_TARGET.admin,
      toTarget: HANDOFF_TARGET.user,
      fromUserId: null,
      toUserId: AGENT.id,
      toUserName: AGENT.name,
      changedById: FOUNDER.id,
      changedByName: FOUNDER.name,
    });
  });

  test("records only the named person changing, target held at `user`", async () => {
    await patch({ target: HANDOFF_TARGET.user, userId: AGENT.id });
    await patch({ target: HANDOFF_TARGET.user, userId: SECOND_ADMIN.id });

    const revisions = await revisionRows();
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toMatchObject({
      fromTarget: HANDOFF_TARGET.user,
      toTarget: HANDOFF_TARGET.user,
      fromUserId: AGENT.id,
      fromUserName: AGENT.name,
      toUserId: SECOND_ADMIN.id,
      toUserName: SECOND_ADMIN.name,
    });
  });

  test("writes no second row when a PATCH re-sends the setting already in force", async () => {
    await patch({ target: HANDOFF_TARGET.user, userId: AGENT.id });
    await patch({ target: HANDOFF_TARGET.user, userId: AGENT.id });

    expect(await revisionRows()).toHaveLength(1);
  });

  test("commits the setting and its revision together", async () => {
    await patch({ target: HANDOFF_TARGET.user, userId: AGENT.id });

    // Both rows, and they agree: the trail says the setting moved to exactly
    // what the setting now is. Against the old fake these were two separate
    // arrays a mock pushed onto, so they could not disagree either — which is
    // why the interesting half of this claim is the rollback below.
    const stored = await settingsRow();
    const revisions = await revisionRows();

    expect(stored).toMatchObject({
      target: HANDOFF_TARGET.user,
      handoffUserId: AGENT.id,
    });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      toTarget: stored!.target,
      toUserId: stored!.handoffUserId,
    });
  });

  test("a change that cannot be audited takes the setting back with it", async () => {
    // The admin's session outlived the row it names — the account was hard
    // deleted while the page was open. Both halves of the transaction write
    // that id (`automation_settings.updatedById` and
    // `automation_settings_revision.changedById`, both foreign keys), so the
    // batch is refused as a unit and the setting that was in force stands, with
    // its trail one row long. The fake could not make this assertion at all:
    // nothing in it could fail, and its `$transaction` was `Promise.all` over
    // mocks that had already mutated their arrays.
    //
    // Be exact about what it shows, though. The violation lands on the *first*
    // statement, so what is pinned here is that a refused write leaves no
    // trace — not that a failing revision can drag a committed setting back.
    // This schema offers no way to provoke that half: every other column the
    // revision writes is either validated by the route (`toUserId`) or read off
    // a row that a foreign key already guarantees (`fromUserId`).
    //
    // A green run therefore prints one `prisma:error … Foreign key constraint
    // violated`. That line is this test working, not a failure that got through.
    await patch({ target: HANDOFF_TARGET.unassigned, userId: null });

    const res = await sendPatch(
      { target: HANDOFF_TARGET.user, userId: AGENT.id },
      {
        "x-test-user": "u_deleted",
        "x-test-agent-name": "Gone Admin",
        "x-test-user-email": "gone@example.com",
      },
    );

    expect(res.status).toBe(500);
    expect(await settingsRow()).toMatchObject({
      target: HANDOFF_TARGET.unassigned,
      updatedByName: FOUNDER.name,
    });
    expect(await revisionRows()).toHaveLength(1);
  });

  test("writes nothing at all when the request is refused", async () => {
    await patch({ target: HANDOFF_TARGET.user, userId: "u_nobody" });

    expect(await settingsRow()).toBeNull();
    expect(await revisionRows()).toHaveLength(0);
  });
});
