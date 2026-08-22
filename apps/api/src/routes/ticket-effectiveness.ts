import type { Request, Response } from "express";
import { ticketEffectivenessQuerySchema } from "@ticket/core";
import {
  asAutoReplyDecline,
  AUTO_REPLY_DECLINES,
  DASHBOARD_RANGE_DAYS,
  TICKET_ACTIVITY_ACTION,
  TICKET_ACTOR_KIND,
  type AssistantEffectivenessResponse,
  type AutoReplyDecline,
} from "@ticket/shared";
import { Prisma, prisma } from "../db";
import { countCategoryOverrides } from "./ticket-effectiveness-override";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Same UTC-safe cast `ticket-stats.ts` uses — see the comment there for why a
 *  plain bind parameter would silently shift every number by the API host's
 *  local offset. Duplicated rather than imported: route files here don't reach
 *  into one another, and this is three lines. */
const ts = (d: Date) =>
  Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

interface FactsRow {
  classified: number;
  resolvedByAssistant: number;
  declined: number;
}

/**
 * GET /api/tickets/effectiveness
 *
 * The assistant's numbers, aggregated the way `ticket-stats.ts` already does
 * it — raw SQL for the facts a single scan answers, `groupBy`/`findMany` for
 * the two counts that are more naturally a Prisma query, all three run inside
 * one transaction so the whole response describes the same slice. Part of #16;
 * `avgEditDistance` stays null for the reason on its field in `@ticket/shared`.
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

  const slice = Prisma.sql`t."createdAt" >= ${ts(from)} AND t."createdAt" < ${ts(to)}`;

  // `classified`, `resolvedByAssistant` and `declined` all fall out of one scan
  // of `ticket`, so they are one query rather than three. `resolvedByAssistant`
  // reads the assignee (`u.automated`) rather than `autoResolvedAt` — see the
  // field comment in `@ticket/shared` for why the two never disagree and the
  // assignee is the one the ticket asked for.
  const factsSql = Prisma.sql`
    SELECT
      COUNT(*) FILTER (
        WHERE t."classifiedAt" IS NOT NULL AND t.category IS NOT NULL
      )::int AS classified,
      COUNT(*) FILTER (WHERE u.automated = true)::int AS "resolvedByAssistant",
      COUNT(*) FILTER (WHERE t."autoReplyDecline" IS NOT NULL)::int AS declined
    FROM "ticket" t
    LEFT JOIN "user" u ON u.id = t."assignedToId"
    WHERE ${slice}
  `;

  const [facts, declineGroups, overrideRows] = await prisma.$transaction([
    prisma.$queryRaw<FactsRow[]>(factsSql),
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
        actorKind: { in: [TICKET_ACTOR_KIND.assistant, TICKET_ACTOR_KIND.agent] },
        ticket: window,
      },
      select: { ticketId: true, actorKind: true },
    }),
  ]);

  const f = facts[0];
  const classified = f?.classified ?? 0;
  const resolved = f?.resolvedByAssistant ?? 0;
  const declined = f?.declined ?? 0;
  const overridden = countCategoryOverrides(overrideRows);

  const reasons = Object.fromEntries(
    AUTO_REPLY_DECLINES.map((d) => [d, 0]),
  ) as Record<AutoReplyDecline, number>;
  for (const group of declineGroups) {
    const reason = asAutoReplyDecline(group.autoReplyDecline);
    if (reason) reasons[reason] += group._count._all;
  }

  const rate = (n: number): number | null => (classified === 0 ? null : n / classified);

  res.json({
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    classified,
    autoReply: { resolved, rate: rate(resolved) },
    decline: { count: declined, rate: rate(declined), reasons },
    categoryOverride: { count: overridden, rate: rate(overridden) },
    avgEditDistance: null,
  });
}
