# A second unread email is not an opening

A ticket carrying two inbound messages and nothing outbound is **declined**, for
the reason `followUp`, before any model is asked. It used to pass, and the job
then answered the older of the two emails and resolved the ticket on top of the
newer one. That was a bug, not a narrow feature.

Answered from [#221](https://github.com/AlexHun/ticket-manager-system/issues/221),
which was filed by the comparison in [ADR-0017](0017-assembling-a-prompts-input-is-not-a-module.md)
and asked the design question first: is answering the first email of two what we
want at all? It is not.

## The state, and why it is reachable

The auto-reply is enqueued by the classifier, not by ingestion. The inbound-email
webhook answers in 8-185ms and a category lands 4-17s later
([ai-features.md](../standards/ai-features.md)), and a customer who writes twice
inside that window threads onto the same ticket rather than opening a second one.
What the auto-reply job then found was a ticket with nothing outbound and
`inboundCount` 2 — which `gateDecline` passed, because it asked only whether the
count was zero — after which `jobs/auto-reply-ticket.ts` sent the model
`inbound[0]`, the first email, and an accepted reply marked the ticket
`Resolved`.

Nobody had to do anything unusual to reach it. Writing again because you thought
of something else is the most ordinary thing a person does after sending a
support email.

## Why answering the older email is wrong

Three reasons, and the middle one is the one that decided it.

**The reply closes the ticket over the unread message.** The second email may
withdraw the first, correct it, or add the detail that changes the answer. The
reply does none of that, and then resolves the thread, so the correction is not
sitting in a queue for an agent — it is under a `Resolved` row. The failure is
silent and it is the customer who pays for it.

**The category gate is reading a classification of the first email alone.**
Classification runs once, on arrival, and never re-runs when a message is
appended. So a thread whose second message turns it into a refund request is
still filed `Technical`, and `ANSWERABLE_CATEGORIES` — the control that exists so
a machine never writes to somebody about their money unattended — waves it
through. That is not a mis-filed ticket; it is one of the two independent refund
controls being bypassed by timing, and the other one (every refund article marked
`Auto-reply: no`) does not help, because the article being cited is about
password resets.

**It was the one place this feature failed open.** Every other ambiguity in the
auto-reply resolves toward a human: an unclassified ticket, a thread with a reply
on it, a citation that does not resolve, a money word no article backs. Declining
costs one rare ticket left `Open` for an agent, which is the designed, common
outcome of the whole feature.

## What was rejected

**Widening the prompt to carry both emails.** It is the tempting answer — the
model reads the whole thread and replies to all of it — and it is a different
feature. The corpus is written to answer openings; the prompt says "A new ticket
has arrived"; the six output checks, the measured decline rates and every case in
`AUTO_REPLY_CASES` are baselined against a single-message prompt. Answering
threads means re-arguing all of that, and it should be argued on its own merits
rather than arrived at as the fix for a gate. Nothing here forecloses it.

**Reusing `answered`.** The two gates state the same principle — this is not an
opening — but they are not the same fact, and the reason an agent needs is the
one the label tells them. `answered` means a colleague is already in the thread;
`followUp` means nobody is, and the customer is waiting on a thread the machine
declined to summarise for itself. Collapsing them would have made the second
invisible on `/pipeline` and on the ticket card.

## Consequences

**`AUTO_REPLY_DECLINE` gains a tenth reason and four gates now run before the
model.** `followUp` sits at `PIPELINE_STAGE.eligible` with the other structural
gates. The exhaustive `Record`s — `DECLINE_STAGE`, `DECLINE_LABEL`,
`DECLINE_SHORT`, `DECLINE_COVERAGE` — each made the addition a compile error
until it was answered, which is what they are for.

**`preflight.hasInbound` became `preflight.inboundCount`.** A boolean could name
two of the three states the pipeline reaches, and the one it could not name is
the one that hid this bug: `evals/runner.ts` wrote `hasInbound ? 1 : 0`, so no
case could declare a thread and nothing measured whether answering the older
email was still what we wanted. The harness gains `wrote-again`, which declares
two inbound messages and expects `followUp`, and whose email is **squarely
covered by KB-001 on purpose** — the corpus would answer it, so the gate is the
only thing between that case and a resolved ticket, and a `resolved` verdict on
it means the gate is gone rather than an article edited.

**`/pipeline` does not offer the new case, and that is not the same refusal as
the other two.** `already-answered` and `no-inbound-message` are states ingestion
cannot produce at all. This one it can produce, but only by winning a race
against the classifier — so a picker entry for it would reproduce the case
sometimes and report the gate as broken the rest of the time. It joins the
harness-only set for a reason of its own, stated at `SIMULATABLE_CASES`.

**`AutoReplyContext.text` stopped saying "the first inbound message".** That
wording was an accurate description of the bug.

## The gate runs twice, and the second time is the one that matters

A gate that reads the thread before the model call narrows the window; it does
not close it. Appending a message does not move a ticket's status — `ingest.ts`
reopens only what carries `autoResolvedAt`, which a ticket still being answered
does not — so a customer who writes again _during_ the model call leaves
`Processing` intact, and the resolve's `where` would have matched and closed the
thread over the new email exactly as before, with the window narrowed from the
classifier's 4-17s to the length of one model call.

So `gateDecline` is called a second time, inside the resolving transaction, on
what is true then. The whole predicate rather than a re-count: a model call is
long enough for an agent to reply in, and long enough for one to file the ticket
as `Refund`, and whichever gate now fires is the reason the ticket is handed back
with. The drafted reply is discarded, which is the same trade every check in this
feature makes — it answers a thread that has moved.

What remains is one statement wide: a message committing between that read and
the update. Closing that needs row locking, and it is not worth it here — the
outcome is one ticket resolved over a message that arrived in the same instant,
and the customer's reply to an auto-resolved ticket reopens it.
