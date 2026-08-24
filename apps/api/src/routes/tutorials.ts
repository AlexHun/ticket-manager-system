import { Router } from "express";
import type { Request, Response } from "express";
import { tutorialContentSchema } from "@ticket/core";
import {
  TUTORIAL_PAGE_KEYS,
  TUTORIAL_PAGE_VERSIONS,
  type TutorialContent,
  type TutorialContentResponse,
  type TutorialContentsResponse,
  type TutorialPageKey,
  type TutorialStatusResponse,
} from "@ticket/shared";
import { prisma } from "../db";
import { requireAdmin, requireAuth, sessionOf } from "../middleware/auth";

/**
 * The per-page tutorial: what an authenticated user is shown, and what an
 * admin writes for them to see.
 *
 * Split by guard rather than by path, the way `tickets.ts` mixes
 * `requireAuth` reads with narrower writes: both roles open every page here,
 * so `GET /:pageKey` and `POST /:pageKey/seen` are `requireAuth`; only an
 * admin decides what a page's tutorial says, so `GET /` (the editor's list)
 * and `PUT /:pageKey` are `requireAdmin`.
 */

export const tutorialsRouter = Router();

function isTutorialPageKey(value: string): value is TutorialPageKey {
  return (TUTORIAL_PAGE_KEYS as readonly string[]).includes(value);
}

function toWireContent(row: {
  pageKey: string;
  title: string;
  steps: unknown;
  updatedAt: Date;
  updatedByName: string | null;
}): TutorialContent {
  return {
    pageKey: row.pageKey as TutorialPageKey,
    title: row.title,
    steps: row.steps as TutorialContent["steps"],
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedByName,
  };
}

/**
 * A page nobody has written a tutorial for yet. `steps` empty is the whole
 * point: it is what `shouldShow` below reads as "nothing to show", so a page
 * with no authored content stays silent rather than popping up empty — the
 * same "half-finished ⇒ inert" default `KnowledgeArticle.autoReply` uses.
 */
function defaultContent(pageKey: TutorialPageKey): TutorialContent {
  return { pageKey, title: "", steps: [], updatedAt: null, updatedByName: null };
}

tutorialsRouter.get(
  "/",
  requireAdmin,
  async (_req: Request, res: Response<TutorialContentsResponse>) => {
    const rows = await prisma.tutorialContent.findMany();
    const byKey = new Map(rows.map((row) => [row.pageKey as string, row]));

    res.json({
      tutorials: TUTORIAL_PAGE_KEYS.map((pageKey) => {
        const row = byKey.get(pageKey);
        return row ? toWireContent(row) : defaultContent(pageKey);
      }),
    });
  },
);

tutorialsRouter.get(
  "/:pageKey",
  requireAuth,
  async (
    req: Request,
    res: Response<TutorialStatusResponse | { error: string }>,
  ) => {
    const pageKey = req.params.pageKey as string;
    if (!isTutorialPageKey(pageKey)) {
      res.status(404).json({ error: "Unknown tutorial page" });
      return;
    }

    const session = sessionOf(res);

    const [row, progress] = await Promise.all([
      prisma.tutorialContent.findUnique({ where: { pageKey } }),
      prisma.tutorialProgress.findUnique({
        where: { userId_pageKey: { userId: session.user.id, pageKey } },
        select: { seenVersion: true },
      }),
    ]);

    const content = row ? toWireContent(row) : defaultContent(pageKey);
    const currentVersion = TUTORIAL_PAGE_VERSIONS[pageKey];

    // Empty content never shows, regardless of version — see `defaultContent`.
    // Otherwise: no progress row at all, or a seen version behind the current
    // one, is exactly "this user has not seen what's here now".
    const shouldShow =
      content.steps.length > 0 &&
      (!progress || progress.seenVersion < currentVersion);

    res.json({ tutorial: { content, shouldShow } });
  },
);

/**
 * Mark the page's *current* version seen for the caller.
 *
 * Upsert, not update: the first time a user dismisses any page's tutorial
 * there is no `TutorialProgress` row yet. Always writes `TUTORIAL_PAGE_VERSIONS`
 * as of this moment, so a version bump that lands between the `GET` that showed
 * the tutorial and this `POST` is still honoured correctly — the caller just
 * saw the tutorial that was current when they dismissed it.
 */
tutorialsRouter.post(
  "/:pageKey/seen",
  requireAuth,
  async (req: Request, res: Response<{ ok: true } | { error: string }>) => {
    const pageKey = req.params.pageKey as string;
    if (!isTutorialPageKey(pageKey)) {
      res.status(404).json({ error: "Unknown tutorial page" });
      return;
    }

    const session = sessionOf(res);
    const seenVersion = TUTORIAL_PAGE_VERSIONS[pageKey];

    await prisma.tutorialProgress.upsert({
      where: { userId_pageKey: { userId: session.user.id, pageKey } },
      create: { userId: session.user.id, pageKey, seenVersion },
      update: { seenVersion, seenAt: new Date() },
    });

    res.json({ ok: true });
  },
);

tutorialsRouter.put(
  "/:pageKey",
  requireAdmin,
  async (
    req: Request,
    res: Response<TutorialContentResponse | { error: string }>,
  ) => {
    const pageKey = req.params.pageKey as string;
    if (!isTutorialPageKey(pageKey)) {
      res.status(404).json({ error: "Unknown tutorial page" });
      return;
    }

    const parsed = tutorialContentSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]!.message });
      return;
    }

    const session = sessionOf(res);
    const { title, steps } = parsed.data;
    const audit = {
      title,
      steps,
      updatedById: session.user.id,
      updatedByName: session.user.name,
    };

    const row = await prisma.tutorialContent.upsert({
      where: { pageKey },
      create: { pageKey, ...audit },
      update: audit,
    });

    res.json({ tutorial: toWireContent(row) });
  },
);
