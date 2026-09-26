/**
 * A per-key sliding-window counter, in memory: the one shape behind both of
 * this app's own rate limits — the per-user AI budget in `routes/ai.ts` and
 * the per-address demo start limit in `demo/start-limit.ts`. Each caller owns
 * its window, its key and its limit; this owns the counting.
 *
 * **Per process**, which both callers accept for their own reasons: two API
 * instances behind a load balancer each count separately, and a restart or a
 * `bun --hot` reload clears the lot. A counter shared across instances means
 * Redis, which `tech-stack.md` defers.
 *
 * A leaf with no imports, so nothing ever mocks it (see the registry hazard in
 * `testing-api.md`).
 */

/**
 * How often a window's map is swept, counted in admissions rather than in
 * time.
 *
 * A `setInterval` is the obvious way and the worse one: it needs `.unref()` or
 * it holds the process open, and it keeps waking a server nobody is using.
 * Amortising the sweep over admissions costs exactly nothing while the endpoint
 * is idle, which is most of the time.
 */
const SWEEP_EVERY = 100;

export type Admission =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * A fresh window `windowMs` long, returned as its `admit(key, max)`: whether
 * `key` may have one more now, and if so, count it.
 *
 * A refusal is not counted, so a caller who keeps knocking is let back in a
 * window after their last admission, not a window after their last knock.
 * `max` is asked per call so a caller may read its limit from the environment
 * each time.
 */
export function slidingWindow(
  windowMs: number,
): (key: string, max: number) => Admission {
  /** Admission timestamps per key, oldest first. */
  const admissions = new Map<string, number[]>();
  let admitted = 0;

  /** Forget keys whose whole window has expired, so the map cannot grow without bound. */
  function sweep(now: number): void {
    for (const [key, times] of admissions) {
      const last = times[times.length - 1];
      if (last === undefined || now - last >= windowMs) admissions.delete(key);
    }
  }

  return (key, max) => {
    const now = Date.now();
    const recent = (admissions.get(key) ?? []).filter(
      (at) => now - at < windowMs,
    );

    if (recent.length >= max) {
      // Store the pruned list even on refusal, so a blocked caller doesn't
      // carry expired timestamps into their next attempt.
      admissions.set(key, recent);
      const oldest = recent[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((windowMs - (now - oldest)) / 1000),
        ),
      };
    }

    recent.push(now);
    admissions.set(key, recent);
    if (++admitted % SWEEP_EVERY === 0) sweep(now);
    return { allowed: true };
  };
}
