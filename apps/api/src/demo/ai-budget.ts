import { prisma } from "../db";

/**
 * The demo sessions' daily AI budget (#321, PRD R8).
 *
 * Every demo visitor together may spend `DEMO_AI_DAILY_USD` of AI a UTC day.
 * `routes/ai.ts` asks `demoAiLimitReached` before a demo's polish or summarise
 * and makes no provider call once it answers true, and adds the call's
 * `usdFor(usage)` with `chargeDemoAi` after it. An admin's calls touch neither.
 *
 * **Checked before, charged after, and that gap is accepted.** Calls already in
 * flight when the total crosses the limit still land and still charge, so a day
 * can overshoot by the cost of whatever was running at that moment — a few
 * hundredths of a cent per polish. Reserving the cost up front would need an
 * estimate of a call nobody has made yet, and the PRD asks for "once it
 * reaches", not "never past".
 *
 * The total is a row per UTC day in `demo_ai_spend`, not a counter in memory
 * like the per-user rate limit beside it: this one has to survive a restart and
 * be shared between every instance, because it is a promise about the owner's
 * bill rather than a guard against someone leaning on a button.
 */

/** What the PRD promises the owner, and what a missing or mistyped setting means. */
const DEFAULT_DEMO_AI_DAILY_USD = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The limit, read per call so a test can set it and so it follows the
 * environment the process actually has. Zero is a legal setting (demo AI off
 * for the day); anything that is not a finite, non-negative number falls back
 * to $1.00 rather than lifting the cap.
 */
function dailyLimitUsd(): number {
  const raw = process.env.DEMO_AI_DAILY_USD?.trim();
  if (!raw) return DEFAULT_DEMO_AI_DAILY_USD;
  const usd = Number(raw);
  return Number.isFinite(usd) && usd >= 0 ? usd : DEFAULT_DEMO_AI_DAILY_USD;
}

/** 00:00 UTC on the day `now` falls in, which is the row's key. */
function utcDay(now: Date): Date {
  return new Date(Math.floor(now.getTime() / DAY_MS) * DAY_MS);
}

/** Whether today's demo AI is spent. At the limit counts as spent. */
export async function demoAiLimitReached(now = new Date()): Promise<boolean> {
  const limit = dailyLimitUsd();
  const row = await prisma.demoAiSpend.findUnique({
    where: { day: utcDay(now) },
    select: { usd: true },
  });
  return (row?.usd ?? 0) >= limit;
}

/**
 * Add one call's estimated cost to the day it finished on.
 *
 * One upsert with an `increment`, which Prisma issues as a single
 * `INSERT … ON CONFLICT DO UPDATE SET usd = usd + …`: two demo calls finishing
 * together both count, where a read-then-write would drop one of them. A call
 * that reported no usage costs `0` and writes nothing.
 */
export async function chargeDemoAi(
  usd: number,
  now = new Date(),
): Promise<void> {
  if (usd <= 0) return;
  const day = utcDay(now);
  await prisma.demoAiSpend.upsert({
    where: { day },
    create: { day, usd },
    update: { usd: { increment: usd } },
  });
}

/**
 * Seconds until the total rolls over at the next 00:00 UTC, for the refusal's
 * `Retry-After`. Never zero: at midnight itself the next reset is a day away.
 */
export function secondsUntilDemoAiReset(now: Date): number {
  const next = utcDay(now).getTime() + DAY_MS;
  return Math.ceil((next - now.getTime()) / 1000);
}
