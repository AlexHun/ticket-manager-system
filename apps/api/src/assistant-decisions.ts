import {
  asAutoReplyDecline,
  AUTO_REPLY_DECLINES,
  DASHBOARD_RANGE_DAYS,
  TICKET_ACTOR_KIND,
  type AutoReplyDecline,
  type DashboardRange,
  type TicketActorKind,
} from "@ticket/shared";
import { prisma, type Prisma } from "./db";

/**
 * What the assistant decided about a ticket, each fact stated once (#561).
 *
 * `/pipeline` (`routes/pipeline.ts`) and the dashboard's effectiveness figures
 * (`routes/ticket-effectiveness.ts`) both report these, and each used to read
 * them off columns an agent can change, each in its own words. An agent who
 * cleared a category the classifier filed left `classifiedAt` set and
 * `category` null, which both screens read as the classifier giving up: an
 * outage on `/pipeline` (ADR-0019), and a ticket missing from the classified
 * figure every dashboard rate is taken over. A person correcting the machine
 * was reported as the machine failing.
 *
 * So the classifier records what it filed in `classifierCategory`, a column no
 * agent write touches, and the facts below read that. "Resolved by the
 * assistant" was read two ways as well, off the assignee on the dashboard and
 * off `autoResolvedAt` on `/pipeline` (#562); it is the stamp now, on both. Queries rather than row
 * predicates, for the reason `classifierWillStillAct` is one: every reader can
 * run a query, so the routes count with these and ask them of the tickets they
 * list, and `toRun` takes the answer rather than restating it.
 *
 * The window both screens count over, and the counts over it that both
 * publish, are here too (#563): `windowFor`, `inWindow` and `windowCounts`.
 * Each route used to pin its own window and run its own copy of these counts
 * and of the zero-filled decline tally, so for the same range the two screens
 * agreed only while the copies did. The one count only the dashboard
 * publishes, the category overrides, is here as well, beside the classifier's
 * facts it is about.
 *
 * The only runtime import that reaches a database is `./db`, which the test
 * preload binds for the whole process (ADR-0014), so no test has anything here
 * to stub.
 */

/** One day, in milliseconds: what `DASHBOARD_RANGE_DAYS` is multiplied by. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The classifier filed a category on the ticket. Whatever an agent did to
 * `category` since — cleared it, re-filed it — does not change this.
 */
export const classifierFiled = {
  classifiedAt: { not: null },
  classifierCategory: { not: null },
} satisfies Prisma.TicketWhereInput;

/**
 * The classifier reached its terminal path and filed nothing: `classifiedAt`
 * stamped by the give-up branch of `handle` or by `onExhausted`, and no
 * category of its own. A category an agent filed afterwards does not make this
 * a classification.
 */
export const classifierGaveUp = {
  classifiedAt: { not: null },
  classifierCategory: null,
} satisfies Prisma.TicketWhereInput;

/**
 * The auto-reply resolved the ticket, and no customer has reopened it since
 * (#562). `autoResolvedAt` is stamped by the auto-reply's success path and
 * cleared by a customer's reply in `ingest.ts`, and nothing an agent does
 * touches it.
 *
 * Not the assignee. The resolved ticket is filed under the assistant's account,
 * but that records who owns it, in the column an agent uses: the dashboard
 * used to count the assistant's assignments, so an agent reassigning a ticket
 * the assistant resolved took it out of the published auto-resolve rate while
 * `/pipeline` went on drawing it resolved.
 */
export const assistantResolved = {
  autoResolvedAt: { not: null },
} satisfies Prisma.TicketWhereInput;

/** Tickets created in `[from, to)`: the slice every count below is taken over. */
export type CountWindow = { from: Date; to: Date };

/**
 * The window a dashboard range names, ending at `to`. A route pins `to` once
 * and passes the window to every count, so the whole response describes one
 * slice.
 */
export function windowFor(
  range: DashboardRange,
  to: Date = new Date(),
): CountWindow {
  return {
    from: new Date(to.getTime() - DASHBOARD_RANGE_DAYS[range] * DAY_MS),
    to,
  };
}

/**
 * The window as a `where` on the ticket. `lt` rather than `lte` at the top, and
 * a JS `Date` against a column Postgres stamps to the microsecond, is why a
 * time-sliced test pins its rows in the past (`testing-api.md`).
 */
export function inWindow({ from, to }: CountWindow) {
  return {
    createdAt: { gte: from, lt: to },
  } satisfies Prisma.TicketWhereInput;
}

/** What both screens publish about one window. */
export type WindowCounts = {
  /** `classifierFiled`: `/pipeline`'s `machineClassified`, the dashboard's `classified`. */
  classified: number;
  /** `classifierGaveUp`: `/pipeline`'s `classifyAbandoned`. */
  gaveUp: number;
  /** `assistantResolved`: `/pipeline`'s `autoResolved`, the dashboard's `autoReply.resolved`. */
  resolved: number;
  /**
   * Tickets per decline reason, every reason present and the zeroes included:
   * a zero is the difference between "that check has never fired" and "we do
   * not measure it". Unfiltered by `DECLINE_OUTCOME`, because a reason is what
   * the column honestly holds; the dashboard's verdict-only decline count is
   * taken from this tally rather than counted again.
   */
  declines: Record<AutoReplyDecline, number>;
};

/**
 * The counts `/pipeline` and the dashboard both publish for `window`, so for
 * the same range the two screens cannot disagree.
 */
export async function windowCounts(window: CountWindow): Promise<WindowCounts> {
  const slice = inWindow(window);
  const [classified, gaveUp, resolved, declineGroups] = await Promise.all([
    prisma.ticket.count({ where: { ...slice, ...classifierFiled } }),
    prisma.ticket.count({ where: { ...slice, ...classifierGaveUp } }),
    prisma.ticket.count({ where: { ...slice, ...assistantResolved } }),
    prisma.ticket.groupBy({
      by: ["autoReplyDecline"],
      where: { ...slice, autoReplyDecline: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const declines = Object.fromEntries(
    AUTO_REPLY_DECLINES.map((d) => [d, 0]),
  ) as Record<AutoReplyDecline, number>;
  for (const group of declineGroups) {
    const reason = asAutoReplyDecline(group.autoReplyDecline);
    if (reason) declines[reason] += group._count._all;
  }

  return { classified, gaveUp, resolved, declines };
}

/**
 * Did an agent change a category the classifier set? Counted over a window's
 * `category_changed` activity rows written by the assistant or an agent.
 *
 * The classifier writes its own `category_changed` activity row exactly once
 * per ticket — `jobs/classify-ticket.ts` only ever fires while `category` is
 * still null, so there is never a second one to collide with. So "the
 * classifier set this ticket's category" is exactly "an assistant-authored
 * `category_changed` row exists for it", and "an agent later changed it" is
 * exactly "an agent-authored one does too" — no ordering check needed, because
 * the assistant's row can only ever be the first.
 */
export function countCategoryOverrides(
  rows: { ticketId: number; actorKind: TicketActorKind }[],
): number {
  const kindsByTicket = new Map<number, Set<TicketActorKind>>();
  for (const row of rows) {
    const kinds = kindsByTicket.get(row.ticketId) ?? new Set();
    kinds.add(row.actorKind);
    kindsByTicket.set(row.ticketId, kinds);
  }

  let overridden = 0;
  for (const kinds of kindsByTicket.values()) {
    if (
      kinds.has(TICKET_ACTOR_KIND.assistant) &&
      kinds.has(TICKET_ACTOR_KIND.agent)
    ) {
      overridden++;
    }
  }
  return overridden;
}
