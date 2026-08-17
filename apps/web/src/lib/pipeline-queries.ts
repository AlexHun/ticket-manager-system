/**
 * Query keys for the pipeline page.
 *
 * `all` is the prefix the others nest under, so a finished run can invalidate
 * the overview and any open trace with one call — the counts on the rail have
 * just moved by one and the page is showing both at once.
 */
export const pipelineKeys = {
  all: ["pipeline"] as const,
  overview: (range: string) => ["pipeline", "overview", range] as const,
  run: (ticketId: number) => ["pipeline", "run", ticketId] as const,
};

/**
 * How often a run is re-read while the push channel is down.
 *
 * **This used to be the only `refetchInterval` in the app, at two seconds, and
 * it was how the page worked.** It is now a fallback: `pipeline_changed` arrives
 * over `/api/events` the instant a worker commits, so the ordinary path has no
 * interval at all and beats the old two seconds on both axes — no wait for the
 * next tick, and a hidden tab is served too, which is what
 * `refetchIntervalInBackground` used to be for.
 *
 * It survives, narrowly, because this is the one screen whose whole purpose is
 * watching something move. Everywhere else "the channel is down" costs a stale
 * number until the next navigation; here it would mean a ticket frozen at
 * "received" on the page built to prove it is not. Fifteen seconds rather than
 * two: this is insurance against a disconnected stream, not the mechanism.
 */
export const RUN_FALLBACK_POLL_MS = 15_000;

/**
 * When a run has taken long enough to say so on screen.
 *
 * Sized against the real ladder rather than guessed: classification takes
 * 4-17s, the auto-reply call is capped at 30s, and a transient provider failure
 * adds a 30s first retry. Past two minutes the honest thing to say is "this is
 * taking longer than it should".
 *
 * **It no longer stops anything, and that is the point of the rename.** It used
 * to clear `watching`, which ended the poll — so a run that landed at three
 * minutes was reported as stalled forever even though it had succeeded, because
 * nothing was left asking. Push does not need to be told to keep listening, so
 * this is now purely a deadline for what the page *says*: the verdict still
 * arrives and still replaces this line whenever it lands.
 */
export const RUN_STALLED_MS = 120_000;
