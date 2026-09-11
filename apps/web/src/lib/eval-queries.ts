import type { EvalCorpus } from "@ticket/shared";

/**
 * Query keys for the evals page.
 *
 * `all` is the prefix everything nests under, so a pushed `eval_run_changed`
 * can invalidate the list and every run's case results with one call — the page
 * shows both at once, and a run appearing and a run finishing move different
 * halves of it.
 *
 * **No `refetchInterval` here, deliberately.** `/pipeline` keeps one as
 * insurance because its whole purpose is watching something move; a run is
 * announced over `/api/events` the moment its worker commits, and a stale list
 * costs an admin a navigation rather than a screen that lies about a job in
 * flight. If that turns out to be wrong, the fallback belongs here beside the
 * key, with the number argued — not sprinkled on a `useQuery`.
 */
export const evalKeys = {
  all: ["evals"] as const,
  /**
   * One corpus's runs (#234).
   *
   * The corpus is in the key because it is in the request: the page shows one
   * series at a time, so frozen and live are two lists and two cache entries.
   * Nested under `all`, so a pushed `eval_run_changed` still invalidates both
   * with one call — a run that finishes while an admin is reading the other
   * series must not leave a stale list behind it.
   */
  runs: (corpus: EvalCorpus) => ["evals", "runs", corpus] as const,
  /**
   * When runs happen — the standing schedule and what is planned (#236).
   *
   * **Not under a corpus**, unlike the list: the schedule is frozen-corpus only
   * and a planned run may be either, so this is one panel for both series and
   * switching the selector must not refetch it. Still nested under `all`, so a
   * pushed `eval_run_changed` invalidates it too — a plan that fires becomes a
   * run, and the panel it leaves is one row shorter.
   */
  schedule: () => ["evals", "schedule"] as const,
};
