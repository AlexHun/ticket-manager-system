import { Router } from "express";
import type { Request, Response } from "express";
import type { z, ZodType } from "zod";
import { knowledgeArchiveSchema, knowledgeArticleSchema } from "@ticket/core";
import {
  KNOWLEDGE_REVISION_ACTION,
  type KnowledgeArticle,
  type KnowledgeArticleResponse,
  type KnowledgeArticleRevision,
  type KnowledgeArticleRevisionsResponse,
  type KnowledgeArticlesResponse,
} from "@ticket/shared";
import { prisma } from "../db";
import { requireAdmin, sessionOf } from "../middleware/auth";

/**
 * Editing the knowledge base.
 *
 * **Admin only, on every route, without exception.** Whoever can write here can
 * write into the system prompt of the one feature in this product that sends
 * prose to customers with nobody reading it first. That is a strictly larger
 * power than editing a document, and the frontend's route guard is UX — this
 * middleware is the control.
 *
 * Two invariants hold everything up, and both are enforced here rather than by
 * convention:
 *
 * **Every write records who made it, in the same transaction.** There is no path
 * to `knowledge_article` that does not also write a `knowledge_article_revision`
 * — not here, not in the seed import. The audit log is the condition on which
 * the corpus was allowed to leave version control at all (see the header of
 * `ai/knowledge-base.ts`), so a write that skips it is not a bug in a feature,
 * it is the feature's justification failing.
 *
 * **Nothing is ever deleted.** `message.citedArticleIds` points here from
 * replies already sitting in customers' threads, and "why did we tell them
 * that?" gets asked weeks later. Archiving takes an article out of every prompt
 * and leaves it readable at the id that cited it. The schema backs this up:
 * `KnowledgeArticleRevision.article` is `onDelete: Restrict` and every article
 * has at least one revision, so the database refuses the delete this router does
 * not offer.
 */

/**
 * An empty internal note is no note.
 *
 * The column is nullable and the form sends `""`, so this is where the two meet
 * — one place rather than a `.transform()` in the schema, which would have made
 * its input and output types differ and dragged that distinction through
 * react-hook-form on the client.
 */
function withNote<T extends { internalNote: string }>(data: T) {
  return { ...data, internalNote: data.internalNote.length === 0 ? null : data.internalNote };
}

function parseBody<S extends ZodType>(
  schema: S,
  req: Request,
  res: Response,
): z.infer<S> | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]!.message });
    return null;
  }
  return parsed.data;
}

/**
 * Every column, including the internal note.
 *
 * The deliberate opposite of `CORPUS_SELECT` in `ai/knowledge-base.ts`, which
 * omits `internalNote` so a prompt cannot be built with it. Here it is the
 * point: the note is written for the people reading this screen. The two
 * selects are the whole mechanism — if they ever converge, check which
 * direction they converged in.
 */
