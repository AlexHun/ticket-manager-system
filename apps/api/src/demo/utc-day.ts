/**
 * Where a demo day starts: 00:00 UTC, for the AI budget's day (`ai-budget.ts`)
 * and the usage figures' week (`usage.ts`). One module so the two cannot
 * disagree about it. The nightly reset does not read it: it keeps its own cron
 * in `jobs/demo-reset.ts`. A leaf with no imports, like `mode.ts`, so nothing
 * mocks it.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** 00:00 UTC on the day `now` falls in. */
export function utcDay(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
}
