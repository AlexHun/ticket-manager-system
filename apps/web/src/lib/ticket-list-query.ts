import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import type { TicketsQuery } from "@ticket/core";
import type { TicketsListResponse } from "@ticket/shared";
import { api } from "@/lib/api";
import { ticketKeys } from "@/lib/ticket-queries";

/**
 * What `GET /api/tickets` is actually asked for: the list state with every
 * empty filter dropped rather than sent as a blank the API must ignore.
 */
export interface TicketListQueryParams {
  sort: TicketsQuery["sort"];
  order: TicketsQuery["order"];
  page: number;
  pageSize: number;
  status?: string;
  category?: string;
  assignedTo?: string;
  q?: string;
}

/**
 * List state → request params, in one place because two callers now derive
 * them from the same URL and must agree to the character.
 *
 * The params object *is* the query key (`ticketKeys.list`), so a difference as
 * small as `status: ""` beside a dropped `status` would be a second cache entry
 * and a second request — the exact duplicate this slice exists to avoid. The
 * loader passes `parseTicketListParams(request.url)` straight through; the page
 * passes the same parse with `q` swapped for its debounced input, which is the
 * one value that leads the URL rather than following it.
 */
export function ticketListQueryParams(
  state: TicketsQuery,
): TicketListQueryParams {
  const params: TicketListQueryParams = {
    sort: state.sort,
    order: state.order,
    page: state.page,
    pageSize: state.pageSize,
  };
  if (state.status) params.status = state.status;
  if (state.category) params.category = state.category;
  if (state.assignedTo) params.assignedTo = state.assignedTo;
  const q = state.q?.trim();
  if (q) params.q = q;
  return params;
}

/**
 * One page of tickets, written down once because two callers start the same
 * fetch: the route's loader (`TicketsPage.loader.ts`) primes it at navigation
 * time, and `TicketsPage`'s `useQuery` reads it back on mount.
 *
 * Same reasoning as `ticket-detail-query.ts` — the two only collapse into a
 * single request if the key *and* the function are identical — with one extra
 * consequence here: this key changes on every filter, sort and page change, so
 * the loader re-runs constantly (React Router's default `shouldRevalidate`
 * returns true whenever the search string moves). That is not a problem to
 * suppress. Whichever of the two gets there first starts the request and the
 * other attaches to it: react-query de-dupes by query hash, so a filter change
 * costs one call, not two.
 *
 * Deliberately small, like its detail-page sibling: the router imports this
 * statically, so everything it pulls in lands in the entry chunk. `api` and
 * `ticketKeys` are already there.
 */
export function ticketListQueryOptions(params: TicketListQueryParams) {
  return queryOptions({
    queryKey: ticketKeys.list(params),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketsListResponse>("/api/tickets", {
        params,
        signal,
      });
      return data;
    },
    // Sorting, filtering and paging each swap the whole result set. Hold the
    // current rows on screen while the new ones load instead of flashing the
    // skeleton on every interaction. Read only by the page's observer —
    // `ensureQueryData` has no placeholder to show — but it belongs with the
    // rest of the query rather than beside the hook.
    placeholderData: keepPreviousData,
  });
}
