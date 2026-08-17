import { TICKET_EVENT } from "@ticket/shared";
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
