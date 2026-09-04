# A ticket transition is not a module

There will be no shared owner for "a conditional ticket write earns an Activity
entry and an event only if it matched, and the event is published after the
commit, never inside it." The rule stays written down and hand-kept at each
site. What changes instead is that the half of it worth enforcing —
**never inside the transaction** — becomes a runtime guard at the `publish`
seam, which already exists and which no call site has to learn about.

Answered from a spike ([#153](https://github.com/AlexHun/ticket-manager-system/issues/153)).
The five sites were compared before a line was written, and a candidate
interface was sketched and tested against the argument `assignIfUnowned`
already makes in `jobs/auto-reply-ticket.ts` — that folding conditions which
are not the same condition into one statement makes the statement worse. It
does not survive that test.

## The five sites, compared

| | guard | actor | entries | activity write | events | order after commit |
| --- | --- | --- | --- | --- | --- | --- |
| `updateTicket` (`routes/tickets.ts`) | a **before/after diff**, not a `where` | `agentActor`, sync, off the session | 0..N, one per changed field | `writeActivity(tx, …)` **inside** the transaction; a failure rolls the update back | `publishTicketChanges`, derived from the entries | entries, then publish |
| ingestion — reopen (`ingest.ts`) | `where autoResolvedAt != null`, inside an array `$transaction` with the message insert | `customerActor`, sync | 1 (`reopened`) + 0..1 (`assignee_changed`) behind a **second** conditional write with its own guard and its own name lookup | `recordActivity`, after the commit, swallowed | an **unconditional** `ticket_message` beside an accumulated `ticket_updated` | entries, then publish |
| ingestion — create (`ingest.ts`) | none; nothing is conditional | `customerActor`, sync | 1 (`created`) | `writeActivity(tx, …)` **inside** the transaction | `pipeline_changed` + `ticket_created`, neither derived from an entry | publish only |
| classification (`jobs/classify-ticket.ts`) | `where category: null` | `await assistantActor()`, **async, one query** | 1 (`category_changed`) | `recordActivity`, swallowed | `pipeline_changed` + `ticket_updated([category])` | **publish, then entries** |
| auto-reply — release (`jobs/auto-reply-ticket.ts`) | `where status: Processing` | `await assistantActor()`, async | 0..1 (`auto_declined`), gated on the `decline` **parameter**, not on the guard, and only on the `Open` exit | `recordActivity`, swallowed | `pipeline_changed` on both exits, `ticket_updated([status, assignee])` on one | publish, write, publish, **then entries** |
| auto-reply — resolve (`jobs/auto-reply-ticket.ts`) | `where status: Processing`, **inside** a transaction that also writes the reply and may throw to roll the resolve back | `await assistantActor()`, async | 1 (`auto_resolved`), deliberately covering the resolve **and** a later assignment write outside the guard | `recordActivity`, swallowed | three: `pipeline_changed`, `ticket_updated([status, assignee])`, `ticket_message` | entries, then publish |

Six rows, not five: `ingest.ts` contains two of them, and they disagree with
each other about whether the Activity row belongs inside the transaction — for
a stated reason, on the same function, twenty lines apart.

Read down the columns and there are exactly two facts every row shares, and
each is one line of code: **check `count > 0` before recording**, and **publish
after the `await`**. Everything else varies, and varies for reasons each site
argues in its own comments.

## Considered Options

**One `transition()` owning the write, the entry and the event.** The sketch
the spike tested:

```ts
transition({
  ticketId, where, data,          // the guard and the change
  actor,                          // sync value or async thunk
  entries,                        // array or a callback over the result
  events,                         // list, or derived from the entries
  tx, activityInTransaction,      // route vs. job
  onCommitted,                    // sendReply, assignIfUnowned, enqueueAutoReply
})
```

Nine parameters before the first caller, three of them callbacks. Rejected on
four counts, each traceable to a specific row above:

*`where` + `data` cannot express two of the six.* `updateTicket`'s guard is a
diff, not a row-level condition, and must stay one: the route has to tell a
404 (no row) from a no-op (row unchanged) and return the whole ticket either
way. The auto-reply's resolve and ingestion's reopen each carry a *second*
write in the same transaction — `sendReply`, the message insert — and the
resolve's second write can throw to roll the guarded one back. A parameter
pair that describes one statement describes neither.

*The entries do not follow from the guard.* Only classification's do. Elsewhere
they come from a diff, from a second conditional write with a different `where`,
from a parameter that is not the guard at all (`decline`), or are deliberately
made one entry for two writes. Five of six need a callback — and a callback is
the caller writing the code, with a wrapper around it.

*The events do not follow from the entries.* `publishTicketChanges` already
derives events from entries, and it is used at exactly one site, because it is
only true at one site. Everywhere else there are events with no entry
(`pipeline_changed` on all four automated rows), entries with no event, an
unconditional event beside a conditional one, and an event that belongs to
`sendReply` rather than to the transition.

*The deletion test.* Delete the module and what reappears at the callers is a
`count > 0` check and a publish placed after an `await`. Complexity does not
reappear across N callers; it never left them. That is the definition of a
pass-through with an options bag — a shallow module wearing a deep module's
name, which is what [#153](https://github.com/AlexHun/ticket-manager-system/issues/153)
was filed to find out and what `assignIfUnowned` already warns against for a
single `updateMany`.

There is a fifth signal, from `CONTEXT.md` rather than from the code: **the
thing this module would own has no name in the glossary.** *Claim*, *Handoff*,
*Reopen*, *Decline*, *Classification* are all there; "transition" appears only
inside the definition of *Activity*, as a word describing what an entry
records. A module whose subject the domain has never needed a noun for is
usually a module the domain does not have.

**Extracting only the shared half — a `recordAndPublish(count, entries, events)`
helper.** Genuinely smaller, and it does hold for four of the six rows.
Rejected because it collapses the one axis that is actually load-bearing and
actually wrong today: the ordering *between* the entry and the event (see
below). A helper that takes both and does them in a fixed order would fix that
by accident, which sounds like an argument for it — but it would also make the
route site, where the entry is inside the transaction and the event is derived
from the entries, the one caller that cannot use it. Four callers, one
excluded, saving two lines each, and the excluded one is the only site a person
reads first.

**Leaving it entirely alone**, which is what the issue's "no" branch implies.
Rejected as incomplete rather than wrong: the risk the issue names — "nothing
but review stops a sixth site publishing inside the transaction" — is real,
already met once in this repo ("NOTIFY fires on insert, not when a retry
becomes due"), and unaffected by deciding not to build a module. A spike that
answers no and stops leaves the stated hazard exactly where it was.

## Consequences

**The guard stays a row-level condition on the write itself.** Nothing here
introduces a read-then-write; every `where` in the table above is untouched,
and [0007](./0007-background-jobs-run-in-the-application-database.md)'s rule —
the ticket row is the source of truth, the job is only a nudge — is the reason
five of the six are shaped that way in the first place.

**`publish` learns to refuse a call made inside a transaction, and no call site
changes.** `events/hub.ts` already documents `publish` as the only way in and
the seam a multi-replica upgrade would use; this is a second thing that seam is
worth. An `AsyncLocalStorage` is entered by a wrapper around the interactive
form of `prisma.$transaction` in `db.ts`, and `publish` reads it: outside
production it throws, in production it logs an error and fans out anyway,
because a late event is a screen that refreshes a moment late and a thrown one
is a failed request or a job that re-answers a customer.

Measured on this repo's stack (Bun 1.3.13, Prisma 7.9.1, PGLite via
`src/test/pg.ts`) rather than assumed, because the whole proposal rests on it:
the store is visible synchronously inside the callback, still visible after an
awaited Prisma call, still visible inside a nested async helper — the shape
`sendReply(…, tx)` has — absent again once the transaction resolves, and
**absent on a concurrent non-transactional path running beside one**, which is
the case that would have made the guard useless under two workers.

Scope is nine call sites, all in `apps/api/src`, and it is the whole of the
interactive form; the array form (`$transaction([…])`) takes no callback and so
cannot publish from inside one at all. Filed as
[#177](https://github.com/AlexHun/ticket-manager-system/issues/177).

**The comparison found one real defect, and it is not the one the issue
expected.** No site publishes inside a transaction. Two publish *before* the
Activity row: classification, and the auto-reply's release to `Open`. Both are
`ticket_updated`, and `EVENT_EFFECT` in `apps/web/src/lib/realtime-events.ts`
invalidates `ticketKeys.activity(ticketId)` on exactly that event — so an open
detail pane can refetch the trail before the entry lands, cache the version
without it, and never be told again. The window is not an instant: `recordActivity`
first awaits `assistantActor()`, which is an uncached `findFirst` on the user
table, and then the insert. Two round trips. Filed as
[#176](https://github.com/AlexHun/ticket-manager-system/issues/176); the fix is
moving one `await` above two lines, in two files.

That defect is also the argument for this ADR rather than against it. It was
found by reading six sites against each other, which is what the issue asked
for and what a shared module would have made unnecessary — and it is the one
kind of divergence a module *would* have prevented. The trade is deliberate:
two lines of duplicated care per site, against an interface that no site could
have used without a callback.

**The rule keeps its home in prose, and the prose is already load-bearing.**
`ticket-activity.ts`'s header owns "an entry is written only when the change
actually happened"; `events/ticket-events.ts`'s header owns "publish after the
commit, never inside it". Neither moves. A seventh site is still a review
question for the entry half — but no longer for the transaction half, which is
the half that fails silently.

**Reversing this costs nothing that is not already written.** If a sixth and
seventh site arrive that genuinely share a guard, an actor and an event set,
the table above is the evidence for revisiting it, and the two rows that would
have to join it are named.
