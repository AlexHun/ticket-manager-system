import { Router } from "express";
import type { Request, Response } from "express";
import { dashboardLayoutSchema } from "@ticket/core";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  type DashboardLayoutResponse,
  type DashboardPanelPlacement,
} from "@ticket/shared";
import { prisma } from "../db";
import { requireAuth, sessionOf } from "../middleware/auth";

/**
 * One signed-in user's dashboard panel order and width (issue #102).
 *
 * `requireAuth` throughout — this is a personal preference every agent and
 * admin makes for themselves, not an account-management action, so unlike
 * `routes/users.ts` nothing here writes to `AdminActivity`: nobody needs an
 * audit record of a colleague rearranging their own dashboard.
 */

export const dashboardLayoutRouter = Router();

/**
 * A user who has never customized has no `DashboardLayout` row, and that
 * reads as `DEFAULT_DASHBOARD_LAYOUT` rather than an error — the same
 * "missing row is the default" contract `AutomationSettings` and
 * `TutorialContent` both use.
 */
dashboardLayoutRouter.get(
  "/",
  requireAuth,
  async (_req: Request, res: Response<DashboardLayoutResponse>) => {
    const session = sessionOf(res);

    const row = await prisma.dashboardLayout.findUnique({
      where: { userId: session.user.id },
      select: { panels: true },
    });

    res.json({
      layout: row
        ? (row.panels as unknown as DashboardPanelPlacement[])
        : DEFAULT_DASHBOARD_LAYOUT,
      isDefault: !row,
    });
  },
);

dashboardLayoutRouter.put(
  "/",
  requireAuth,
  async (
    req: Request,
    res: Response<DashboardLayoutResponse | { error: string }>,
  ) => {
    const parsed = dashboardLayoutSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]!.message });
      return;
    }

    const session = sessionOf(res);
    const { layout } = parsed.data;

    await prisma.dashboardLayout.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, panels: layout },
      update: { panels: layout },
    });

    res.json({ layout, isDefault: false });
  },
);

/**
 * Reset to default: deletes the saved row rather than writing
 * `DEFAULT_DASHBOARD_LAYOUT` into it, which is what keeps `isDefault` true
 * afterward and is symmetric with `GET`'s own fallback. `deleteMany` rather
 * than `delete` so resetting an already-default dashboard is a no-op, not a
 * 404 — the caller does not need to know whether a row existed.
 */
dashboardLayoutRouter.delete(
  "/",
  requireAuth,
  async (_req: Request, res: Response<DashboardLayoutResponse>) => {
    const session = sessionOf(res);

    await prisma.dashboardLayout.deleteMany({
      where: { userId: session.user.id },
    });

    res.json({ layout: DEFAULT_DASHBOARD_LAYOUT, isDefault: true });
  },
);
