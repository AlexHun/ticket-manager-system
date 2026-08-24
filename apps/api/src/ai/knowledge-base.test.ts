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
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

interface FindManyArgs {
  where: Record<string, unknown>;
  select: Record<string, boolean>;
  orderBy: Record<string, string>;
}

let lastFindManyArgs: FindManyArgs | undefined;

const findMany = mock((args: FindManyArgs) => {
  lastFindManyArgs = args;
  return Promise.resolve([]);
});
const count = mock(() => Promise.resolve(0));

mock.module("../db", () => ({
  prisma: { knowledgeArticle: { findMany, count } },
}));

const { autoReplyArticleCount, autoReplyArticles } = await import(
  "./knowledge-base"
);

beforeEach(() => {
  lastFindManyArgs = undefined;
  findMany.mockClear();
  count.mockClear();
});

describe("autoReplyArticles", () => {
  test("selects exactly the columns a prompt may see — never internalNote", async () => {
    await autoReplyArticles();

    expect(lastFindManyArgs?.select).toEqual({
      id: true,
      title: true,
      category: true,
      body: true,
    });
  });

  test("only asks for the live, auto-replyable corpus", async () => {
    await autoReplyArticles();

    expect(lastFindManyArgs?.where).toEqual({
      archived: false,
      autoReply: true,
    });
  });

  test("orders by id, which is what keeps the prompt prefix stable for caching", async () => {
    await autoReplyArticles();

    expect(lastFindManyArgs?.orderBy).toEqual({ id: "asc" });
  });
});

describe("autoReplyArticleCount", () => {
  test("counts the same corpus without reading any article body", async () => {
    await autoReplyArticleCount();

    expect(count).toHaveBeenCalledWith({
      where: { archived: false, autoReply: true },
    });
  });
});
