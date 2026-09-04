import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { USER_ROLE } from "@ticket/shared";
import { auth } from "../auth";

export type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

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

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  res.locals.session = session;
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  if (session.user.role !== USER_ROLE.admin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.locals.session = session;
  next();
}
