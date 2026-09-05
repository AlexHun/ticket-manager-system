/**
 * A regression guard for `CORPUS_SELECT` in `./knowledge-base` — the query
 * that decides what an unattended reply is even allowed to see.
 *
 * The pending-revision approval step (#23-#26) changes how an article's
 * content *gets* onto the live row, but must never change what the live-row
 * query hands to a prompt: no `internalNote`, no approval bookkeeping, and no
 * cache — the corpus is read fresh per answered ticket. This file exists so a
 * column added to that query anywhere in this chain fails a test instead of
 * failing quietly in production.
 *
 * **Since #170 it asserts that against real rows** (`../test/pg`, ADR-0014).
 * It used to capture the arguments `findMany` was called with and compare them
 * to a literal — which is a test of the call, not of the corpus, and passes
 * just as happily if Prisma stops honouring `select`. Now the internal note is
 * a column on a seeded article and the assertion is that it is not in what
 * comes back; the archived and withheld articles are rows the query has to
 * exclude rather than a `where` clause copied into an `expect`; and the
 * ordering is asserted by inserting the articles in the wrong order and
 * getting them back in the right one.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { TICKET_CATEGORY } from "@ticket/shared";
import { Prisma, prisma, resetDb } from "../test/pg";

mock.module("../db", () => ({ Prisma, prisma }));

const { autoReplyArticleCount, autoReplyArticles } = await import(
  "./knowledge-base"
);

/* ── Fixtures ────────────────────────────────────────────────────────────── */

/**
 * An article, `autoReply` and live unless a test says otherwise — the opposite
 * of the schema's default, because the corpus is what nearly every test here is
 * about and the exceptions are what each one names.
 *
 * Every article carries an internal note. There is no such thing as a corpus
 * test on this module that would not want one: the note being absent from the
 * *result* is the property, so an article without one cannot demonstrate it.
 */
function seedArticle(
  id: string,
  overrides: Partial<{
    title: string;
    body: string;
    autoReply: boolean;
    archived: boolean;
  }> = {},
) {
  return prisma.knowledgeArticle.create({
    data: {
      id,
      title: "How do I reset my password?",
      category: TICKET_CATEGORY.Technical,
      body: "Use the 'forgot password' link on the sign-in page.",
      internalNote: "Never promise a same-day reset — the queue can run to 24h.",
      autoReply: true,
      archived: false,
      ...overrides,
    },
  });
}

/** The four states an article can be in, of which exactly one is the corpus. */
async function seedTheWholeShelf() {
  await seedArticle("KB-001");
  await seedArticle("KB-002", { archived: true });
  await seedArticle("KB-003", { autoReply: false });
  await seedArticle("KB-004", { autoReply: false, archived: true });
}

beforeEach(async () => {
  await resetDb();
});

describe("autoReplyArticles", () => {
  test("hands back exactly the columns a prompt may see — never internalNote", async () => {
    await seedArticle("KB-001", { title: "Refund policy" });

    // `toEqual` on the whole row rather than a check per column: the risk this
    // file exists for is a column *added* to the select, so an assertion that
    // only names the four expected fields would pass through the very change
    // it is here to catch.
    expect(await autoReplyArticles()).toEqual([
      {
        id: "KB-001",
        title: "Refund policy",
        category: TICKET_CATEGORY.Technical,
        body: "Use the 'forgot password' link on the sign-in page.",
      },
    ]);
  });

  test("only asks for the live, auto-replyable corpus", async () => {
    await seedTheWholeShelf();

    expect((await autoReplyArticles()).map((a) => a.id)).toEqual(["KB-001"]);
  });

  test("orders by id, which is what keeps the prompt prefix stable for caching", async () => {
    await seedArticle("KB-003");
    await seedArticle("KB-001");
    await seedArticle("KB-002");

    expect((await autoReplyArticles()).map((a) => a.id)).toEqual([
      "KB-001",
      "KB-002",
      "KB-003",
    ]);
  });

  test("re-reads the corpus per call — an edit lands without a restart", async () => {
    await seedArticle("KB-001", { body: "Old answer." });
    await autoReplyArticles();

    await prisma.knowledgeArticle.update({
      where: { id: "KB-001" },
      data: { body: "New answer." },
    });

    // The module's header calls the absence of a cache the point of the table
    // existing at all: an admin edit that appears to save and changes nothing
    // until the next deploy is the worst failure this screen has. Only a real
    // database can show the second call seeing the first one's edit.
    expect((await autoReplyArticles())[0]?.body).toBe("New answer.");
  });

  test("an unseeded deployment gets an empty corpus, not an error", async () => {
    expect(await autoReplyArticles()).toEqual([]);
  });
});

describe("autoReplyArticleCount", () => {
  test("counts the same corpus the articles come from", async () => {
    await seedTheWholeShelf();
    await seedArticle("KB-005");

    // Asserted against `autoReplyArticles` as well as against a number,
    // because the whole reason this is a second query is that it is allowed to
    // be cheaper — and the way that goes wrong is the two drifting apart.
    expect(await autoReplyArticleCount()).toBe(2);
    expect(await autoReplyArticleCount()).toBe(
      (await autoReplyArticles()).length,
    );
  });

  test("reports zero on an empty corpus, which is what disables the feature", async () => {
    await seedArticle("KB-001", { autoReply: false });

    expect(await autoReplyArticleCount()).toBe(0);
  });
});
