import type { LoaderFunctionArgs } from "react-router-dom";
import { dashboardLayoutQueryOptions } from "@/lib/dashboard-layout-queries";
import { parseDashboardParams } from "@/lib/dashboard-params";
import {
  assistantEffectivenessQueryOptions,
  ticketStatsQueryOptions,
} from "@/lib/dashboard-queries";
import { queryClient } from "@/lib/query-client";

/**
 * Starts the dashboard's three requests the moment navigation to `/` begins —
 * which for every user in this app is the moment they finish signing in.
 *
 * Its own module, imported statically by the router, for the same reason as its
 * two siblings: React Router runs a static `loader` in parallel with the route's
 * `lazy` `Component`, so all three responses are on the wire while the page's
 * chunk — Recharts and dnd-kit, by far the heaviest on the site — downloads.
 *
 * The three are started together and awaited together, which is the thing this
 * slice had to get right. The page's three `useQuery` calls are concurrent on
 * mount today, so a loader that awaited them one after another would move the
 * fetch earlier and make it slower — the range-scoped stats endpoint runs eight
 * queries of its own, and putting the layout round trip in front of it would
 * add its latency to every visit. `allSettled` keeps them parallel *and* keeps
 * one failure from cancelling the wait on the other two.
 *
 * Rejections are dropped rather than rethrown, as on the other two routes: a
 * failed prefetch is not a failed navigation. The page owns this route's error
 * screen — `extractErrorMessage(error, "Failed to load dashboard")` in a
 * `role="alert"` above filters that still work — and throwing here would replace
 * it with the router's error boundary, which offers neither. Nothing is returned
 * to the route: `ensureQueryData` writes into the shared `QueryClient` and the
 * page's hooks read it back through the same keys, so react-query stays the
 * cache layer and only the *trigger point* moved (R2).
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
export async function dashboardLoader({ request }: LoaderFunctionArgs) {
  const { searchParams } = new URL(request.url);
  const params = parseDashboardParams(searchParams);

  await Promise.allSettled([
    queryClient.ensureQueryData(ticketStatsQueryOptions(params)),
    // `{ range }` alone, mirroring the page: the endpoint takes no `scope`, and
    // a key that carried one would be a second entry the page never reads — and
    // a second `/api/tickets/effectiveness` on every range change, since the
    // page's observer would find nothing primed under the key it does read.
    queryClient.ensureQueryData(
      assistantEffectivenessQueryOptions({ range: params.range }),
    ),
    queryClient.ensureQueryData(dashboardLayoutQueryOptions()),
  ]);

  return null;
}
