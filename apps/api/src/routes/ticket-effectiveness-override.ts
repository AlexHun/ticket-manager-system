import { TICKET_ACTOR_KIND, type TicketActorKind } from "@ticket/shared";

/**
 * Did an agent change a category the classifier set?
 *
 * The classifier writes its own `category_changed` activity row exactly once
 * per ticket — `jobs/classify-ticket.ts` only ever fires while `category` is
 * still null, so there is never a second one to collide with. So "the
 * classifier set this ticket's category" is exactly "an assistant-authored
 * `category_changed` row exists for it", and "an agent later changed it" is
 * exactly "an agent-authored one does too" — no ordering check needed, because
 * the assistant's row can only ever be the first.
 *
 * Kept in its own module, with no `../db` import, so a `bun test` file can
 * exercise it directly against seeded `TicketActivity` rows without pulling in
 * the process-wide `./db` mock registry other route tests already occupy — see
 * `ticket-effectiveness.test.ts` and the "registry is one process wide" note
 * in `docs/standards/testing.md`.
 */
export function countCategoryOverrides(
  rows: { ticketId: number; actorKind: TicketActorKind }[],
): number {
  const kindsByTicket = new Map<number, Set<TicketActorKind>>();
  for (const row of rows) {
    const kinds = kindsByTicket.get(row.ticketId) ?? new Set();
    kinds.add(row.actorKind);
    kindsByTicket.set(row.ticketId, kinds);
  }

  let overridden = 0;
  for (const kinds of kindsByTicket.values()) {
    if (
      kinds.has(TICKET_ACTOR_KIND.assistant) &&
      kinds.has(TICKET_ACTOR_KIND.agent)
    ) {
      overridden++;
    }
  }
  return overridden;
}
