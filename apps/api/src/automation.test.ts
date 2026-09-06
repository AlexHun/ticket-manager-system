/**
 * Unit tests for `./automation` — who ends up with a ticket the assistant could
 * not finish, and the diff that records that choice changing.
 *
 * The rules are worth pinning down because every branch in them is a *fallback*.
 * Each fires on a day nobody planned for — an admin leaves, a chosen colleague
 * is deleted, a database predates the feature — none is reachable from the UI,
 * and getting one wrong means tickets pile up silently under somebody who is
 * gone. There is no visible failure to notice.
 *
 * **This file used to hold two suites, and does not any more** (#173). It
 * covered `./routes/automation` as well, for a reason `docs/standards/testing.md`
 * stated outright: `mock.module`'s registry is one process wide, so two files
 * that both replaced `./db` with a hand-written fake would bind the module to
 * whichever factory was registered first, and the loser's tests would pass
 * alone and fail in the suite. ADR-0014 removed the reason rather than the
 * workaround — every converted file binds `./db` to the *same* client from
 * `./test/pg`, so two files sharing it is a no-op instead of a stranger's stub.
 * The router's tests are now in `./routes/automation.test.ts`, next to the
 * router, and each file covers the module it is named after.
 *
 * **The database is real** (`./test/pg`, ADR-0014), and here that is not a
 * detail. What this file used to assert against was a small in-memory user
 * table with a hand-written `matches()` and a hand-written two-key sort, which
 * left the two claims that matter most as claims about the test file:
 *
 *   - **"the oldest admin wins" and "id breaks a tie"** are
 *     `longestServingAdmin`'s `orderBy: [{ createdAt: "asc" }, { id: "asc" }]`,
 *     executed by Postgres. Against the fake they were a `.sort()` twenty lines
 *     above the assertion, and would have passed with the `orderBy` deleted
 *     from the source.
 *   - **`readHandoffSettings` loads the chosen person through the relation**, so
 *     "a soft-deleted target still comes back" is a real join across a real
 *     foreign key — the case the settings screen exists to report.
 *
 * The fake did have one virtue worth naming, since it is gone: it threw on any
 * `where` key it did not model, so a query it did not understand failed rather
 * than quietly matching. A schema does that better, and for every column.
 *
 * `./middleware/auth` is deliberately *not* stubbed here — nothing in
 * `./automation` imports it, and a stub registered by a file that does not need
 * one is a stub every file loaded afterwards gets anyway, the registry being
 * process-wide. `./routes/automation.test.ts` registers it, identically to the
 * other route tests.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { HANDOFF_TARGET, USER_ROLE, type HandoffTarget } from "@ticket/shared";
import { COLLEAGUE, seedColleagues } from "./test/fixtures";
import { Prisma, dbCalls, prisma, resetDb } from "./test/pg";

/* ── The world behind the module ─────────────────────────────────────────── */

mock.module("./db", () => ({ Prisma, prisma }));

const {
  assistantUser,
  handoffChange,
  readHandoffSettings,
  resolveHandoff,
  resolveHandoffUser,
  ASSISTANT_EMAIL,
  SETTINGS_ID,
} = await import("./automation");

/* ── Fixtures ────────────────────────────────────────────────────────────── */

/** The founding admin — earliest `createdAt`, so "longest-serving" means them. */
const FOUNDER = COLLEAGUE.admin;
/** A second admin, hired later. Never the answer while the founder is here. */
const SECOND_ADMIN = COLLEAGUE.otherAdmin;
const AGENT = COLLEAGUE.agent;
/** On the roster once, and gone since — the case a soft delete leaves behind. */
const GONE = COLLEAGUE.other;
const ASSISTANT = COLLEAGUE.assistant;

const DEPARTED_AT = new Date("2026-07-01T00:00:00.000Z");

function softDelete(id: string) {
  return prisma.user.update({ where: { id }, data: { deletedAt: DEPARTED_AT } });
}

/**
 * Point the setting at a target, as a stored row.
 *
 * `updatedById` is a foreign key, so the audit columns name a seeded colleague
 * rather than a string invented beside them — which is the point of going
 * through `COLLEAGUE` at all.
 */
function pointAt(target: HandoffTarget, at: { id: string } | null = null) {
  return prisma.automationSettings.create({
    data: {
      id: SETTINGS_ID,
      target,
      handoffUserId: at?.id ?? null,
      updatedById: FOUNDER.id,
      updatedByName: FOUNDER.name,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  await seedColleagues("admin", "otherAdmin", "agent", "other", "assistant");
  // Olivia is this file's departed colleague, and departed from the start: the
  // fallbacks below are about a setting that still names her.
  await softDelete(GONE.id);
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
    await pointAt(HANDOFF_TARGET.user, AGENT);

    const settings = await readHandoffSettings();

    expect(settings.target).toBe(HANDOFF_TARGET.user);
    expect(settings.user?.id).toBe(AGENT.id);
    expect(settings.updatedByName).toBe(FOUNDER.name);
  });

  test("returns a soft-deleted target rather than pretending nobody was chosen", async () => {
    // The read deliberately does not filter. `resolveHandoffUser` is where the
    // fallback happens, because the settings screen has to be able to say "the
    // person you picked has left" — which it cannot do if the read hides them.
    await pointAt(HANDOFF_TARGET.user, GONE);

    expect((await readHandoffSettings()).user?.id).toBe(GONE.id);
  });
});

