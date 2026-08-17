import type { QueryClient } from "@tanstack/react-query";
import { TICKET_EVENT, type TicketEvent, type TicketEventKind } from "@ticket/shared";
import { pipelineKeys } from "@/lib/pipeline-queries";
import { ticketKeys } from "@/lib/ticket-queries";

/**
 * What each pushed event invalidates.
 *
 * The pure half of the realtime channel — no network, no `EventSource`, no
 * React — so what a given event does to the cache can be read in one table
 * instead of traced through a provider.
 *
 * A `Record` over the event union rather than a `switch`, and for the reason
 * `DECLINE_STAGE` is one: **a new event kind is a compile error until somebody
 * says which queries stop being right when it arrives.** An event nothing reacts
 * to is the failure that looks exactly like the channel being down.
 *
 * Two things to keep if this is rewritten:
 *
 * 1. **`invalidateQueries` defaults to `refetchType: "active"`.** Only mounted
 *    queries refetch; everything else is marked and reloads when it is next
 *    looked at. That default is the entire reason N open tabs do not become N
 *    refetches of the whole app per event, so do not override it except where
 *    there is an argument to — `ticketKeys.views` is the one case, and it has
 *    one (below).
 * 2. **Events are hints, never data.** Nothing here writes to the cache from an
 *    event's contents; every one of these re-reads through the normal
 *    authenticated `GET`. That is what keeps authorization in the routes, and it
 *    is why a `Processing` ticket cannot be pushed onto a screen that
 *    `GET /api/tickets` deliberately hides it from.
 */
export const EVENT_EFFECT: Record<
  TicketEventKind,
  (queryClient: QueryClient, event: TicketEvent) => void
> = {
  /**
   * A ticket arrived. Nothing is open on it yet, so the only thing that can be
   * wrong on screen is a count.
   */
  [TICKET_EVENT.ticket_created]: (queryClient) => {
    void queryClient.invalidateQueries({
      queryKey: ticketKeys.all,
      refetchType: "none",
    });
    // Refetched rather than marked, unlike everything else under `all`. The
    // sidebar's observer is permanently mounted, so "stale but not refetched"
    // means watching the Unassigned badge keep its old number while the ticket
    // it is wrong about sits in the list below it. `useTicketField` makes the
    // same exception for the same reason.
    void queryClient.invalidateQueries({ queryKey: ticketKeys.views });
  },

  /** Status, category or assignee moved — possibly by somebody else. */
  [TICKET_EVENT.ticket_updated]: (queryClient, event) => {
    void queryClient.invalidateQueries({
      queryKey: ticketKeys.all,
      refetchType: "none",
    });
    void queryClient.invalidateQueries({ queryKey: ticketKeys.views });
    // Exact keys, so a ticket nobody has open is marked and not fetched.
    void queryClient.invalidateQueries({
      queryKey: ticketKeys.detail(event.ticketId),
    });
    void queryClient.invalidateQueries({
      queryKey: ticketKeys.activity(event.ticketId),
    });
  },

  /**
   * A message was appended, either direction.
   *
   * `views` is in here because a customer reply can reopen a machine-resolved
   * ticket, and `all` because `lastMessageAt` moved — a list sorted by it is now
   * in the wrong order, not just missing a row.
   */
  [TICKET_EVENT.ticket_message]: (queryClient, event) => {
    void queryClient.invalidateQueries({
      queryKey: ticketKeys.detail(event.ticketId),
    });
    void queryClient.invalidateQueries({
      queryKey: ticketKeys.all,
      refetchType: "none",
    });
    void queryClient.invalidateQueries({ queryKey: ticketKeys.views });
  },

  /**
   * The unattended pipeline moved.
   *
   * One invalidate for the whole prefix: the page shows the rail counts, the
   * live queue depths and one ticket's trace at once, and any of the three can
   * move without the others. Admin-only at the server, so a non-admin never
   * receives this and the key is never touched on their tabs.
   */
  [TICKET_EVENT.pipeline_changed]: (queryClient) => {
    void queryClient.invalidateQueries({ queryKey: pipelineKeys.all });
  },
};

/** Apply one event. Unknown kinds are ignored rather than thrown on — a client
 * running older code than the server must degrade to "slightly stale", not to a
 * crashed provider. */
export function applyEvent(queryClient: QueryClient, event: TicketEvent): void {
  EVENT_EFFECT[event.kind]?.(queryClient, event);
}
