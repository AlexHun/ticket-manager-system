# Outbound email goes through a transactional outbox

Nothing in this app hands an email to a provider directly. Every email it means
to send is first written as an `OutboundEmail` row in the same transaction as
whatever caused it, and a background worker makes the network call afterwards.
The provider itself is reached through exactly one module, `mail/transport.ts`,
so binding Postmark is a change to that file and some environment variables
rather than a change to any caller.

## Considered Options

**Sending inline, where the decision to send is made**, is the obvious path and
is impossible here. `sendReply` is called *inside* `prisma.$transaction` by
`jobs/auto-reply-ticket.ts`, deliberately, so that the reply and the status
transition proving the worker still held its claim commit together. An HTTP call
there would hold a Postgres transaction open across a round trip to a third
party, and a rollback cannot un-send an email. The transaction boundary that
makes the auto-reply safe is the same one that forbids doing the send in place.

**A queue entry alone, with no row**, was the other candidate — enqueue a job
carrying the message and let it compose the email. It was rejected because it
leaves nowhere to record what happened. Today "the row exists" and "the customer
got it" are the same event, because writing is all that happens; the moment a
provider exists they are two facts that can disagree, and only a row can hold
the disagreement.

## Consequences

**A deployment with no mail provider is a supported state, not a degraded one.**
The worker marks such rows `undeliverable` — a status distinct from `failed`,
because nothing was attempted and nothing is wrong — and the outbox screen at
`/outbox` is then the delivery mechanism: an admin reads an invitation link off
the page and passes it on. That is what makes it possible for
[ADR-0011](./0011-nobody-types-somebody-elses-password.md) to remove admin-typed
passwords before any mail provider exists.

**The outbox holds live credentials.** An invitation or password-reset body
contains a working single-use link until it expires, so `GET /api/outbox` is
admin-only and read-only. An admin can already create and delete accounts, so
this grants no authority they lacked; it does make that authority more direct.

**Terminal statuses need a human way out, and it is one route.** The worker
settles a row it could not deliver — `undeliverable` with no provider, `failed`
once the ladder is exhausted — and nothing reopens either on a schedule, because
an outbox that retries indefinitely turns a provider outage into duplicate mail.
That leaves every email written before a provider was bound stuck, which is not
a hypothetical: it is the state this whole deployment is in. `POST
/api/outbox/:id/retry` is the answer — admin-only, conditional on the row still
being in one of those two statuses, with the re-enqueue inside the same
transaction as the flip. The condition lives in the `updateMany`'s `where`
rather than in a preceding read, so two admins pressing the button at once
cannot both win, and a `sent` row is unreachable from it.

**The table has a retention policy, and it is per kind because the rows are two
different things.** `jobs/prune-outbox.ts` sweeps hourly. A `reply` row is a
duplicate of `Message.textBody`, which is the copy an agent reads and is never
pruned, so what expires at ninety days is the delivery record rather than the
correspondence. An `invitation` or `passwordReset` row is a working single-use
credential and nothing besides, so it lives exactly as long as the token in it —
the retention imports `RESET_TOKEN_TTL_SECONDS` from `auth.ts` instead of
restating it, which makes the two impossible to drift apart. The consequence
worth stating: an invitation that goes unread for a day disappears from the
screen that was delivering it. Nothing is lost, because the link had already
stopped working and the remedy was always to resend from the roster, but an
admin who expects the outbox to be an archive will find it is a queue.

Deletion rather than redaction, and that follows from the retry route above: it
sends whatever is in `textBody`, so a row with its body blanked is one click away
from emailing somebody a placeholder. `queued` is excluded from the sweep for the
same class of reason — a queued row has a job on its way to fetch it, and
removing it would drop an email the app has already promised.

**Duplicate sends are prevented by timing margin, not by a claim.** The handler
checks that a row is still `queued` and then calls the provider; there is no
`sending` state. A second worker could only pick the job up if the first stalled
past `expireInSeconds` (180s) on a call that times out far sooner. A claim state
was rejected because it would need a stuck-claim sweep of its own — the
machinery `Ticket.Processing` needs and earns. If a provider is ever bound whose
timeout approaches that margin, add the claim rather than raising the number.
