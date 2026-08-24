import * as Sentry from "@sentry/bun";
import { Router } from "express";
import type { Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { z, ZodType } from "zod";
import { createUserSchema, updateUserSchema } from "@ticket/core";
import { ADMIN_ACTIVITY_ACTION, TICKET_ACTIVITY_ACTION } from "@ticket/shared";
import type {
  CreateUserResponse,
  UpdateUserResponse,
  UserRole,
  UsersListResponse,
} from "@ticket/shared";
import { adminActor, userEditChanges } from "../admin-activity";
import { appOrigin, auth } from "../auth";
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
 * worth changing and one thing worth being careful about.
 *
 * That one thing used to be `PATCH` accepting a password, since
 * `setUserPassword` creates the credential row this account deliberately does
 * not have. The field is gone, but the hazard only moved: `POST /:id/invite`
 * mails a link that does the same job, and so does the public
 * `/request-password-reset` behind it. So this guard still stands here, and
 * `sendResetPassword` in `auth.ts` carries the matching one for the door that
 * never comes through this file. Renaming the assistant is harmless; a way to
 * sign in as it is not.
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
    const { name, email } = data;

    const headers = fromNodeHeaders(req.headers);

    /**
     * Created **without a password**, which is a supported shape in Better Auth
     * — the account simply has no `credential` row until somebody sets one.
     *
     * That absence is doing two jobs. It means no password to this account has
     * ever been known to anyone but its owner, which is the whole point of
     * replacing the field an admin used to type into. And it is what
     * `sendResetPassword` reads to tell an invitation from a reset, so no caller
     * has to carry that distinction around.
     *
     * `emailVerified` is set true here rather than left to default false. This
     * app has no verification flow and is not getting one: sign-up is disabled,
     * an admin creates every account and already knows the address, so the only
     * thing the column did was draw an "unverified" badge on the roster that no
     * action in the app could ever clear. See
     * `docs/adr/0010-no-email-verification.md`.
     */
    const { user } = await auth.api.createUser({
      body: { name, email, data: { emailVerified: true } },
      headers,
    });

    await prisma.adminActivity.createMany({
      data: [
        {
          action: ADMIN_ACTIVITY_ACTION.user_created,
          ...adminActor(sessionOf(res).user),
          targetUserId: user.id,
          targetUserName: user.name,
        },
        {
          action: ADMIN_ACTIVITY_ACTION.user_invited,
          toValue: "initial",
          ...adminActor(sessionOf(res).user),
          targetUserId: user.id,
          targetUserName: user.name,
        },
      ],
    });

    /**
     * The invitation, which is the password-reset flow wearing different words.
     *
     * Not awaited for the same reason the callback itself is not: this is a
     * write to the outbox and an admin is holding a spinner on the 201 below.
     * A failure leaves an account with no way in, which is recoverable — the
     * admin resends — and is reported rather than swallowed.
     */
    auth.api
      .requestPasswordReset({
        body: { email, redirectTo: `${appOrigin}/reset-password?invite=1` },
        headers,
      })
      .catch((err: unknown) => {
        console.error(`[users] failed to invite ${email}:`, err);
        Sentry.captureException(err, { tags: { component: "user-invite" } });
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

    const { name, email } = data;

    const userId = req.params.id as string;
    if (await rejectAssistant(userId, res)) return;

    // Read before the write — the audit trail diffs against what the account
    // had a moment ago, and `adminUpdateUser` below does not hand that back.
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true },
    });

    const headers = fromNodeHeaders(req.headers);

    // Name and email only. Setting a password from here is gone on purpose —
    // `POST /:id/invite` below sends the owner a link instead, so a locked-out
    // colleague gets a password nobody else has seen. That also removed the
    // sharpest edge on this handler: `setUserPassword` creates a credential row
    // where none existed, which is how an admin could once have made the
    // assistant signable-in through an ordinary-looking edit.
    await auth.api.adminUpdateUser({
      body: { userId, data: { name, email } },
      headers,
    });

    // One row per field that actually moved — a Save that re-sends the same
    // name and email writes nothing, same guard `ticketChanges` uses.
    const changes = userEditChanges(before, { name, email });
    if (changes.length > 0) {
      await prisma.adminActivity.createMany({
        data: changes.map((entry) => ({
          ...entry,
          ...adminActor(sessionOf(res).user),
          targetUserId: userId,
          targetUserName: name,
        })),
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

/**
 * Send this colleague their invitation again.
 *
 * The replacement for the password box that used to sit on the edit form, and
 * the answer to every situation that box used to answer: a link expired before
 * it was read, an invitation went to an address that was wrong and has since
 * been corrected, somebody is locked out. In each case the person who ends up
 * knowing the password is the person it belongs to.
 *
 * It is the same Better Auth call the create route makes, which is the same one
 * behind the public "forgot password" form — one mechanism, three doors. What
 * this door adds is `requireAdmin` and the assistant check, and it answers 204
 * without saying whether anything was sent, because an admin looking at the
 * roster already knows the account exists and does not need telling twice.
 */
usersRouter.post(
  "/:id/invite",
  requireAdmin,
  async (req: Request, res: Response<{ error: string } | Record<string, never>>) => {
    const userId = req.params.id as string;
    if (await rejectAssistant(userId, res)) return;

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, deletedAt: true },
    });

    if (!target || target.deletedAt !== null) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await auth.api.requestPasswordReset({
      body: {
        email: target.email,
        redirectTo: `${appOrigin}/reset-password?invite=1`,
      },
      headers: fromNodeHeaders(req.headers),
    });

    await prisma.adminActivity.create({
      data: {
        action: ADMIN_ACTIVITY_ACTION.user_invited,
        toValue: "resend",
        ...adminActor(sessionOf(res).user),
        targetUserId: userId,
        targetUserName: target.name,
      },
    });

    res.status(204).json({});
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
      prisma.adminActivity.create({
        data: {
          action: ADMIN_ACTIVITY_ACTION.user_deleted,
          ...adminActor(sessionOf(res).user),
          targetUserId: userId,
          targetUserName: target.name,
        },
      }),
    ]);

    res.status(204).end();
  },
);