/* ── Resolving it ────────────────────────────────────────────────────────── */

describe("resolveHandoffUser — the admin target", () => {
  test("with no row at all, lands on the longest-serving admin", async () => {
    expect(await resolveHandoffUser()).toMatchObject({ id: FOUNDER.id });
  });

  test("picks the oldest admin, not the newest and not an agent", async () => {
    await pointAt(HANDOFF_TARGET.admin);

    const resolved = await resolveHandoffUser();

    expect(resolved?.id).toBe(FOUNDER.id);
    expect(resolved?.id).not.toBe(SECOND_ADMIN.id);
  });

  test("skips an admin who has been soft-deleted", async () => {
    await softDelete(FOUNDER.id);

    expect(await resolveHandoffUser()).toMatchObject({ id: SECOND_ADMIN.id });
  });

  test("breaks a same-instant tie on id, so two tickets cannot disagree", async () => {
    // `u_bbb` is inserted first, so a lookup that had lost its `orderBy` and
    // fell back on the order Postgres happened to return rows in would answer
    // with the wrong one.
    await prisma.user.deleteMany({ where: { role: USER_ROLE.admin } });
    const sameInstant = new Date("2025-06-01T00:00:00.000Z");
    await prisma.user.createMany({
      data: [
        {
          id: "u_bbb",
          name: "Bea Both",
          email: "bea@example.com",
          role: USER_ROLE.admin,
          createdAt: sameInstant,
        },
        {
          id: "u_aaa",
          name: "Ann Both",
          email: "ann@example.com",
          role: USER_ROLE.admin,
          createdAt: sameInstant,
        },
      ],
    });

    expect(await resolveHandoffUser()).toMatchObject({ id: "u_aaa" });
    expect(await resolveHandoffUser()).toMatchObject({ id: "u_aaa" });
  });

  test("is nobody when every admin has gone, rather than inventing one", async () => {
    // Unreachable through the API — `DELETE /api/users/:id` refuses admins —
    // but reachable in a database, and an unowned ticket somebody eventually
    // notices beats a ticket filed under a stranger.
    await prisma.user.updateMany({
      where: { role: USER_ROLE.admin },
      data: { deletedAt: DEPARTED_AT },
    });

    expect(await resolveHandoffUser()).toBeNull();
  });

  test("never falls back to the assistant", async () => {
    // The one wrong answer that would look right: it is a user row, it is on
    // the roster, and a ticket filed under it is work nothing will ever do.
    //
    // The row left standing is an automated **admin**, which the seeded
    // assistant is not — it is an agent, so `longestServingAdmin`'s
    // `role: admin` filter would exclude it on its own and the `automated:
    // false` clause beside it would never carry any weight. Deleting that
    // clause from the source has to fail this test, and against an automated
    // agent it would not. (The old fake had the same hole, and the assistant
    // being an agent is exactly why it went unnoticed.)
    await prisma.user.deleteMany({ where: { automated: false } });
    await prisma.user.update({
      where: { id: ASSISTANT.id },
      data: { role: USER_ROLE.admin },
    });

    expect(await resolveHandoffUser()).toBeNull();
  });
});

describe("resolveHandoffUser — a named person", () => {
  test("resolves to them", async () => {
    await pointAt(HANDOFF_TARGET.user, AGENT);

    expect(await resolveHandoffUser()).toMatchObject({
      id: AGENT.id,
      name: AGENT.name,
    });
  });

  test("degrades to an admin once they are soft-deleted", async () => {
    // The FK's `SetNull` never fires on a soft delete, so the id stays
    // valid-looking forever. Without this check the setting would look
    // configured while every ticket landed on somebody who had left.
    await pointAt(HANDOFF_TARGET.user, GONE);

    expect(await resolveHandoffUser()).toMatchObject({ id: FOUNDER.id });
  });

  test("degrades to an admin when the row is gone entirely", async () => {
    // A hard delete does fire `SetNull`, leaving `target: user` with no user.
    await pointAt(HANDOFF_TARGET.user, null);

    expect(await resolveHandoffUser()).toMatchObject({ id: FOUNDER.id });
  });

  test("degrades to an admin rather than honouring the assistant", async () => {
    // The route rejects this at write time; this is the same rule at read time,
    // for a row written before that check existed or edited around it.
    await pointAt(HANDOFF_TARGET.user, ASSISTANT);

    expect(await resolveHandoffUser()).toMatchObject({ id: FOUNDER.id });
  });
});