const ARTICLE_SELECT = {
  id: true,
  title: true,
  category: true,
  body: true,
  internalNote: true,
  autoReply: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ArticleRow = {
  id: string;
  title: string;
  category: KnowledgeArticle["category"];
  body: string;
  internalNote: string | null;
  autoReply: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toArticle(row: ArticleRow): KnowledgeArticle {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The next free article id.
 *
 * Counts from the highest id that has **ever** existed, archived rows included,
 * rather than from the number of live articles — ids are the citation contract
 * and are never reused. Reusing `KB-014` after archiving it would silently
 * re-point every reply that cited the old one at a different article, which is
 * the audit trail lying rather than merely being incomplete.
 *
 * Ordering by `id` desc is a string sort, which is correct for a fixed-width
 * `KB-000` format and stops being correct at `KB-999`. Four figures is a schema
 * change, not a padding change: `citedArticleIds` on existing messages holds the
 * three-digit strings, so widening means deciding what the old ones mean first.
 */
async function nextArticleId(): Promise<string> {
  const highest = await prisma.knowledgeArticle.findFirst({
    orderBy: { id: "desc" },
    select: { id: true },
  });

  const previous = highest ? Number.parseInt(highest.id.slice(3), 10) : 0;
  const next = (Number.isNaN(previous) ? 0 : previous) + 1;
  return `KB-${String(next).padStart(3, "0")}`;
}

export const knowledgeRouter = Router();

/**
 * Every article, live and archived.
 *
 * Archived ones travel too, and are not a separate endpoint: the screen has to
 * be able to show what was retired and to restore it, and an admin looking for
 * an article that "should be here" needs to find it in the archive rather than
 * conclude it never existed and write a second copy.
 *
 * Ordered by id, which is chronological — ids are issued in sequence and never
 * reused — so the list reads as the knowledge base was built.
 */
knowledgeRouter.get(
  "/",
  requireAdmin,
  async (_req: Request, res: Response<KnowledgeArticlesResponse>) => {
    const articles = await prisma.knowledgeArticle.findMany({
      select: ARTICLE_SELECT,
      orderBy: { id: "asc" },
    });

    res.json({ articles: articles.map(toArticle) });
  },
);

/**
 * One article's history, newest first.
 *
 * The whole point of the table, and the reason this is a route of its own rather
 * than a field on the article: a revision list is long, is read rarely, and
 * carries a full snapshot per entry. Loading thirty-two of those to render a
 * list of titles would be paying the audit trail's cost on every page view.
 */
knowledgeRouter.get(
  "/:id/revisions",
  requireAdmin,
  async (
    req: Request,
    res: Response<KnowledgeArticleRevisionsResponse | { error: string }>,
  ) => {
    const id = req.params.id as string;

    const article = await prisma.knowledgeArticle.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!article) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    const revisions = await prisma.knowledgeArticleRevision.findMany({
      where: { articleId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        articleId: true,
        action: true,
        title: true,
        category: true,
        body: true,
        internalNote: true,
        autoReply: true,
        archived: true,
        editorName: true,
        editorEmail: true,
        createdAt: true,
      },
    });

    res.json({
      revisions: revisions.map(
        (revision): KnowledgeArticleRevision => ({
          ...revision,
          createdAt: revision.createdAt.toISOString(),
        }),
      ),
    });
  },
);

/**
 * Who is making this change, as the revision will record them.
 *
 * The name and address are copied onto the revision rather than joined at read
 * time, so the trail survives the account being deleted — which is exactly the
 * moment somebody wants to read it.
 */
function editorOf(res: Response) {
  const { user } = sessionOf(res);
  return {
    editorId: user.id,
    editorName: user.name,
    editorEmail: user.email,
  };
}

knowledgeRouter.post(
  "/",
  requireAdmin,
  async (
    req: Request,
    res: Response<KnowledgeArticleResponse | { error: string }>,
  ) => {
    const parsed = parseBody(knowledgeArticleSchema, req, res);
    if (!parsed) return;
    const data = withNote(parsed);

    const id = await nextArticleId();

    const article = await prisma.$transaction(async (tx) => {
      const created = await tx.knowledgeArticle.create({
        data: { id, ...data },
        select: ARTICLE_SELECT,
      });
      await tx.knowledgeArticleRevision.create({
        data: {
          ...data,
          articleId: id,
          action: KNOWLEDGE_REVISION_ACTION.created,
          archived: false,
          ...editorOf(res),
        },
      });
      return created;
    });

    res.status(201).json({ article: toArticle(article) });
  },
);

knowledgeRouter.patch(
  "/:id",
  requireAdmin,
  async (
    req: Request,
    res: Response<KnowledgeArticleResponse | { error: string }>,
  ) => {
    const parsed = parseBody(knowledgeArticleSchema, req, res);
    if (!parsed) return;
    const data = withNote(parsed);

    const id = req.params.id as string;

    const existing = await prisma.knowledgeArticle.findUnique({
      where: { id },
      select: { archived: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    // Editing an archived article is refused rather than silently allowed. An
    // archived article is out of every prompt, so an edit to one is either a
    // mistake or the long way round to restoring it — and the second of those
    // should be a decision an admin makes on purpose, with its own audit entry,
    // not a side effect of pressing Save on a form they thought was live.
    if (existing.archived) {
      res.status(409).json({
        error: "This article is archived. Restore it before editing.",
      });
      return;
    }

    const article = await prisma.$transaction(async (tx) => {
      const updated = await tx.knowledgeArticle.update({
        where: { id },
        data,
        select: ARTICLE_SELECT,
      });
      await tx.knowledgeArticleRevision.create({
        data: {
          ...data,
          articleId: id,
          action: KNOWLEDGE_REVISION_ACTION.updated,
          archived: false,
          ...editorOf(res),
        },
      });
      return updated;
    });

    res.json({ article: toArticle(article) });
  },
);

/**
 * Retire an article, or bring it back.
 *
 * Separate from PATCH on purpose — see `knowledgeArchiveSchema`. Archiving is
 * the one edit on this screen that changes what the machine can say without
 * changing a word of what any article says, so it gets its own route, its own
 * confirmation on the client, and its own action in the trail.
 *
 * The snapshot written here carries the article's *current* text with the new
 * `archived` value, so the trail answers "what was retired?" without needing the
 * revision before it.
 */
knowledgeRouter.post(
  "/:id/archive",
  requireAdmin,
  async (
    req: Request,
    res: Response<KnowledgeArticleResponse | { error: string }>,
  ) => {
    const data = parseBody(knowledgeArchiveSchema, req, res);
    if (!data) return;

    const id = req.params.id as string;

    const existing = await prisma.knowledgeArticle.findUnique({
      where: { id },
      select: ARTICLE_SELECT,
    });
    if (!existing) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    // Already in the requested state. Answered as success with the row
    // unchanged rather than as an error: the caller wanted it archived and it is
    // archived. What it must not do is write a second revision saying somebody
    // archived it again — a trail that records non-events is a trail nobody
    // trusts to record events.
    if (existing.archived === data.archived) {
      res.json({ article: toArticle(existing) });
      return;
    }

    const article = await prisma.$transaction(async (tx) => {
      const updated = await tx.knowledgeArticle.update({
        where: { id },
        data: { archived: data.archived },
        select: ARTICLE_SELECT,
      });
      await tx.knowledgeArticleRevision.create({
        data: {
          articleId: id,
          action: data.archived
            ? KNOWLEDGE_REVISION_ACTION.archived
            : KNOWLEDGE_REVISION_ACTION.restored,
          title: updated.title,
          category: updated.category,
          body: updated.body,
          internalNote: updated.internalNote,
          autoReply: updated.autoReply,
          archived: updated.archived,
          ...editorOf(res),
        },
      });
      return updated;
    });

    res.json({ article: toArticle(article) });
  },
);
