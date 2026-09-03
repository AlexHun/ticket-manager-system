import type { LoaderFunctionArgs } from "react-router-dom";
import { queryClient } from "@/lib/query-client";
import { ticketDetailQueryOptions } from "@/lib/ticket-detail-query";

/**
 * Starts `GET /api/tickets/:id` the moment navigation to the ticket begins.
 *
 * Its own module, imported statically by the router, and that is the whole
 * point: React Router runs a statically-defined `loader` **in parallel** with
 * the route's `lazy` `Component`, so the request goes out alongside the page's
 * code chunk rather than after it. Put this inside `TicketDetailPage.tsx` and
 * it would be behind the very download it is meant to race.
 *
 * It awaits the fetch rather than firing and forgetting, which is what turns
 * two loading states into none. React Router holds the previous screen — the
 * ticket list, or `HydrateFallback` on a cold deep link — until the loader
 * settles, so the page mounts with its cache already primed and
 * `useTicketQuery` never renders its skeleton. Fire-and-forget would start the
 * request just as early but let the component mount into a pending query, which
 * is exactly the fallback-then-spinner sequence this slice exists to remove.
 * The cost is that a slow API keeps the ticket list on screen with no
 * indication the click landed; a shared pending indicator driven by
 * `useNavigation()` is the answer to that, and it is not this slice's job.
 *
 * Nothing is returned to the route. `ensureQueryData` writes into the shared
 * `QueryClient`, and `useTicketQuery` reads it back out through the same key —
 * react-query stays the cache layer, and the loader only moves *when* the fetch
 * starts (`docs/plans/route-level-data-prefetching.md`, R2).
 */
export async function ticketDetailLoader({ params }: LoaderFunctionArgs) {
  try {
    await queryClient.ensureQueryData(
      // `?? ""` mirrors `useTicketQuery`, so the two agree on the key even for
      // the id the route can never actually match with.
      ticketDetailQueryOptions(params.id ?? ""),
    );
  } catch {
    // Swallowed on purpose: a failed prefetch is not a failed navigation. The
    // page owns every error screen this route has — "Ticket not found" for a
    // 404, an inline message for anything else — and throwing here would hand
    // the navigation to the router's error boundary instead, replacing a
    // destination that has a way back with a generic one that doesn't.
    //
    // The component re-runs the query on mount (react-query's `retryOnMount`
    // retries an errored entry for a new observer), so a broken id costs one
    // extra request on a path that renders no data either way — measured on
    // `/tickets/<max id>`: 2 requests before this loader, 3 after (both counts
    // doubled by StrictMode's dev-only remount). That is the price of leaving
    // the error screens exactly where they were.
  }
  return null;
}
