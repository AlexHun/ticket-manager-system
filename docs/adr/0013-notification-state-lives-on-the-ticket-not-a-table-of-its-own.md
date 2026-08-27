# Notification state lives on the ticket, not a table of its own

There is no `Notification` model. An assignment is "unread" exactly when
`Ticket.assignedToId` names the viewer and `Ticket.assignmentSeenAt` is null;
`GET /api/tickets/:id` sets that column the moment the assignee opens the
ticket, and every write to `assignedToId` clears it back to null. The live
half needs nothing new on the wire either: `updateTicket` in
`routes/tickets.ts` already publishes a `ticket_updated` event with
`fields: ["assignee"]` whenever the diff includes it
([#18](https://github.com/AlexHun/ticket-manager-system/issues/18)'s own
premise), and [`TicketEvent`](../../packages/shared/src/index.ts) carries no
payload by design — an id and a verb, never data, because the client already
holds an authenticated `GET` for every fact it might need and a payload would
be a second, unguarded read path. A client that has just been told "a ticket
of yours moved" reacts by re-reading its own unread count through that same
`GET`, exactly like every other consumer of the stream. No change to
`TicketEvent`, `TICKET_EVENT_FIELD` or `EVENT_AUDIENCE` is needed to carry
this feature — the plumbing #18 pointed at was already sufficient.

This is a sharper version of the issue's third option ("derive unread from
tickets assigned to me whose assignment I have not yet opened") rather than
either of the first two. It is not schema-free, though: "not yet opened" has
to survive a reload and follow the agent across devices, and nothing durable
can answer that question without being written somewhere. The honest reading
of that option is "the smallest write that makes the derivation durable," not
"no write at all."

## Considered Options

**Live-only signal plus a client-side filter, no schema at all.** The event
already exists; a toast and an "assigned to me" filter (`TICKET_VIEW.mine`
already provides the filter) would ship today. Rejected because it fails the
one property the feature exists for: nothing survives a reload, and nobody is
told about an assignment made while their tab was closed. A support agent who
was at lunch when a ticket landed on them is exactly the case "reload and
notice" was failing before this issue existed — a live-only signal reproduces
the bug it was filed to fix, just with a nicer transition.

**A persisted `Notification` table**, one row per assignment, with its own
read/unread state and an unread count that follows the agent across devices.
Rejected on cardinality grounds as much as cost: `assignedToId` is
single-valued, so "has the *current* assignment been seen" only ever has one
live answer per ticket, not a history of answers per event. A table of rows
would duplicate the fact `TicketActivity.assignee_changed` already records
durably (`fromValue`/`toValue`, `actorName`, `createdAt` —
[0012](./0012-audit-trails-are-pruned-after-one-year.md) already prunes it on
a schedule) and add a second source of truth about the same transition. It
would also inherit everything 0012 had to decide for the four existing audit
tables — a retention window, a prune job, an exception list — to answer a
question a single nullable column answers for free: a column has no rows to
retain, because it does not accumulate, it just travels with the ticket it
describes.

**Deriving "seen" from existing writes, with truly nothing new** — e.g.
reading it off the next `TicketActivity` row an agent produces on the ticket
after the assignment, or off `Message.authorId`. Attractive because it adds
no column at all, but it answers a different question than the one asked:
"the agent has since acted on this ticket" is not "the agent has since opened
this ticket". A ticket that is correctly read and correctly left alone —
nothing to do yet — would stay unread forever, which is a worse failure mode
than the one being fixed: a badge that never clears is one an agent learns to
ignore. Rejected in favor of marking the view itself.

## Consequences

**One migration, one column.** `Ticket.assignmentSeenAt DateTime?`, indexed
alongside the existing `assignedToId` index (`@@index([assignedToId,
assignmentSeenAt])`) so "my unread tickets" is a single indexed lookup. The
assignment route (`ticketsRouter.patch("/:id/assign", ...)`, the sole writer
of `assignedToId` today) sets it to `null` in the same `data` object it
already builds — no new codepath, no diffing logic beyond what
`updateTicket` already does to decide whether to write a
`TicketActivity` row.

**Marking a ticket seen is a side effect of reading it, not a separate
endpoint.** `GET /api/tickets/:id` follows the read with a conditional
`updateMany({ where: { id, assignedToId: viewerId, assignmentSeenAt: null },
data: { assignmentSeenAt: now() } })` — the same read-nothing-then-conditional-
write shape `POST /api/outbox/:id/retry`
([0009](./0009-outbound-email-goes-through-a-transactional-outbox.md)) uses to
make two concurrent callers land on one winner without a preceding read. No
`POST /api/tickets/:id/seen` exists or is needed: "the agent opened the
detail page" is precisely what that request already means, and a client that
had to remember to call a second endpoint could always forget to.

**"Unread" and "mine" are different predicates and must not be conflated.**
`TICKET_VIEW.mine` (`ticketViewParams` in `@ticket/shared`) is
`assignedTo = viewer AND status ∈ backlog` — a workload view, unaffected by
this ADR. Unread is `assignedTo = viewer AND assignmentSeenAt IS NULL`,
with no status filter: a Resolved or Closed ticket reassigned to someone is
still news to them, and scoping the notification to the backlog would silently
drop that case. The sibling implementation issues
([#28](https://github.com/AlexHun/ticket-manager-system/issues/28),
[#29](https://github.com/AlexHun/ticket-manager-system/issues/29)) need their
own query, not a reuse of `mine`'s.

**Works across devices and survives a reload, by construction.** The column
is read wherever the agent signs in from, so two tabs — or a phone and a
laptop — agree on what is unread without either one polling the other.

**Reversing this later costs one column.** Dropping the feature drops
`assignmentSeenAt` and the two call sites that touch it; nothing else in the
schema depends on it existing, the way [0012](./0012-audit-trails-are-pruned-after-one-year.md)
noted for its own reversal.

**Deferred to the implementation issues, deliberately not settled here:** the
exact shape of the unread count on the wire (a field on an existing response
vs. a new endpoint), the toast/badge UI, and whether `CONTEXT.md` gains an
"unread" or "seen" glossary entry once the feature has shipped and the term
has actually stabilized in the code.
