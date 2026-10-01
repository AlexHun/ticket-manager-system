import type { NextFunction, Request, Response } from "express";
import { USER_ROLE } from "@ticket/shared";
import { mayUseAdminView } from "../demo/admin-view";
import { lookupSession, type Session } from "./session";

export type { Session };

/**
 * The session `requireAuth` parked on `res.locals`.
 *
 * `res.locals` is typed as `any`, so reading it needs a cast. Doing that here
 * once means a route that wants the caller's identity gets it typed, and the
 * assertion — which is only sound because `requireAuth` ran first — lives next
 * to the middleware that makes it true rather than being repeated per route.
 */
export function sessionOf(res: Response): Session {
  return res.locals.session as Session;
}

/**
 * The shape all three guards share: a session or 401, then `allowed` or 403,
 * then the session parked for `sessionOf`. Only the question in the middle
 * differs, so it is the only thing each guard spells out.
 *
 * Who is asking comes from `./session`, the one thing a route test replaces
 * (#366); everything from here down runs for real under test.
 */
function guard(allowed: (session: Session, req: Request) => boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = await lookupSession(req.headers);

    if (!session) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }

    if (!allowed(session, req)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    res.locals.session = session;
    next();
  };
}

export const requireAuth = guard(() => true);

export const requireAdmin = guard(
  (session) => session.user.role === USER_ROLE.admin,
);

/**
 * An admin screen's reads, which a demo session may see too (#320, R3).
 *
 * Mounted on the `GET` routes of the screens `DEMO_SEES_ADMIN_SCREEN` in
 * `@ticket/shared` says a demo sees (#368) — the automation and eval-schedule
 * reads included — and on nothing else: the other screens keep `requireAdmin`
 * whole, and so does every write. Opt-in per route rather than a demo exception
 * inside `requireAdmin`, so an admin route added later is shut to a stranger
 * until somebody decides otherwise; each router's test checks its reads
 * against that table. The rule itself is `mayUseAdminView`.
 */
export const requireAdminView = guard((session, req) =>
  mayUseAdminView(session.user, req.method),
);
