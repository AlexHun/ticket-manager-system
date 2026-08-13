import type { TicketCategory } from "@ticket/shared";
import { prisma } from "../db";

/**
 * The knowledge-base corpus, as a prompt is allowed to see it.
 *
 * This used to read `apps/api/knowledge-base.md` at first use and cache it for
 * the life of the process. The file argued for itself in its own header —
 * reviewable in a pull request, diffable, and beyond the reach of anyone who
 * talks their way into an admin session — and it set exactly one condition for
 * moving into the database: *"A table can come later; it should come with an
 * audit log."* It has one. Every write to `KnowledgeArticle` records a
 * `KnowledgeArticleRevision` in the same transaction, with who and when, and
 * articles are archived rather than deleted. The markdown file is now the seed
 * corpus for a fresh deployment (`prisma/seed-knowledge-base.ts`) and is not
 * read at runtime.
 *
 * Three properties the file version had are kept here, and two of them are
 * stronger for the move:
 *
 * **Internal notes cannot reach a prompt.** They used to be `> Internal:` lines
 * inside the body that a regex removed on the way past. They are now a column of
 * their own that `CORPUS_SELECT` does not name, so the guarantee is "the query
 * never asked for it" rather than "a pattern took it out". Nothing that builds a
 * prompt may select `internalNote`.
 *
 * **Withheld articles are absent, not discouraged.** `autoReply: false` articles
 * are filtered in the `where`, exactly as the flag was applied in the file
 * version — the first gate on the whole feature, and the only one that lives in
 * content rather than code.
 *
 * **There is no cache, and that is the point.** The reason the table exists is
 * that an admin can change what the desk tells customers without a deploy; a
 * cached corpus would mean an edit that appears to save and changes nothing
 * until the next restart, which is the worst possible failure for this screen.
 * The cost is one indexed query over a few dozen small rows per answered ticket,
 * on a path that is about to spend thirty seconds in a model call.
 *
 * `orderBy: { id: "asc" }` is not cosmetic. The corpus goes in the *system*
 * prompt so that OpenAI's automatic prompt caching sees an identical prefix
 * across requests; an unordered query would reshuffle that prefix for free and
 * quietly stop the cache from ever hitting.
 */

/**
 * What a prompt may know about an article.
 *
 * Deliberately not the Prisma row: `internalNote` is absent from this type as
 * well as from the query, so a future caller that reaches for it does not
 * compile rather than leaking it into a reply.
 */
export interface KbArticle {
  /** `KB-001`. Stable, never reused, and what a reply cites. */
  id: string;
  /** The question, phrased as a customer would ask it. */
  title: string;
  category: TicketCategory;
  /** The customer-safe answer. No internal guidance, ever. */
  body: string;
}

/**
 * The only columns that may travel to a model.
 *
 * Written out rather than spread from anything, so adding a column to the model
 * cannot quietly add it to a prompt. If this ever grows `internalNote`, the
 * third of the auto-reply's six safety properties is gone.
 */
const CORPUS_SELECT = {
  id: true,
  title: true,
  category: true,
  body: true,
} as const;

/**
 * The articles a machine may answer from: live, flagged `autoReply`, internal
 * notes structurally excluded.
 *
 * An empty result disables the feature. Callers check it rather than assuming a
 * corpus exists — that is what happens on a deployment nobody has seeded, and it
 * has to fail closed rather than answer from nothing.
 */
export async function autoReplyArticles(): Promise<KbArticle[]> {
  return prisma.knowledgeArticle.findMany({
    where: { archived: false, autoReply: true },
    select: CORPUS_SELECT,
    orderBy: { id: "asc" },
  });
}

/**
 * How many articles the auto-reply has to work with.
 *
 * Its own query rather than `(await autoReplyArticles()).length`, because the
 * one caller is the enable check on the *enqueue* path — it runs for every
 * classified ticket and only needs to know whether the corpus is empty. Reading
 * a few dozen article bodies to compare a number against zero is work nobody
 * asked for.
 */
export async function autoReplyArticleCount(): Promise<number> {
  return prisma.knowledgeArticle.count({
    where: { archived: false, autoReply: true },
  });
}
