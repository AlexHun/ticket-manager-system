import { prefetchLoader, prefetchQuery } from "@/lib/route-prefetch";
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
 * while the page's chunk — TanStack Table and all — downloads. What the loader
 * then does with the query is `prefetchLoader`'s business, and its reasons live
 * there; this file says only which query the URL implies.
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
 * The awaiting `prefetchLoader` does costs what slice 2 named — a slow API
 * leaves the previous screen up with no cue that the click landed. On this page
 * that is narrower than it sounds, since only a filter combination nobody has
 * visited yet actually waits: a cached key resolves in a microtask, and the
 * rows keep their `aria-busy` fade for every refetch the page still starts
 * itself.
 */
export const ticketsLoader = prefetchLoader(({ request }) => [
  prefetchQuery(
    ticketListQueryOptions(
      ticketListQueryParams(
        parseTicketListParams(new URL(request.url).searchParams),
      ),
    ),
  ),
]);
