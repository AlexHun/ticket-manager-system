import { useQuery } from "@tanstack/react-query";
import type { EvalCorpus, EvalStatusResponse } from "@ticket/shared";
import { api } from "@/lib/api";

/**
 * Query keys for the evals page, and the sidebar's eval mark (#608).
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
  /**
   * How the frozen series stands, for the sidebar's Evals item (#608).
   *
   * Under `all` like the rest, which is the whole of how the mark updates: a
   * run that finishes publishes `eval_run_changed`, that invalidates the
   * prefix, and the sidebar refetches without anyone opening `/evals`.
   */
  status: () => ["evals", "status"] as const,
};

/**
 * The sidebar's eval mark (#608), asked only by a viewer who sees the Evals
 * item. `enabled` is the agent half of R6: the route refuses an agent anyway,
 * and a request that can only answer 403 is not worth sending on every page.
 */
export function useEvalStatus(enabled: boolean) {
  return useQuery({
    queryKey: evalKeys.status(),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<EvalStatusResponse>("/api/evals/status", {
        signal,
      });
      return data;
    },
    enabled,
  });
}
