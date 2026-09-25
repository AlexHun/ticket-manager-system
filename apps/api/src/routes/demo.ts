import { Router, type Request, type Response } from "express";
import type { DemoStatusResponse } from "@ticket/shared";
import { isDemoModeEnabled } from "../demo/mode";

/**
 * What the login page needs to know about demo mode (#319, ADR-0022).
 *
 * **Public, and that is the one thing to notice here.** Every other router
 * behind `/api` is guarded, but this is asked by a page nobody has signed into
 * yet. It says one boolean and nothing else, like `PipelineConfig`: never the
 * env value, never anything about who has used the demo.
 *
 * Whether the button shows is a convenience. The endpoint behind it is refused
 * by `auth.ts` on the same switch, so a page that ignores this changes nothing.
 */
export const demoRouter = Router();

demoRouter.get("/", (_req: Request, res: Response<DemoStatusResponse>) => {
  res.json({ enabled: isDemoModeEnabled() });
});
