import { prisma } from "../db";

/**
 * Whether anybody actually uses the demo (#327, PRD R14): demo sessions started
 * this week, and how many of them opened at least one ticket.
 *
 * One `demo_session_tally` row per demo identity. `auth.ts` writes it when the
 * anonymous plugin creates the identity, `GET /api/tickets/:id` flags it the
 * first time that identity opens a ticket, and `GET /api/demo/usage` counts
 * them for the admin. The row names the identity by a copied id rather than a
 * relation, so the nightly reset deleting the identity leaves the figures
 * where they were.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 00:00 UTC on the Monday of the week `now` falls in. UTC because the demo's
 * other two clocks — the nightly reset and the AI budget's day — both turn over
 * at 00:00 UTC, and a week in the server's zone would disagree with both.
 */
function utcWeekStart(now: Date): Date {
  const midnight = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  // getUTCDay() is 0 on Sunday, so Monday is 0 days back and Sunday is 6.
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return new Date(midnight - daysSinceMonday * DAY_MS);
}

/**
 * A demo session started. Idempotent on the identity, so a repeated call
 * counts one visitor once.
 */
export async function recordDemoStart(
  userId: string,
  startedAt: Date,
): Promise<void> {
  await prisma.demoSessionTally.createMany({
    data: [{ userId, startedAt }],
    skipDuplicates: true,
  });
}

/**
 * A demo session opened a ticket. Conditional on not having been flagged yet,
 * so every open after the first matches nothing and writes nothing — the same
 * read-nothing-then-conditional-write shape as `assignmentSeenAt` beside the
 * call. An identity with no row (minted before the tally existed) is a no-op.
 */
export async function markDemoTicketOpened(userId: string): Promise<void> {
  await prisma.demoSessionTally.updateMany({
    where: { userId, openedTicket: false },
    data: { openedTicket: true },
  });
}

export type DemoUsage = {
  weekStartsAt: Date;
  started: number;
  openedTicket: number;
};

/**
 * The week's two figures. A session counts toward the week it *started* in,
 * wherever its first ticket fell, so the second figure is always a share of
 * the first.
 *
 * Bounded by the next Monday rather than by `now`: a row stamped by Postgres'
 * microsecond `now()` in the millisecond this is asked would sort after a JS
 * `Date` bound and drop out (`testing-api.md`, on time-sliced routes).
 */
export async function demoUsageThisWeek(now = new Date()): Promise<DemoUsage> {
  const weekStartsAt = utcWeekStart(now);
  const thisWeek = {
    startedAt: {
      gte: weekStartsAt,
      lt: new Date(weekStartsAt.getTime() + 7 * DAY_MS),
    },
  };
  const [started, openedTicket] = await prisma.$transaction([
    prisma.demoSessionTally.count({ where: thisWeek }),
    prisma.demoSessionTally.count({
      where: { ...thisWeek, openedTicket: true },
    }),
  ]);
  return { weekStartsAt, started, openedTicket };
}
