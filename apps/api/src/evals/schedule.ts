import { prisma } from "../db";

/**
 * The stored schedule: reading it, and turning it into the string pg-boss
 * wants (#236).
 *
 * The nightly's time used to be a constant in `jobs/eval-nightly.ts`, with a
 * paragraph defending both halves of it. That reasoning is still true and has
 * moved nowhere; what changed is who owns the value. An admin retimes the
 * schedule at `/evals` and it takes effect without a deploy.
 *
 * **This module reads and formats. It does not write, and it does not speak to
 * the queue.** The write is one route (`routes/eval-schedule.ts`), and
 * re-asserting the cron goes through `./schedule-queue` — a one-line module
 * whose only reason to exist is that the queue's specifier is already owned by
 * another test file's stateful stub.
 */

/**
 * The schedule's row id, and there is only ever one row.
 *
 * A deployment is one desk with one nightly. A table that could hold two would
 * be a second cron nobody asked for, and every reader would need a rule for
 * choosing between them — so the id is fixed here and the route upserts on it,
 * the same shape `AutomationSettings` uses for the same reason.
 */
export const EVAL_SCHEDULE_ID = 1;

/** An hour and a minute, which is the whole of what an admin chooses. */
export interface EvalScheduleTime {
  hour: number;
  minute: number;
  paused: boolean;
}

/**
 * What the schedule says when nothing has said otherwise.
 *
 * 03:47, unpaused — the time `jobs/eval-nightly.ts` was hard-coded to before
 * this was editable, and the value the migration seeds the row with. Both
 * halves of it were argued there and are unchanged: **nightly** rather than
 * hourly because a full set is ~175 calls against a real provider and somebody
 * pays for every one of them, and **a minute nobody else uses** because a run
 * holds a worker for minutes and the two pruning sweeps already sit at :23 and
 * 03:41.
 *
 * It is a fallback and not merely a duplicate of the seed. `resetDb()` empties
 * every table, so the API suite runs against a database with no schedule row at
 * all — and a deployment whose row was deleted by hand should keep sweeping at
 * the time it always did rather than stop. A read that answered `null` would
 * push that decision out to every caller.
 */
export const EVAL_SCHEDULE_DEFAULT: EvalScheduleTime = {
  hour: 3,
  minute: 47,
  paused: false,
};

/**
 * The cron expression for a daily time.
 *
 * Assembled here rather than stored, because four of cron's five fields have
 * exactly one legal value for a daily schedule: storing the string would be
 * storing four fields that can only ever be wrong. It is also why an admin
 * picks an hour and a minute rather than typing cron — the fifth field's
 * every-few-hours form is the run the PRD priced out.
 */
export function evalScheduleCron(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`;
}

/**
 * The schedule in force, falling back to the default when no row exists.
 *
 * Read at boot by `jobs/eval-nightly.ts` — which is what makes an edit survive
 * a deploy, rather than the deploy re-asserting the constant over it — and by
 * the route that renders the panel.
 */
export async function readEvalSchedule(): Promise<EvalScheduleTime> {
  const row = await prisma.evalSchedule.findUnique({
    where: { id: EVAL_SCHEDULE_ID },
    select: { hour: true, minute: true, paused: true },
  });

  return row ?? EVAL_SCHEDULE_DEFAULT;
}
