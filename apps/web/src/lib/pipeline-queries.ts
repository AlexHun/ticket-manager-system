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
 * How often a run is re-read while it is still moving.
 *
 * This is the only `refetchInterval` in the app, and the app otherwise sets
 * `refetchOnWindowFocus: false` globally — so it is worth saying why this page
 * gets an exception. Everywhere else, staleness costs an agent a reload.
 * Here the entire point is watching a thing happen: the work runs on a queue in
 * another process, takes tens of seconds, and reports only by changing columns.
 * Without polling the page would show a ticket frozen at "received" until
 * somebody thought to refresh, which is precisely the invisibility it exists to
 * fix.
 *
 * Two seconds is under the resolution of anything being watched (classification
 * lands in 4-17s) and cheap: one indexed read of one row.
 */
export const RUN_POLL_MS = 2_000;

/**
 * When to stop polling a run that never reaches a verdict.
 *
 * Sized against the real ladder rather than guessed: classification takes
 * 4-17s, the auto-reply call is capped at 30s, and a transient provider failure
 * adds a 30s first retry. Past two minutes the honest thing to say is "this is
 * taking longer than it should" and stop asking — the retry ladder runs for
 * about seven and a half minutes, which is far longer than anyone is watching a
 * screen, and the row will be correct whenever they come back.
 */
export const RUN_POLL_TIMEOUT_MS = 120_000;
