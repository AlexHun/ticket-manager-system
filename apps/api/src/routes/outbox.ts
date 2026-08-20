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
 * this is `requireAdmin` and read-only. An admin can already create and delete
 * accounts, so this grants no authority they did not have; it does make the
 * authority more direct, which is worth knowing rather than discovering.
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
