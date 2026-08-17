import {
  ACTIVITY_EVENT_FIELD,
  TICKET_EVENT,
  type TicketEventField,
} from "@ticket/shared";
import type { ActivityEntry } from "../ticket-activity";
import { publish } from "./hub";

/**
 * The publish vocabulary: one function per thing that happens.
 *
 * The analogue of `ticket-activity.ts`, and split from `hub.ts` for the same
 * reason that file is split from the routes — the hub holds connections, this
 * names events, and neither knows the other's business.
 *
 * **Two rules for every function here, and both are about where the call goes.**
 *
 * 1. **Publish after the commit that made the fact true, never inside the
 *    transaction.** This is why publishing is not folded into `writeActivity`,
 *    which would otherwise be the tidier home: `writeActivity` takes an
 *    `ActivityDb` that is usually a `tx` handle, and cannot know when — or
 *    whether — that transaction commits. A subscriber that refetched on the event
 *    could read pre-commit state, cache it, and then never be told again, because
 *    the event it needed has already fired. The repo has met this shape of bug
 *    once already: "NOTIFY fires on insert, not when a retry becomes due".
 * 2. **Never throw into the caller.** By the time these run, a route has
 *    committed or a job has already appended a reply to a customer's thread. A
 *    failed fan-out is a screen that refreshes a moment late; an exception here
 *    would be a failed request or a retried job that re-answers the customer.
 *    `publish` swallows per-subscriber failures for that reason, and nothing in
 *    this file adds a throw on top.
 */

/**
 * The unattended pipeline moved.
 *
 * Emitted from every point that changes what `/pipeline` draws — the claim, both
 * release paths, the verdict, and ingestion — because the page shows the rail
 * counts, the queue depths and one ticket's trace at once, and any of the three
 * can move without the other two.
 *
 * Admin-only by `EVENT_AUDIENCE`, so this is also the safe way to broadcast the
 * `Processing` claim: agents must not hear it (invisible by design, over in
 * seconds, and pushing it would make every list refetch twice per auto-replied
 * ticket to render no change), while the one screen built to watch it does.
 */
export function publishPipelineChanged(ticketId: number): void {
  publish({
    kind: TICKET_EVENT.pipeline_changed,
    ticketId,
    at: new Date().toISOString(),
  });
}

/**
 * An inbound email opened a ticket.
 *
 * The one event with no ticket on anyone's screen to correct: nobody has this
 * ticket open, because it did not exist a moment ago. What it moves is the
 * sidebar's saved-view counts, which are mounted on every page — so this is the
 * event with the widest audience and the smallest effect.
 */
export function publishTicketCreated(ticketId: number): void {
  publish({
    kind: TICKET_EVENT.ticket_created,
    ticketId,
    at: new Date().toISOString(),
  });
}

/**
 * A message was appended to a thread, in either direction.
 *
 * Direction is deliberately not on the wire. An agent's own reply and a
 * customer's reply invalidate exactly the same queries, and the client re-reads
 * the thread to find out which it was — putting it here would be the beginning
 * of a payload.
 */
export function publishTicketMessage(ticketId: number): void {
  publish({
    kind: TICKET_EVENT.ticket_message,
    ticketId,
    at: new Date().toISOString(),
  });
}

/**
 * Status, category or assignee moved.
 *
 * `fields` is what lets the client decide, without fetching anything, whether a
 * change could have moved a saved-view count or only the detail pane.
 *
 * Publishing nothing for an empty array is the same rule `ticketChanges` keeps:
 * a PATCH that changed nothing is not a change, and an event announcing one
 * would make every open list refetch to render what it already shows.
 */
export function publishTicketUpdated(
  ticketId: number,
  fields: TicketEventField[],
): void {
  if (fields.length === 0) return;

  publish({
    kind: TICKET_EVENT.ticket_updated,
    ticketId,
    at: new Date().toISOString(),
    fields,
  });
}

/**
 * The same thing, from the entries a caller has already written to the trail.
 *
 * For `updateTicket`, which has just diffed the ticket to decide what to record
 * and must not diff it again to decide what to announce. Duplicates are dropped
 * because two entries can name one field — nothing does that today, but
 * `ticketChanges` returns an array precisely so that one day something can.
 */
export function publishTicketChanges(
  ticketId: number,
  entries: ActivityEntry[],
): void {
  const fields = entries
    .map((entry) => ACTIVITY_EVENT_FIELD[entry.action])
    .filter((field): field is TicketEventField => field !== null);

  publishTicketUpdated(ticketId, [...new Set(fields)]);
}
