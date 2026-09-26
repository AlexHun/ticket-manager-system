/**
 * How many demo sessions one client address may start in an hour (#322, PRD
 * R9). `auth.ts` asks `admitDemoStart` in the `before` hook that already
 * refuses `/sign-in/anonymous` while demo mode is off, so a refused start
 * throws before the plugin's handler runs and mints nobody.
 *
 * **The address is the caller's to resolve, and `auth.ts` resolves it with
 * Better Auth's own `getIp`**, the function the `/sign-in/email` rule is keyed
 * on. So the two limits count the same visitor by construction: the leftmost
 * `X-Forwarded-For` entry, which Railway's edge overwrites (the Caddyfile note
 * records the measurement), with an IPv6 address widened to its /64 so one
 * visitor cannot rotate through a subnet. That is also why the resolver is not
 * re-implemented here: a second opinion about which hop is the client is how
 * the two limits would come to disagree the day the pin moves.
 *
 * **In memory, per process**, through the `slidingWindow` the per-user AI
 * rate limit in `routes/ai.ts` also counts with, as Better Auth's own limiter
 * does: a restart forgets the hour and two instances would allow five each.
 * That is accepted. This guards a demo against being farmed for identities, it
 * is not protecting data. It is also why nothing here is ever written down: no
 * visitor's address outlives the hour it is counted for.
 *
 * Its one import is another leaf, so like `mode.ts` beside it nothing ever
 * mocks it: `auth.ts` is the module a unit test cannot always load.
 */

import { slidingWindow } from "../sliding-window";

/** What the PRD promises, and what a missing or mistyped setting means. */
const DEFAULT_DEMO_STARTS_PER_HOUR = 5;

const HOUR_MS = 60 * 60 * 1000;

/**
 * The limit, read per call so a test can set it and so it follows the
 * environment the process actually has. Only a whole number above zero is
 * taken: a typo must not lift the cap, and zero is not how demo mode is turned
 * off — `DEMO_MODE_ENABLED` is.
 */
function startsPerHour(): number {
  const raw = process.env.DEMO_SESSIONS_PER_IP_PER_HOUR?.trim();
  if (!raw) return DEFAULT_DEMO_STARTS_PER_HOUR;
  const starts = Number(raw);
  return Number.isInteger(starts) && starts > 0
    ? starts
    : DEFAULT_DEMO_STARTS_PER_HOUR;
}

/** A sliding hour per address. */
const admit = slidingWindow(HOUR_MS);

/**
 * Whether `address` may start a demo session now, and if so, count it.
 *
 * A sliding hour from each start, and a refused attempt is not a start: a
 * visitor who keeps knocking is let back in an hour after the fifth start,
 * not an hour after the last knock.
 *
 * Counted before the plugin's handler runs, so a start the handler then turns
 * down still counts — the one it does turn down is a session that is already
 * a demo asking for another, which the login page never sends, since a
 * signed-in visitor is taken straight past it.
 */
export function admitDemoStart(address: string): boolean {
  return admit(address, startsPerHour()).allowed;
}
