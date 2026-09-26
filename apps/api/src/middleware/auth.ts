import type { NextFunction, Request, Response } from "express";
import { isAPIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import { USER_ROLE } from "@ticket/shared";
import { auth } from "../auth";
import { mayUseAdminView } from "../demo/admin-view";

export type Session = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

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
 * A 401 from `getSession` is no session: it is how `auth.ts` ends a demo
 * session two hours in or once demo mode is off (#324), thrown because a hook
 * cannot answer `null`. Anything else is a fault, and goes on to the error
 * handler as it always did.
 */
function noSessionOn401(err: unknown): null {
  if (isAPIError(err) && err.statusCode === 401) return null;
  throw err;
}

/**
 * The shape all three guards share: a session or 401, then `allowed` or 403,
 * then the session parked for `sessionOf`. Only the question in the middle
 * differs, so it is the only thing each guard spells out.
 */
function guard(allowed: (session: Session, req: Request) => boolean) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const session = await auth.api
      .getSession({ headers: fromNodeHeaders(req.headers) })
      .catch(noSessionOn401);

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
 * Mounted on the `GET` routes of Pipeline, Knowledge, Evals, Activity and
 * Tutorials (the automation and eval-schedule reads included), and on nothing
 * else: Users and Outbox keep `requireAdmin` whole, and so does every write.
 * Opt-in per route rather than a demo exception inside `requireAdmin`, so an
 * admin route added later is shut to a stranger until somebody decides
 * otherwise. The rule itself is `mayUseAdminView`.
 */
export const requireAdminView = guard((session, req) =>
  mayUseAdminView(session.user, req.method),
);
