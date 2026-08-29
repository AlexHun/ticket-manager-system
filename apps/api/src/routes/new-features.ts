import { Router } from "express";
import type { Request, Response } from "express";
import {
  NEW_FEATURE_KEYS,
  NEW_FEATURE_VERSIONS,
  type NewFeatureKey,
  type NewFeatureStatusResponse,
} from "@ticket/shared";
import { prisma } from "../db";
import { requireAuth, sessionOf } from "../middleware/auth";

/**
 * The "new" badge (issue #45): whether the caller should still see a dot for
 * each `NewFeatureKey`, and marking one seen.
 *
 * Both routes are `requireAuth` — there's no admin-only half like the
 * tutorial's content editor, because there's no admin-editable content here,
 * only the code-level `NEW_FEATURE_VERSIONS` registry.
 */

export const newFeaturesRouter = Router();

function isNewFeatureKey(value: string): value is NewFeatureKey {
  return (NEW_FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * One request for every key's status, unlike the tutorial's `GET /:pageKey`:
 * the sidebar renders every nav item at once and needs all of their badge
 * states together, not one fetch per item.
 */
newFeaturesRouter.get(
  "/status",
  requireAuth,
  async (_req: Request, res: Response<NewFeatureStatusResponse>) => {
    const session = sessionOf(res);

    const rows = await prisma.newFeatureSeen.findMany({
      where: {
        userId: session.user.id,
        featureKey: { in: [...NEW_FEATURE_KEYS] },
      },
      select: { featureKey: true, seenVersion: true },
    });
    const seenVersionByKey = new Map(
      rows.map((row) => [row.featureKey, row.seenVersion]),
    );

    const statuses = Object.fromEntries(
      NEW_FEATURE_KEYS.map((key) => {
        const seenVersion = seenVersionByKey.get(key);
        const shouldShow =
          seenVersion === undefined || seenVersion < NEW_FEATURE_VERSIONS[key];
        return [key, shouldShow];
      }),
    ) as Record<NewFeatureKey, boolean>;

    res.json({ statuses });
  },
);

/**
 * Mark one key's *current* version seen for the caller. Upsert, same reason
 * as the tutorial's `/seen`: no row exists on a user's first interaction with
 * any badge, and always writing the version as of *this* moment means a
 * version bump landing between the status read and this write is still
 * honoured — the caller just saw whatever was current when they interacted.
 */
newFeaturesRouter.post(
  "/:featureKey/seen",
  requireAuth,
  async (req: Request, res: Response<{ ok: true } | { error: string }>) => {
    const featureKey = req.params.featureKey as string;
    if (!isNewFeatureKey(featureKey)) {
      res.status(404).json({ error: "Unknown feature key" });
      return;
    }

    const session = sessionOf(res);
    const seenVersion = NEW_FEATURE_VERSIONS[featureKey];

    await prisma.newFeatureSeen.upsert({
      where: { userId_featureKey: { userId: session.user.id, featureKey } },
      create: { userId: session.user.id, featureKey, seenVersion },
      update: { seenVersion, seenAt: new Date() },
    });

    res.json({ ok: true });
  },
);
