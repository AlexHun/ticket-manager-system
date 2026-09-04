import { prefetchLoader, prefetchQuery } from "@/lib/route-prefetch";
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
 * What it does with that query — await it, tolerate a rejection, return nothing
 * and leave the result in the query cache — is `prefetchLoader`'s, not this
 * route's, and the reasons live there. The one thing that is genuinely this
 * route's is which query the URL implies: this is the only one of the three
 * that reads `params` rather than the search string, and the only one whose
 * loader does not re-run until the id changes.
 */
export const ticketDetailLoader = prefetchLoader(({ params }) => [
  // `?? ""` mirrors the page's own `useQuery`, so the two agree on the key even
  // for the id the route can never actually match with.
  prefetchQuery(ticketDetailQueryOptions(params.id ?? "")),
]);
