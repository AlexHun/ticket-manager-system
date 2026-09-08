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
  runs: () => ["evals", "runs"] as const,
};
