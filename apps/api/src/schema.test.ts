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
import {
  EVAL_COUNTERS,
  KNOWLEDGE_REVISION_ACTION,
  TICKET_CATEGORY,
} from "@ticket/shared";
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

describe("the eval counter set", () => {
  /**
   * The declaration in `@ticket/shared` and the two eval tables agree.
   *
   * `EVAL_COUNTERS` is where the harness's per-case counters are named once, so
   * the outcome interface, the case-result write, the run aggregate and the run
   * update all derive from it instead of restating it. The Prisma schema is its
   * own language and cannot derive from a TypeScript declaration, which leaves
   * exactly one gap the compiler cannot close: a counter declared with no
   * column behind it, or a column added without being declared.
   *
   * Both directions are asserted, and the second is the one worth having. A
   * counter with no column fails loudly the first time a run writes; a *column*
   * nobody declared is silent — it stays zero for every run, and a metric taken
   * over it reads as a measurement rather than as an absence.
   */
  const numericColumns = async (table: string): Promise<string[]> => {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = ${table}
        AND data_type IN ('integer', 'double precision')
      ORDER BY column_name
    `;

    return rows.map((row) => row.column_name);
  };

  test("every declared counter has a column on eval_case_result", async () => {
    const columns = new Set(await numericColumns("eval_case_result"));

    const undeclared = Object.keys(EVAL_COUNTERS).filter(
      (counter) => !columns.has(counter),
    );

    expect(undeclared).toEqual([]);
  });

  test("every declared counter has a column on eval_run", async () => {
    const columns = new Set(await numericColumns("eval_run"));

    const undeclared = Object.values(EVAL_COUNTERS).filter(
      (column) => !columns.has(column),
    );

    expect(undeclared).toEqual([]);
  });

  test("no counter column on either table is undeclared", async () => {
    // The numeric columns that are not counters, named rather than inferred,
    // and the two tables do not exclude the same things. `repeats` is a
    // counter on a case result - how many times that case was answered - and
    // on a run it is the setting the run was started with, stamped so an old
    // row still says what its rates are over. It is summed from nothing.
    const notCaseCounters = new Set(["id", "runId"]);
    const notRunCounters = new Set(["id", "repeats"]);

    const caseColumns = (await numericColumns("eval_case_result")).filter(
      (column) => !notCaseCounters.has(column),
    );
    const runColumns = (await numericColumns("eval_run")).filter(
      (column) => !notRunCounters.has(column),
    );

    expect(caseColumns).toEqual([...Object.keys(EVAL_COUNTERS)].sort());
    expect(runColumns).toEqual([...Object.values(EVAL_COUNTERS)].sort());
  });
});
