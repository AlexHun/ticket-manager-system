import { Router, type Request, type Response } from "express";
import type { DemoUsageResponse } from "@ticket/shared";
import { demoUsageThisWeek } from "../demo/usage";
import { requireAdmin } from "../middleware/auth";

/**
 * This week's demo figures for the admin (#327, PRD R14): demo sessions
 * started, and how many of them opened a ticket.
 *
 * **`requireAdmin`, never `requireAdminView`.** These are figures about the
 * visitors, and a visitor is not shown them; the Users page they sit on is
 * shut to a demo session for the same reason. A router of its own rather than
 * a route on `routes/demo.ts`, whose one endpoint is public and says so.
 */
export const demoUsageRouter = Router();

demoUsageRouter.get(
  "/",
  requireAdmin,
  async (_req: Request, res: Response<DemoUsageResponse>) => {
    const usage = await demoUsageThisWeek();
    res.json({
      weekStartsAt: usage.weekStartsAt.toISOString(),
      started: usage.started,
      openedTicket: usage.openedTicket,
    });
  },
);
