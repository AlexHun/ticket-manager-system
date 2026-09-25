import type { NextFunction, Request, Response } from "express";
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

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
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

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
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

/**
 * An admin screen's reads, which a demo session may see too (#320, R3).
 *
 * Mounted on the `GET` routes of Pipeline, Knowledge, Evals, Activity and
 * Tutorials, and on nothing else: Users and Outbox keep `requireAdmin` whole,
 * and so does every write. Opt-in per route rather than a demo exception inside
 * `requireAdmin`, so an admin route added later is shut to a stranger until
 * somebody decides otherwise. The rule itself is `mayUseAdminView`.
 */
export async function requireAdminView(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }

  if (!mayUseAdminView(session.user, req.method)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.locals.session = session;
  next();
}
