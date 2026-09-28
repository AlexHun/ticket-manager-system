/**
 * The demo's one clock: days turn over at 00:00 UTC, for the nightly reset,
 * the AI budget's day (`ai-budget.ts`) and the usage figures' week
 * (`usage.ts`). One module so the three cannot disagree about where a day
 * starts. A leaf with no imports, like `mode.ts`, so nothing mocks it.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** 00:00 UTC on the day `now` falls in. */
export function utcDay(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
}
