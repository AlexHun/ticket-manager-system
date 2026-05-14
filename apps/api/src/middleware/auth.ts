import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth";

export type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

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

  if (session.user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.locals.session = session;
  next();
}
