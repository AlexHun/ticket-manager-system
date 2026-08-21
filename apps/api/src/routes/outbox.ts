import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  OUTBOUND_EMAIL_STATUS,
  type OutboundEmailKind,
  type OutboundEmailStatus,
  type OutboxListResponse,
} from "@ticket/shared";
import { prisma } from "../db";
import { requeueEmail } from "../jobs/send-email";
import { isMailConfigured } from "../mail/transport";
import { requireAdmin } from "../middleware/auth";

/**
 * Reading the outbox.
 *
 * **This is not a debug screen.** With no mail provider bound — which is every
 * deployment today — it is the delivery mechanism: a new colleague's invitation
 * link exists only as a row in this table, and an admin reading it off the page
 * is how they get in. That is the arrangement `POST /api/users` depends on for
 * having no password field.
 *
 * Which makes it the most sensitive list in the app. An invitation body is a
 * working single-use credential for somebody else's account until it expires, so
 * this is `requireAdmin` throughout. An admin can already create and delete
 * accounts, so this grants no authority they did not have; it does make the
 * authority more direct, which is worth knowing rather than discovering.
 *
 * The one thing that is not a read is `POST /:id/retry`, which puts a row the
 * worker gave up on back in the queue. See the note there for why it can never
 * touch a row that was actually sent.
 */
export const outboxRouter = Router();

const listQuerySchema = z.object({
  status: z.enum(OUTBOUND_EMAIL_STATUS).optional(),
  // Deliberately small and capped. Nothing here is worth paginating through in
  // bulk, and an unbounded `take` on a table holding credentials is the wrong
  // default to leave lying about.
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

outboxRouter.get(
  "/",
  requireAdmin,
  async (
    req: Request,
    res: Response<(OutboxListResponse & { mailConfigured: boolean }) | { error: string }>,
  ) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]!.message });
      return;
    }
    const { status, limit } = parsed.data;
    const where = status ? { status } : {};

    // Two queries rather than one with a count relation: the total is for the
    // filter chips above the list and has to count rows the page does not carry.
    const [rows, total] = await Promise.all([
      prisma.outboundEmail.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
        select: {
          id: true,
          kind: true,
          status: true,
          toEmail: true,
          toName: true,
          subject: true,
          textBody: true,
          attempts: true,
          lastError: true,
          createdAt: true,
          sentAt: true,
          // Through the message rather than stored twice: the screen links a
          // reply back to its thread, and only a reply has one.
          message: { select: { ticketId: true } },
        },
      }),
      prisma.outboundEmail.count({ where }),
    ]);

    res.json({
      total,
      // A presence boolean, never the token — the same rule the pipeline API
      // follows. It is what lets the screen say "nothing is being sent, and that
      // is why every row below says undeliverable" instead of leaving an admin
      // to infer it.
      mailConfigured: isMailConfigured(),
      emails: rows.map((row) => ({
        id: row.id,
        kind: row.kind as OutboundEmailKind,
        status: row.status as OutboundEmailStatus,
        toEmail: row.toEmail,
        toName: row.toName,
        subject: row.subject,
        textBody: row.textBody,
        ticketId: row.message?.ticketId ?? null,
        attempts: row.attempts,
        lastError: row.lastError,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
      })),
    });
  },
);

/**
 * The statuses a retry may act on: the two the worker settles a row into when
 * it could not deliver it.
 *
 * `sent` and `queued` are absent, and that absence is the safety property. A
 * retry on a `sent` row would put a second copy of somebody else's email in the
 * queue, and this is the one screen in the app where that is a click away.
 */
const RETRYABLE_STATUS = [
  OUTBOUND_EMAIL_STATUS.undeliverable,
  OUTBOUND_EMAIL_STATUS.failed,
] as const;

/**
 * Send this one again.
 *
 * The worker settles a row it could not deliver and stops: `undeliverable` when
 * there was no provider to try, `failed` once the retry ladder ran out. Both are
 * terminal by design — nothing reopens them on a schedule, because an outbox
 * that quietly retries forever is how a provider outage becomes a duplicate-mail
 * incident. So the way out is a person deciding, which is this route.
 *
 * The case it exists for is the obvious one: every invitation and every reply
 * written before a provider was bound is sitting here `undeliverable`, and
 * binding Postmark does nothing for any of them on its own.
 *
 * **The flip is conditional and the enqueue rides on it.** `updateMany` with the
 * status in its `where` is what makes this safe against two admins clicking at
 * once: the second one matches nothing, writes nothing, and enqueues nothing.
 * Doing it as read-then-write would let both through and send twice. The job is
 * sent inside the same transaction, so a rollback takes the nudge with it and a
 * commit means both survive a crash — the same shape `enqueueEmail` uses.
 *
 * `attempts` is deliberately not reset. It counts what this row has actually
 * cost, and an admin looking at a row on its fourth attempt should see four.
 */
outboxRouter.post(
  "/:id/retry",
  requireAdmin,
  async (
    req: Request,
    res: Response<{ error: string } | Record<string, never>>,
  ) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      res.status(400).json({ error: "Invalid outbound email id" });
      return;
    }

    // Refused rather than accepted-and-ignored. With no provider the retry would
    // travel the whole queue and land back on `undeliverable`, which reads as a
    // broken button rather than as a deployment that cannot send yet — and the
    // screen already says why in the card at the top.
    if (!isMailConfigured()) {
      res.status(409).json({
        error: "No mail provider is configured, so there is nothing to retry to",
      });
      return;
    }

    const requeued = await prisma.$transaction(async (tx) => {
      const { count } = await tx.outboundEmail.updateMany({
        where: { id, status: { in: [...RETRYABLE_STATUS] } },
        data: { status: OUTBOUND_EMAIL_STATUS.queued, lastError: null },
      });
      if (count === 0) return false;

      await requeueEmail(id, tx);
      return true;
    });

    if (!requeued) {
      // Only now worth a second query: separating "no such row" from "that row
      // is not in a state you may retry" matters to whoever is looking at it,
      // and neither answer is worth paying for on the happy path.
      const existing = await prisma.outboundEmail.findUnique({
        where: { id },
        select: { status: true },
      });

      if (!existing) {
        res.status(404).json({ error: "No such outbound email" });
        return;
      }

      res.status(409).json({
        error:
          existing.status === OUTBOUND_EMAIL_STATUS.sent
            ? "That email was already sent"
            : "That email is already queued to send",
      });
      return;
    }

    // Accepted, not done: the send happens on a worker afterwards, and the row
    // is what will say how it went.
    res.status(202).json({});
  },
);