describe("resolveHandoffUser — unassigned", () => {
  test("is honoured exactly, with no fallback", async () => {
    await pointAt(HANDOFF_TARGET.unassigned);

    expect(await resolveHandoffUser()).toBeNull();
  });

  test("does not go looking for an admin", async () => {
    await pointAt(HANDOFF_TARGET.unassigned);

    await resolveHandoffUser();

    // The whole point of the target: the admin chose the old behaviour, so
    // nothing should be searching for somebody to overrule it with. `dbCalls`
    // counts since `resetDb()`, and the seeding above goes through `createMany`
    // and `update` — so a count here could only be this call's.
    expect(dbCalls("user.findFirst")).toBe(0);
  });

  test("still means nobody when a stale user id is attached", async () => {
    await pointAt(HANDOFF_TARGET.unassigned, AGENT);

    expect(await resolveHandoffUser()).toBeNull();
  });
});

describe("resolveHandoff", () => {
  test("is the id of whoever resolveHandoffUser named", async () => {
    await pointAt(HANDOFF_TARGET.user, AGENT);

    expect(await resolveHandoff()).toBe(AGENT.id);
  });

  test("is null when that is nobody", async () => {
    await pointAt(HANDOFF_TARGET.unassigned);

    expect(await resolveHandoff()).toBeNull();
  });

  test("agrees with resolveHandoffUser on the fallback path too", async () => {
    // The two must walk the same branches — the job writes one and the settings
    // screen shows the other, and a disagreement is a page that reports a name
    // no ticket ever lands on.
    await pointAt(HANDOFF_TARGET.user, GONE);

    expect(await resolveHandoff()).toBe(
      (await resolveHandoffUser())?.id ?? null,
    );
  });
});

describe("assistantUser", () => {
  test("finds the automated row", async () => {
    // Against `ASSISTANT_EMAIL` rather than the literal: the fixture's address
    // and the one `prisma/seed.ts` writes are the same string in two places,
    // and this is the assertion that notices if they stop being.
    expect(await assistantUser()).toMatchObject({
      id: ASSISTANT.id,
      email: ASSISTANT_EMAIL,
    });
  });

  test("is null on a database seeded before the flag existed", async () => {
    // A survivable answer, not an error: the auto-reply still resolves the
    // ticket, it just has nobody to file it under.
    await prisma.user.deleteMany({ where: { automated: true } });

    expect(await assistantUser()).toBeNull();
  });

  test("ignores a soft-deleted assistant", async () => {
    await softDelete(ASSISTANT.id);

    expect(await assistantUser()).toBeNull();
  });

  test("takes the oldest if a second one is ever hand-inserted", async () => {
    // The invariant is held by the seed being the only writer, not by a
    // constraint — so the lookup is ordered, and which account tickets have
    // been filed under cannot change under a planner's whim.
    await prisma.user.create({
      data: {
        id: "u_zz",
        name: "Second Assistant",
        email: "second@automation.invalid",
        automated: true,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    });

    expect(await assistantUser()).toMatchObject({ id: ASSISTANT.id });
  });
});

/* ── The revision diff — touches nothing, needs nothing ──────────────────── */

describe("handoffChange", () => {
  test("is null when nothing moved", () => {
    expect(
      handoffChange(
        { target: HANDOFF_TARGET.admin, user: null },
        { target: HANDOFF_TARGET.admin, user: null },
      ),
    ).toBeNull();
  });

  test("is null when the same person is re-sent under `user`", () => {
    expect(
      handoffChange(
        {
          target: HANDOFF_TARGET.user,
          user: { id: AGENT.id, name: AGENT.name },
        },
        {
          target: HANDOFF_TARGET.user,
          user: { id: AGENT.id, name: AGENT.name },
        },
      ),
    ).toBeNull();
  });

  test("records the target moving, with no user on either side", () => {
    expect(
      handoffChange(
        { target: HANDOFF_TARGET.admin, user: null },
        { target: HANDOFF_TARGET.unassigned, user: null },
      ),
    ).toEqual({
      fromTarget: HANDOFF_TARGET.admin,
      toTarget: HANDOFF_TARGET.unassigned,
      fromUserId: null,
      fromUserName: null,
      toUserId: null,
      toUserName: null,
    });
  });

  test("records swapping the named person, target unchanged", () => {
    expect(
      handoffChange(
        {
          target: HANDOFF_TARGET.user,
          user: { id: AGENT.id, name: AGENT.name },
        },
        {
          target: HANDOFF_TARGET.user,
          user: { id: SECOND_ADMIN.id, name: SECOND_ADMIN.name },
        },
      ),
    ).toEqual({
      fromTarget: HANDOFF_TARGET.user,
      toTarget: HANDOFF_TARGET.user,
      fromUserId: AGENT.id,
      fromUserName: AGENT.name,
      toUserId: SECOND_ADMIN.id,
      toUserName: SECOND_ADMIN.name,
    });
  });

  test("records leaving `user`, keeping who it used to name", () => {
    expect(
      handoffChange(
        {
          target: HANDOFF_TARGET.user,
          user: { id: AGENT.id, name: AGENT.name },
        },
        { target: HANDOFF_TARGET.admin, user: null },
      ),
    ).toMatchObject({
      fromUserId: AGENT.id,
      fromUserName: AGENT.name,
      toUserId: null,
      toUserName: null,
    });
  });
});
