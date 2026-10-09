import { Router, type Request, type Response } from "express";
import type { DemoStatusResponse } from "@ticket/shared";
import { isDemoModeEnabled } from "../demo/mode";
import { markDemoWelcomeStepFollowed } from "../demo/usage";
import { requireAuth, sessionOf } from "../middleware/auth";

/**
 * What the login page needs to know about demo mode (#319, ADR-0022), and the
 * welcome's one write (#464).
 *
 * **`GET /` is public, and that is the one thing to notice here.** Every other
 * route behind `/api` is guarded, but this is asked by a page nobody has
 * signed into yet. It says one boolean and nothing else, like
 * `PipelineConfig`: never the env value, never anything about who has used the
 * demo.
 *
 * Whether the button shows is a convenience. The endpoint behind it is refused
 * by `auth.ts` on the same switch, so a page that ignores this changes nothing.
 */
export const demoRouter = Router();

demoRouter.get("/", (_req: Request, res: Response<DemoStatusResponse>) => {
  res.json({ enabled: isDemoModeEnabled() });
});

/**
 * A demo session followed one of the welcome's suggested steps (demo-welcome
 * PRD R11). Marks its tally row once; every later step writes nothing.
 *
 * A signed-in demo session only: an admin or agent has no welcome, and a
 * click of theirs counted here would be a figure about somebody who is not a
 * visitor. The body names no step — the PRD asks whether a session followed
 * *a* step, not which. The figures it feeds stay on `GET /api/demo/usage`,
 * which is admin-only.
 */
demoRouter.post(
  "/welcome-step",
  requireAuth,
  async (_req: Request, res: Response) => {
    const { user } = sessionOf(res);
    if (!user.isAnonymous) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await markDemoWelcomeStepFollowed(user.id);
    res.status(204).end();
  },
);
