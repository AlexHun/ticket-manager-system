/**
 * Invariants the Prisma schema carries, exercised against the real database
 * (`./test/pg`, ADR-0014).
 *
 * These are the rules Postgres enforces rather than any module does — a
 * cascade, a `SetNull`, a `Restrict`, a partial index — so there is no module
 * under test and nothing here mocks anything. That is what earns the file its
 * own place: a schema rule asserted from inside a route test reads as though
 * the route were responsible for it, and the next person to change the route
 * has no way to tell which of its assertions would survive the route being
 * deleted.
 *
 * A route that *writes* one of these columns is still tested where it lives —
 * `routes/tutorials.test.ts` covers `PUT /:pageKey` recording its editor. What
 * belongs here is what happens to that row afterwards, with no request
 * involved.
 *
 * Deliberately scoped to relations whose behaviour the app depends on and
 * cannot see. This is not a place to restate the schema; a test here should
 * name the thing that breaks if the rule goes.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { prisma, resetDb } from "./test/pg";
import { COLLEAGUE, seedColleagues } from "./test/fixtures";

beforeEach(async () => {
  await resetDb();
  await seedColleagues("admin");
});

describe("TutorialContent.updatedBy", () => {
  test("SetNull keeps the byline after the editor's account is deleted", async () => {
    // The relation is `onDelete: SetNull` beside a *denormalised*
    // `updatedByName`, and the schema says why: the byline has to survive the
    // editor's account being deleted. Without the denormalised copy the admin
    // editor would show "last edited by —" for every tutorial an ex-colleague
    // wrote; without `SetNull` the delete would fail outright.
    await prisma.tutorialContent.create({
      data: {
        pageKey: "dashboard",
        title: "Welcome to the dashboard",
        steps: [{ title: "Filters", body: "Use the range picker up top." }],
        updatedById: COLLEAGUE.admin.id,
        updatedByName: COLLEAGUE.admin.name,
      },
    });

    await prisma.user.delete({ where: { id: COLLEAGUE.admin.id } });

    expect(
      await prisma.tutorialContent.findUniqueOrThrow({
        where: { pageKey: "dashboard" },
        select: { updatedById: true, updatedByName: true },
      }),
    ).toEqual({ updatedById: null, updatedByName: COLLEAGUE.admin.name });
  });
});
