import type { Request, Response } from "express";
import { ticketEffectivenessQuerySchema } from "@ticket/core";
import {
  AUTO_REPLY_DECLINES,
  DECLINE_OUTCOME,
  MESSAGE_DIRECTION,
  PIPELINE_OUTCOME,
  TICKET_ACTIVITY_ACTION,
  TICKET_ACTOR_KIND,
  type AssistantEffectivenessResponse,
} from "@ticket/shared";
import {
  countCategoryOverrides,
  inWindow,
  windowCounts,
  windowFor,
} from "../assistant-decisions";
import { prisma } from "../db";
import { averageEditDistance } from "./ticket-effectiveness-edit-distance";

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
 * The tally by reason it is summed from is deliberately not filtered this way:
 * it breaks the column down by reason, and a reason is what the column
 * honestly holds.
 */
const VERDICT_DECLINES = AUTO_REPLY_DECLINES.filter(
  (d) => DECLINE_OUTCOME[d] === PIPELINE_OUTCOME.declined,
);

/**
 * GET /api/tickets/effectiveness
 *
 * The assistant's numbers over one window, pinned once so the whole response
 * describes the same slice. The window and its classified, resolved and
 * per-reason decline counts are `windowFor` and `windowCounts` from
 * `assistant-decisions.ts`, the same calls `/pipeline` makes, so for the same
 * range the two screens cannot disagree (#563). What only this screen
 * publishes, the category overrides and the edit distance, is read here over
 * the same window. No raw SQL since #562: its one reason was the join to
 * `user` that counted the assistant's assignments as its resolutions. Part of
 * #16; see `ticket-effectiveness-edit-distance.ts` for how `avgEditDistance`
 * is computed and why it no longer has to stay null.
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
  const window = windowFor(range);
  const slice = inWindow(window);

  // `classified` and `resolved` read the statements `/pipeline` counts with,
  // `classifierFiled` and `assistantResolved` (#561, #562): the auto-resolve
  // stamp, never the assignee, which records who owns the ticket and is the
  // column an agent changes.
  const [counts, overrideRows, editDistancePairs] = await Promise.all([
    windowCounts(window),
    // Bounded by "tickets classified or re-categorised in the slice", not by
    // ticket volume — most tickets never generate a second `category_changed`
    // row at all.
    prisma.ticketActivity.findMany({
      where: {
        action: TICKET_ACTIVITY_ACTION.category_changed,
        actorKind: {
          in: [TICKET_ACTOR_KIND.assistant, TICKET_ACTOR_KIND.agent],
        },
        ticket: slice,
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
        ticket: slice,
      },
      select: { polishedDraft: true, textBody: true },
    }),
  ]);

  const { classified, resolved, declines: reasons } = counts;
  const declined = VERDICT_DECLINES.reduce((n, d) => n + reasons[d], 0);
  const overridden = countCategoryOverrides(overrideRows);

  const rate = (n: number): number | null =>
    classified === 0 ? null : n / classified;

  res.json({
    range,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    classified,
    autoReply: { resolved, rate: rate(resolved) },
    decline: { count: declined, rate: rate(declined), reasons },
    categoryOverride: { count: overridden, rate: rate(overridden) },
    avgEditDistance: averageEditDistance(editDistancePairs),
  });
}
