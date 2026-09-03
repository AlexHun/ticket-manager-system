import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { TicketEffectivenessQuery, TicketStatsQuery } from "@ticket/core";
import type {
  AssistantEffectivenessResponse,
  TicketStatsResponse,
} from "@ticket/shared";
import { api } from "@/lib/api";
import { ticketKeys } from "@/lib/ticket-queries";

/**
 * The two ticket-derived dashboard queries, written down once because two
 * callers start each of them: the route's loader (`DashboardPage.loader.ts`)
 * primes them at navigation time, and `DashboardPage`'s `useQuery` calls read
 * them back on mount. As on the list and detail routes, the two only collapse
 * into a single request if the key *and* the function are identical.
 *
 * The dashboard's third query — the saved panel layout — stays in
 * `dashboard-layout-queries.ts`, next to the mutations that write it and the
 * key all three share.
 *
 * Deliberately small, like its two siblings: the router imports this
 * statically, so everything it pulls in lands in the entry chunk. `api` and
 * `ticketKeys` are already there, and the `@ticket/core` imports are types, so
 * they erase.
 */
export function ticketStatsQueryOptions(params: TicketStatsQuery) {
  return queryOptions({
    queryKey: ticketKeys.stats(params),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketStatsResponse>("/api/tickets/stats", {
        params,
        signal,
      });
      return data;
    },
    // Changing the range holds the rendered dashboard rather than replacing it
    // with a skeleton, so the layout never collapses and rebuilds under you.
    // Read only by the page's observer — `ensureQueryData` has no placeholder
    // to show — but it belongs with the rest of the query rather than beside
    // the hook.
    placeholderData: keepPreviousData,
  });
}

/**
 * The assistant-effectiveness panel. Keyed by range alone — the endpoint takes
 * no `scope` — which is why both call sites pass `{ range }` rather than the
 * whole dashboard param object: a `scope` in the key here would be a second
 * cache entry per scope for a response that never varies with it.
 */
export function assistantEffectivenessQueryOptions(
  params: TicketEffectivenessQuery,
) {
  return queryOptions({
    queryKey: ticketKeys.effectiveness(params),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<AssistantEffectivenessResponse>(
        "/api/tickets/effectiveness",
        { params, signal },
      );
      return data;
    },
    placeholderData: keepPreviousData,
  });
}
