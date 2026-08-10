import { useQuery } from "@tanstack/react-query";
import type { TicketAssigneesResponse } from "@ticket/shared";
import { api } from "@/lib/api";
import { ticketAssigneesKey } from "@/lib/ticket-queries";

/**
 * How long the roster is trusted without a refetch. Users are created rarely,
 * and this list is the same for every ticket and every filter.
 *
 * Long enough that nothing reloads it on its own within a session, so the
 * mutations that *do* change it have to say so: `UserDialog` and
 * `DeleteUserDialog` invalidate `ticketAssigneesKey` on success. Without that
 * an admin creates a user, walks to a ticket, and the picker is still showing
 * the roster from five minutes ago.
 */
const ROSTER_STALE_MS = 5 * 60_000;

interface UseAssigneesOptions {
  /**
   * Off means "don't fetch, but do read the cache". The tickets list uses it to
   * keep the roster off the page load — see `AssigneeFilter`.
   */
  enabled?: boolean;
}

/**
 * Everyone a ticket can be handed to.
 *
 * One hook for the detail page's picker and the list page's filter, so the two
 * share a cache entry: opening a ticket warms the filter and vice versa, and
 * there is a single place where the staleness rule above is written down.
 */
export function useAssigneesQuery({ enabled = true }: UseAssigneesOptions = {}) {
  return useQuery({
    queryKey: ticketAssigneesKey,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketAssigneesResponse>(
        "/api/tickets/assignees",
        { signal },
      );
      return data.assignees;
    },
    staleTime: ROSTER_STALE_MS,
    enabled,
  });
}
