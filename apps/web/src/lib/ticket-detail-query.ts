import { queryOptions } from "@tanstack/react-query";
import type { TicketDetailResponse } from "@ticket/shared";
import { api } from "@/lib/api";
import { isClientError } from "@/lib/errors";
import { ticketKeys } from "@/lib/ticket-queries";

/**
 * One ticket, written down once because two callers now start the same fetch.
 *
 * `TicketDetailPage`'s `useQuery` reads it on mount; the route's loader
 * (`TicketDetailPage.loader.ts`) primes it at navigation time, before the
 * page's chunk has finished downloading. Those two only collapse into a single
 * request if the key *and* the function are identical — a key spelled twice
 * would be two cache entries, and a second `queryFn` would be a second fetch
 * against the same one. `queryOptions` keeps them one object and types the
 * result for both call sites.
 *
 * Deliberately small: this module is imported statically by the router, so
 * everything it pulls in lands in the entry chunk. `api` and `errors` are
 * already there (the sidebar's saved-view counts use both) and `ticketKeys`
 * has no runtime dependencies at all — measured, the whole slice moved the
 * entry chunk 327.47 kB → 328.06 kB and took the same weight back out of
 * `TicketDetailPage`'s. Keep anything heavier out of here, or the loader
 * starts costing every signed-out visitor what it saves the ticket page.
 */
export function ticketDetailQueryOptions(id: string) {
  return queryOptions({
    // Shares the "tickets" prefix with the list key so one invalidate can reach
    // both; "detail" keeps it from ever colliding with the list's params object.
    queryKey: ticketKeys.detail(id),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketDetailResponse>(
        `/api/tickets/${id}`,
        { signal },
      );
      return data.ticket;
    },
    // A rejected request is an answer, not a flake: a bad id will still be bad
    // three retries later, and the backoff only delays the screen that explains
    // it. Genuine transient failures (network, 5xx) still get the default.
    retry: (failureCount, error) => !isClientError(error) && failureCount < 3,
  });
}
