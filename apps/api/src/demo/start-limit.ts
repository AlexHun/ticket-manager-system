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
 * **In memory, per process**, like the per-user AI rate limit in
 * `routes/ai.ts` and Better Auth's own limiter: a restart forgets the hour and
 * two instances would allow five each. That is accepted. This guards a demo
 * against being farmed for identities, it is not protecting data, and a counter
 * shared across instances means Redis, which `tech-stack.md` defers. It is also
 * why nothing here is ever written down: no visitor's address outlives the
 * hour it is counted for.
 *
 * A leaf with no imports, like `mode.ts` beside it and for the same reason:
 * `auth.ts` is the module a unit test cannot always load, and nothing mocks a
 * module with no dependencies.
 */

/** What the PRD promises, and what a missing or mistyped setting means. */
const DEFAULT_DEMO_STARTS_PER_HOUR = 5;

const HOUR_MS = 60 * 60 * 1000;

/**
 * How often the map is swept, counted in admissions rather than in time — the
 * reasoning is `routes/ai.ts`'s: a timer would wake a server nobody is using.
 */
const SWEEP_EVERY = 100;

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

/** Start times per address, oldest first. */
const startsByAddress = new Map<string, number[]>();
let admitted = 0;

/** Forget addresses whose last start is an hour old, so the map cannot grow without bound. */
function sweep(now: number): void {
  for (const [address, times] of startsByAddress) {
    const last = times[times.length - 1];
    if (last === undefined || now - last >= HOUR_MS) {
      startsByAddress.delete(address);
    }
  }
}

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
export function admitDemoStart(address: string, now = Date.now()): boolean {
  const recent = (startsByAddress.get(address) ?? []).filter(
    (at) => now - at < HOUR_MS,
  );

  if (recent.length >= startsPerHour()) {
    startsByAddress.set(address, recent);
    return false;
  }

  recent.push(now);
  startsByAddress.set(address, recent);
  if (++admitted % SWEEP_EVERY === 0) sweep(now);
  return true;
}
