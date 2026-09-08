import type { QueryClient } from "@tanstack/react-query";
import {
  TICKET_EVENT,
  TICKET_EVENT_FIELD,
  type EventOfKind,
  type TicketEvent,
  type TicketEventKind,
} from "@ticket/shared";
import { evalKeys } from "@/lib/eval-queries";
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
 * Mapped over the kind rather than a flat `Record`, so each handler is given
 * *its* member of the union: `ticket_updated` reads `event.ticketId` without
 * narrowing, and `eval_run_changed` — the one kind that names a run instead —
 * cannot reach for a ticket id that is not there.
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
export const EVENT_EFFECT: {
  [K in TicketEventKind]: (
    queryClient: QueryClient,
    event: EventOfKind<K>,
  ) => void;
} = {
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
    // The assignee-toast exception, matching `views` above: refetched rather
    // than marked, because `useAssignmentToasts` is permanently mounted and
    // "stale but not refetched" would mean the toast never fires until
    // something else happens to touch the query. Narrowed to events that
    // actually moved the assignee — status/category churn on somebody else's
    // ticket would otherwise refetch this on every list's worth of traffic
    // for no client that could possibly have a new answer.
    if (event.fields?.includes(TICKET_EVENT_FIELD.assignee)) {
      void queryClient.invalidateQueries({ queryKey: ticketKeys.unread });
    }
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

  /**
   * An eval run started, finished, or fell over.
   *
   * One invalidate for the whole prefix, and the run id is deliberately not
   * used to narrow it: the page shows the list of runs and each run's case
   * results together, and a run appearing moves the list while a run finishing
   * moves the rows inside it. Admin-only at the server, so a non-admin never
   * receives this and the key is never touched on their tabs.
   */
  [TICKET_EVENT.eval_run_changed]: (queryClient) => {
    void queryClient.invalidateQueries({ queryKey: evalKeys.all });
  },
};

/** Apply one event. Unknown kinds are ignored rather than thrown on — a client
 * running older code than the server must degrade to "slightly stale", not to a
 * crashed provider. */
export function applyEvent(queryClient: QueryClient, event: TicketEvent): void {
  // The table is mapped over the kind, so each entry takes its own member of
  // the union and the lookup's type is a union of functions with no common
  // parameter. `event` genuinely is the right member for `event.kind` — that is
  // what the discriminant means — but TypeScript cannot correlate the two
  // across an index like this, so the cast is here, once, rather than a `switch`
  // that would lose the exhaustiveness the table exists for.
  const effect = EVENT_EFFECT[event.kind] as
    ((queryClient: QueryClient, event: TicketEvent) => void) | undefined;
  effect?.(queryClient, event);
}
