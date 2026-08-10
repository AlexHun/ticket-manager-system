import { Router } from "express";
import type { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { z, ZodType } from "zod";
import { createUserSchema, updateUserSchema } from "@ticket/core";
import type {
  CreateUserResponse,
  UpdateUserResponse,
  UserRole,
  UsersListResponse,
} from "@ticket/shared";
import { auth } from "../auth";
import { prisma } from "../db";
import { requireAdmin } from "../middleware/auth";

function parseBody<S extends ZodType>(
  schema: S,
  req: Request,
  res: Response,
): z.infer<S> | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return null;
  }
  return parsed.data;
}

export const usersRouter = Router();

usersRouter.get(
  "/",
  requireAdmin,
  async (_req: Request, res: Response<UsersListResponse>) => {
    const users = await prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        emailVerified: u.emailVerified,
        createdAt: u.createdAt.toISOString(),
      })),
    });
  },
);

usersRouter.post(
  "/",
  requireAdmin,
  async (
    req: Request,
    res: Response<CreateUserResponse | { error: string }>,
  ) => {
    const data = parseBody(createUserSchema, req, res);
    if (!data) return;
    const { name, email, password } = data;

    const { user } = await auth.api.createUser({
      body: { name, email, password },
      headers: fromNodeHeaders(req.headers),
    });

    res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as UserRole,
        emailVerified: user.emailVerified,
        createdAt: new Date(user.createdAt).toISOString(),
      },
    });
  },
);

usersRouter.patch(
  "/:id",
  requireAdmin,
  async (
    req: Request,
    res: Response<UpdateUserResponse | { error: string }>,
  ) => {
    const data = parseBody(updateUserSchema, req, res);
    if (!data) return;

    const { name, email, password } = data;
    
    const userId = req.params.id as string;
    const headers = fromNodeHeaders(req.headers);

    await auth.api.adminUpdateUser({
      body: { userId, data: { name, email } },
      headers,
    });

    if (password && password.length > 0) {
      await auth.api.setUserPassword({
        body: { userId, newPassword: password },
        headers,
      });
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as UserRole,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt.toISOString(),
      },
    });
  },
);

usersRouter.delete(
  "/:id",
  requireAdmin,
  async (req: Request, res: Response<{ error: string } | Record<string, never>>) => {
    const userId = req.params.id as string;

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, deletedAt: true },
    });

    if (!target || target.deletedAt !== null) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (target.role === "admin") {
      res.status(403).json({ error: "Admin users cannot be deleted" });
      return;
    }

    // Deleting the sessions is what signs the user out — the soft delete alone
    // only stops future sign-ins.
    //
    // This is no longer instant: `auth.ts` enables Better Auth's session cookie
    // cache, so a request carrying an unexpired cookie is served without the
    // sessions table being read at all. The user keeps access until that cookie
    // ages out (currently 60s). If revocation ever has to be immediate, that
    // cache is the thing to turn off — not something to fix here.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          banned: true,
          banReason: "Deleted by admin",
        },
      }),
      prisma.session.deleteMany({ where: { userId } }),
      // `Ticket.assignedTo` carries `onDelete: SetNull`, but this is a soft
      // delete — the row stays, so the FK action never fires and every ticket
      // keeps pointing at someone who is no longer on the roster. That is a
      // dead end for the ticket: `/assignees` filters on `deletedAt: null`, so
      // the picker cannot offer them and the assignment guard at
      // `routes/tickets.ts` refuses to re-select them. Clearing it here is what
      // puts those tickets back in front of somebody.
      prisma.ticket.updateMany({
        where: { assignedToId: userId },
        data: { assignedToId: null },
      }),
    ]);

    res.status(204).end();
  },
);
