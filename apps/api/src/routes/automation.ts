import { Router } from "express";
import type { Request, Response } from "express";
import { updateHandoffSchema } from "@ticket/core";
import {
  HANDOFF_TARGET,
  type AutomationSettings,
  type AutomationSettingsResponse,
} from "@ticket/shared";
import {
  assistantUser,
  readHandoffSettings,
  resolveHandoffUser,
  SETTINGS_ID,
} from "../automation";
import { prisma } from "../db";
import { requireAdmin, sessionOf } from "../middleware/auth";

/**
 * Who picks up what the assistant could not finish.
 *
 * **Admin only, both routes.** Reading it says how the unattended half of the
 * desk is wired; writing it decides where a stream of tickets lands, which is a
 * staffing decision and not an agent's to make. The `/pipeline` screen this
 * hangs off is admin-only for the same reason and by the same mechanism.
 *
 * One setting, and it is worth saying what is *not* here. The assistant's own
 * assignment on a ticket it resolved is fixed in code: that is a record of what
 * happened rather than a routing rule, and an admin who could point it at a
 * colleague would be filing a machine's work under somebody's name. The API key,
 * the kill switch and the simulator stay environment variables — they are
 * deployment decisions, and `/pipeline` reports them as presence booleans and
 * never lets anything change them over HTTP.
 */

export const automationRouter = Router();

/**
 * Assemble the wire shape.
 *
 * `resolvedTo` is computed by the same function the auto-reply job calls, so the
 * screen shows the answer the next handed-back ticket will actually get. Three
 * queries where one would do, and worth it: the alternative is the client
 * re-deriving "which admin is longest-serving" and "has this person been
 * deleted", and a settings page that disagrees with the system it configures is
 * worse than no settings page.
 */
async function currentSettings(): Promise<AutomationSettings> {
  const [settings, resolvedTo, assistant] = await Promise.all([
    readHandoffSettings(),
    resolveHandoffUser(),
    assistantUser(),
  ]);

  return {
    target: settings.target,
    user: settings.user,
    resolvedTo,
    assistant,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
    updatedByName: settings.updatedByName,
  };
}

automationRouter.get(
  "/",
  requireAdmin,
  async (_req: Request, res: Response<AutomationSettingsResponse>) => {
    res.json({ settings: await currentSettings() });
  },
);

/**
 * Change the handoff target.
 *
 * A sub-resource named after the one field it writes, following the tickets
 * routes: what a request may change is decided by the URL, not by whichever keys
 * a body happened to carry.
 *
 * The chosen user is checked against the same predicate `PATCH
 * /api/tickets/:id/assignee` uses — live, and not the assistant. Storing an id
 * the assignment route would refuse is how a setting comes to look configured
 * while silently falling back on every ticket, and nobody would find out until
 * they wondered where the queue had gone.
 */
automationRouter.patch(
  "/handoff",
  requireAdmin,
  async (
    req: Request,
    res: Response<AutomationSettingsResponse | { error: string }>,
  ) => {
    const parsed = updateHandoffSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]!.message });
      return;
    }

    const { target, userId } = parsed.data;

    if (userId !== null) {
      const candidate = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null, automated: false },
        select: { id: true },
      });
      if (!candidate) {
        res.status(400).json({ error: "Assignee not found" });
        return;
      }
    }

    const session = sessionOf(res);

    // Upsert rather than update: the row does not exist until somebody changes
    // the setting for the first time, because the default has to work on a
    // deployment nobody has configured. `id` defaults to 1 in the schema, so
    // there is exactly one row and no "create it if missing" branch above this.
    const audit = {
      target,
      handoffUserId: target === HANDOFF_TARGET.user ? userId : null,
      updatedById: session.user.id,
      // Denormalised beside the id, like the knowledge-base revisions: the name
      // has to still be readable once the account is gone.
      updatedByName: session.user.name,
    };

    await prisma.automationSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...audit },
      update: audit,
    });

    console.log(
      `[automation] ${session.user.email} set the handoff target to ${target}${
        userId ? ` (${userId})` : ""
      }`,
    );

    res.json({ settings: await currentSettings() });
  },
);
