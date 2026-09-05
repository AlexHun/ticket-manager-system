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
import { KNOWLEDGE_REVISION_ACTION, TICKET_CATEGORY } from "@ticket/shared";
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

describe("KnowledgeArticleRevision.article", () => {
  /** An article and the `created` revision that `routes/knowledge.ts` writes
   *  in the same transaction — the shape every article in this system has. */
  async function seedArticleWithRevision() {
    await prisma.knowledgeArticle.create({
      data: {
        id: "KB-001",
        title: "How do I reset my password?",
        category: TICKET_CATEGORY.Technical,
        body: "Use the 'forgot password' link on the sign-in page.",
      },
    });
    await prisma.knowledgeArticleRevision.create({
      data: {
        articleId: "KB-001",
        action: KNOWLEDGE_REVISION_ACTION.created,
        title: "How do I reset my password?",
        category: TICKET_CATEGORY.Technical,
        body: "Use the 'forgot password' link on the sign-in page.",
        autoReply: false,
        archived: false,
        editorId: COLLEAGUE.admin.id,
        editorName: COLLEAGUE.admin.name,
        editorEmail: COLLEAGUE.admin.email,
      },
    });
  }

  test("Restrict is what makes an article undeletable, not the router declining to offer it", async () => {
    // `message.citedArticleIds` points at these ids from replies already
    // sitting in customers' threads, so an article is archived and never
    // deleted. `routes/knowledge.ts` has no delete route, but that is a
    // router being careful; this is the guarantee. Every article carries a
    // `created` revision from the transaction that inserted it, so the
    // constraint applies to all of them by construction.
    await seedArticleWithRevision();

    await expect(async () => {
      await prisma.knowledgeArticle.delete({ where: { id: "KB-001" } });
    }).toThrow(/violates RESTRICT setting/);
    expect(await prisma.knowledgeArticle.count()).toBe(1);
  });

  test("SetNull keeps the audit trail readable after the editor's account is deleted", async () => {
    // The same denormalisation as the tutorial byline above, for a stronger
    // reason: "why did we tell them that?" is asked weeks later, and an audit
    // log that forgets who acted the moment they leave is not an audit log.
    // Without `SetNull` the account delete would fail outright instead.
    await seedArticleWithRevision();

    await prisma.user.delete({ where: { id: COLLEAGUE.admin.id } });

    expect(
      await prisma.knowledgeArticleRevision.findFirstOrThrow({
        select: { editorId: true, editorName: true, editorEmail: true },
      }),
    ).toEqual({
      editorId: null,
      editorName: COLLEAGUE.admin.name,
      editorEmail: COLLEAGUE.admin.email,
    });
  });
});
