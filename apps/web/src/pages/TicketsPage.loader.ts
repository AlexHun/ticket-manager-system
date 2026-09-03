import type { LoaderFunctionArgs } from "react-router-dom";
import { queryClient } from "@/lib/query-client";
import { parseTicketListParams } from "@/lib/ticket-list-params";
import {
  ticketListQueryOptions,
  ticketListQueryParams,
} from "@/lib/ticket-list-query";

/**
 * Starts `GET /api/tickets` the moment navigation to the list begins.
 *
 * Its own module, imported statically by the router, for the same reason as
 * `TicketDetailPage.loader.ts`: React Router runs a static `loader` in parallel
 * with the route's `lazy` `Component`, so the rows are already being fetched
 * while the page's chunk — TanStack Table and all — downloads.
 *
 * `request.url` is the only input, and it is read through the very function the
 * page reads `useSearchParams` with. That is what makes the two agree: the
 * schema-backed fallbacks in `parseTicketListParams` mean a hand-edited
 * `?sort=nonsense` becomes the same default on both sides, so a stale link
 * primes the entry the page then reads instead of a neighbouring one.
 *
 * Unlike the detail route, this loader re-runs constantly — a filter, sort or
 * page change moves the search string, and React Router's default
 * `shouldRevalidate` returns true whenever it does. Nothing here tries to stop
 * that. The page's own `useQuery` fires for the same key at nearly the same
 * moment, and react-query de-dupes by query hash: whichever call arrives first
 * starts the request, the other attaches to it, and one interaction stays one
 * network call.
 *
 * Awaited, not fired and forgotten, which is what removes the second loading
 * state: the router holds the previous screen until the data lands, so the page
 * mounts with its cache primed and `TicketsTableSkeleton` never appears. The
 * cost is the one slice 2 named — a slow API leaves the previous screen up with
 * no cue that the click landed. On this page that is narrower than it sounds,
 * since only a filter combination nobody has visited yet actually waits: a
 * cached key resolves in a microtask, and the rows keep their `aria-busy` fade
 * for every refetch the page still starts itself. The shared pending indicator
 * (`useNavigation()`) that would cover the rest needs the component-test render
 * helper on a data router first, and is still not this slice's job.
 */
export async function ticketsLoader({ request }: LoaderFunctionArgs) {
  const { searchParams } = new URL(request.url);
  try {
    await queryClient.ensureQueryData(
      ticketListQueryOptions(
        ticketListQueryParams(parseTicketListParams(searchParams)),
      ),
    );
  } catch {
    // Swallowed on purpose, as on the detail route: a failed prefetch is not a
    // failed navigation. The page owns this route's error screen — an inline
    // "Failed to load tickets" above filters that still work, so the reader can
    // change one and try again — and throwing here would replace it with the
    // router's error boundary, which offers neither.
  }
  return null;
}
