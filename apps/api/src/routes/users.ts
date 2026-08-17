import { Router } from "express";
import type { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { z, ZodType } from "zod";
import { createUserSchema, updateUserSchema } from "@ticket/core";
import { TICKET_ACTIVITY_ACTION } from "@ticket/shared";
import type {
  CreateUserResponse,
  UpdateUserResponse,
  UserRole,
  UsersListResponse,
} from "@ticket/shared";
import { auth } from "../auth";
import { prisma } from "../db";
import { requireAdmin, sessionOf } from "../middleware/auth";
import { agentActor } from "../ticket-activity";

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

/**
 * Refuse to touch the assistant's account.
 *
 * It is on the roster because an admin should be able to see the thing tickets
 * are being filed under, and it is read-only because there is nothing about it
 * worth changing and one thing worth being careful about: `PATCH` below can set
 * a password, and Better Auth's `setUserPassword` will create the credential row
 * this account deliberately does not have. Renaming it is harmless; a way to
 * sign in as it is not, and the two arrive through the same handler. So neither.
 *
 * 403 rather than 404 — the row exists and the caller can see it in the list;
 * pretending otherwise would read as a bug in the list.
 */
async function rejectAssistant(
  userId: string,
  res: Response<{ error: string }>,
): Promise<boolean> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { automated: true },
  });
  if (target?.automated) {
    res.status(403).json({ error: "The assistant's account cannot be changed" });
    return true;
  }
  return false;
}

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
        automated: true,
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
        automated: u.automated,
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
        // Never. This route makes colleagues; the assistant is made by the seed
        // and by nothing else, which is the whole reason there is only one.
        automated: false,
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
    if (await rejectAssistant(userId, res)) return;

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
        automated: true,
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
        automated: user.automated,
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
      // `name` is for the audit entries below: the account is about to be
      // deleted, so the trail has to keep its own copy.
      select: {
        id: true,
        name: true,
        role: true,
        automated: true,
        deletedAt: true,
      },
    });

    if (!target || target.deletedAt !== null) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (target.role === "admin") {
      res.status(403).json({ error: "Admin users cannot be deleted" });
      return;
    }

    // Deleting it would clear the assignee on every ticket the assistant has
    // ever resolved (see the `updateMany` below), erasing the record of what the
    // machine handled and leaving nothing to file the next one under. There is
    // no re-creating it from the UI either — only the seed makes this row.
    if (target.automated) {
      res
        .status(403)
        .json({ error: "The assistant's account cannot be deleted" });
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
    // Read before the write, because `updateMany` returns a count and an audit
    // trail needs the ids. This is the one place a single statement changes many
    // tickets at once, and it is also the one an agent is most likely to be
    // puzzled by later: a ticket they were watching becomes unassigned overnight
    // with nothing in its history to say why. The name is captured here too —
    // the account is about to be deleted, which is exactly the case the
    // denormalised `actorName` exists for.
    const orphaned = await prisma.ticket.findMany({
      where: { assignedToId: userId },
      select: { id: true },
    });

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
      // In the same transaction as the unassignment: these describe a change
      // that either happened to all of them or to none.
      prisma.ticketActivity.createMany({
        data: orphaned.map((ticket) => ({
          ticketId: ticket.id,
          action: TICKET_ACTIVITY_ACTION.assignee_changed,
          fromValue: target.name,
          toValue: null,
          // The admin who deleted the account, not the agent who lost the
          // tickets: the actor is whoever caused the change.
          ...agentActor(sessionOf(res).user),
        })),
      }),
    ]);

    res.status(204).end();
  },
);
