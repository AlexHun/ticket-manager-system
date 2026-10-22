import type { Request, Response } from "express";
import { ticketEffectivenessQuerySchema } from "@ticket/core";
import {
  asAutoReplyDecline,
  AUTO_REPLY_DECLINES,
  DASHBOARD_RANGE_DAYS,
  DECLINE_OUTCOME,
  MESSAGE_DIRECTION,
  PIPELINE_OUTCOME,
  TICKET_ACTIVITY_ACTION,
  TICKET_ACTOR_KIND,
  type AssistantEffectivenessResponse,
  type AutoReplyDecline,
} from "@ticket/shared";
import { assistantResolved, classifierFiled } from "../assistant-decisions";
import { prisma } from "../db";
import { averageEditDistance } from "./ticket-effectiveness-edit-distance";
import { countCategoryOverrides } from "./ticket-effectiveness-override";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The decline reasons that are a verdict about the ticket.
 *
 * Read off `DECLINE_OUTCOME` rather than written out, so an eleventh reason
 * joins this number the moment somebody says it is a verdict, and stays out of
 * it when they say it is not. What it excludes is `unavailable`: an outage, an
 * emptied corpus or a call whose budget went on reasoning decided nothing about
 * the ticket, and counting one into `decline.rate` inflates the published
 * number an admin reads to decide whether the knowledge base needs work
 * (`docs/adr/0019`).
 *
 * The `groupBy` below is deliberately not filtered this way: it breaks the
 * column down by reason, and a reason is what the column honestly holds.
 */
const VERDICT_DECLINES = AUTO_REPLY_DECLINES.filter(
  (d) => DECLINE_OUTCOME[d] === PIPELINE_OUTCOME.declined,
);

/**
 * GET /api/tickets/effectiveness
 *
 * The assistant's numbers: `count`/`groupBy`/`findMany` over one window, all
 * six run inside one transaction so the whole response describes the same
 * slice. No raw SQL since #562: its one reason was the join to `user` that
 * counted the assistant's assignments as its resolutions. Part of #16;
 * see `ticket-effectiveness-edit-distance.ts` for how `avgEditDistance` is
 * computed and why it no longer has to stay null.
 */
export async function ticketEffectivenessHandler(
  req: Request,
  res: Response<AssistantEffectivenessResponse | { error: string }>,
): Promise<void> {
  const parsed = ticketEffectivenessQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { range } = parsed.data;
  const days = DASHBOARD_RANGE_DAYS[range];

  const to = new Date();
  const from = new Date(to.getTime() - days * DAY_MS);
  const window = { createdAt: { gte: from, lt: to } };

  // Every count is a Prisma `where` over the same `window`. `resolved` and
  // `classified` read the statements `/pipeline` counts with too, from
  // `assistant-decisions.ts` (#561, #562): the auto-resolve stamp, never the
  // assignee, which is the routing rule and the column an agent changes.
  const [
    classified,
    resolved,
    declined,
    declineGroups,
    overrideRows,
    editDistancePairs,
  ] = await prisma.$transaction([
    prisma.ticket.count({ where: { ...window, ...classifierFiled } }),
    prisma.ticket.count({ where: { ...window, ...assistantResolved } }),
    prisma.ticket.count({
      where: { ...window, autoReplyDecline: { in: VERDICT_DECLINES } },
    }),
    // Every reason, including the zeroes — same pattern `routes/pipeline.ts`
    // uses for the identical column.
    prisma.ticket.groupBy({
      by: ["autoReplyDecline"],
      where: { ...window, autoReplyDecline: { not: null } },
      _count: { _all: true },
    }),
    // Bounded by "tickets classified or re-categorised in the slice", not by
    // ticket volume — most tickets never generate a second `category_changed`
    // row at all.
    prisma.ticketActivity.findMany({
      where: {
        action: TICKET_ACTIVITY_ACTION.category_changed,
        actorKind: {
          in: [TICKET_ACTOR_KIND.assistant, TICKET_ACTOR_KIND.agent],
        },
        ticket: window,
      },
      select: { ticketId: true, actorKind: true },
    }),
    // Scoped through the `ticket` relation rather than the message's own
    // `createdAt`, so this reads "sent-and-polished pairs on tickets in the
    // slice" — the same slice every other field on this response uses,
    // `ticket.createdAt`, not "replies sent in the slice" (a ticket opened
    // just inside the window can be answered just after it). `automated`
    // replies are excluded implicitly: the auto-reply never touches Polish,
    // so `polishedDraft` is always null on one.
    prisma.message.findMany({
      where: {
        direction: MESSAGE_DIRECTION.outbound,
        polishedDraft: { not: null },
        textBody: { not: null },
        ticket: window,
      },
      select: { polishedDraft: true, textBody: true },
    }),
  ]);

  const overridden = countCategoryOverrides(overrideRows);

  const reasons = Object.fromEntries(
    AUTO_REPLY_DECLINES.map((d) => [d, 0]),
  ) as Record<AutoReplyDecline, number>;
  for (const group of declineGroups) {
    const reason = asAutoReplyDecline(group.autoReplyDecline);
    if (reason) reasons[reason] += group._count._all;
  }

  const rate = (n: number): number | null =>
    classified === 0 ? null : n / classified;

  res.json({
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    classified,
    autoReply: { resolved, rate: rate(resolved) },
    decline: { count: declined, rate: rate(declined), reasons },
    categoryOverride: { count: overridden, rate: rate(overridden) },
    avgEditDistance: averageEditDistance(editDistancePairs),
  });
}
