import { dashboardLayoutQueryOptions } from "@/lib/dashboard-layout-queries";
import { parseDashboardParams } from "@/lib/dashboard-params";
import {
  assistantEffectivenessQueryOptions,
  ticketStatsQueryOptions,
} from "@/lib/dashboard-queries";
import { prefetchLoader, prefetchQuery } from "@/lib/route-prefetch";

/**
 * Starts the dashboard's three requests the moment navigation to `/` begins —
 * which for every user in this app is the moment they finish signing in.
 *
 * Its own module, imported statically by the router, for the same reason as its
 * two siblings: React Router runs a static `loader` in parallel with the route's
 * `lazy` `Component`, so all three responses are on the wire while the page's
 * chunk — Recharts and dnd-kit, by far the heaviest on the site — downloads.
 *
 * This is the route that made `prefetchLoader`'s `allSettled` the shared shape
 * rather than a special case: the page's three `useQuery` calls are concurrent
 * on mount, so a loader that awaited them one after another would move the
 * fetch earlier and make it slower — the range-scoped stats endpoint runs eight
 * queries of its own, and putting the layout round trip in front of it would
 * add its latency to every visit.
 *
 * `request.url` is read through the very function the page reads
 * `useSearchParams` with, so a hand-edited `?range=nonsense` falls back to the
 * same default on both sides and the entry primed here is the one the page then
 * reads. Like `/tickets` and unlike `/tickets/:id`, this loader re-runs on every
 * range and scope change — they move the search string, and React Router's
 * default `shouldRevalidate` returns true whenever it does. Nothing tries to
 * stop that; whichever of the loader and the page's observer gets there first
 * starts the request and the other attaches to it, so one interaction stays one
 * network call per endpoint. The layout query has no params at all, so a range
 * change re-runs its `ensureQueryData` against an entry that is already fresh
 * (`staleTime: 30_000`) and it resolves without a request.
 */
export const dashboardLoader = prefetchLoader(({ request }) => {
  const params = parseDashboardParams(new URL(request.url).searchParams);

  return [
    prefetchQuery(ticketStatsQueryOptions(params)),
    // `{ range }` alone, mirroring the page: the endpoint takes no `scope`, and
    // a key that carried one would be a second entry the page never reads — and
    // a second `/api/tickets/effectiveness` on every range change, since the
    // page's observer would find nothing primed under the key it does read.
    prefetchQuery(assistantEffectivenessQueryOptions({ range: params.range })),
    prefetchQuery(dashboardLayoutQueryOptions()),
  ];
});
