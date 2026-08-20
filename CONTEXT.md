# Support Desk

A support desk that receives customer email, files it, answers what it can from
written knowledge, and hands the rest to people. This glossary fixes the words
for that domain — what each thing IS, not how it works.

## Language

### People

**Customer**:
The person who emailed the support address. Never signs in and has no account.
_Avoid_: user, client, reporter, requester

**Agent**:
A signed-in person who works tickets.
_Avoid_: operator, support rep, user

**Admin**:
An agent who additionally manages accounts, knowledge articles and automation.
_Avoid_: superuser, owner, manager

**Assistant**:
The non-human identity that machine-written work is filed under. It is an
account nobody can sign in as, not a kind of agent.
_Avoid_: bot, AI user, system user, robot

### The desk

**Ticket**:
One customer's request, tracked from the email that opened it until it is
closed.
_Avoid_: case, issue, request, conversation

**Thread**:
The ordered set of messages on one ticket, as a customer would read it.
_Avoid_: conversation, history, chain

**Message**:
A single email on a thread. Inbound if the customer wrote it, outbound if the
desk did.
_Avoid_: reply, email, note, comment

**Assignee**:
The agent or the assistant a ticket is filed under. A ticket with none belongs
to nobody.
_Avoid_: owner, holder

**Activity**:
One entry in a ticket's audit trail, recording a single transition and who made
it.
_Avoid_: log, history, event, audit entry

### Lifecycle

**Status**:
Where a ticket stands: New, Processing, Open, Resolved or Closed.
_Avoid_: state, stage (stage belongs to the pipeline)

**Backlog**:
New and Open together — every ticket nobody has dealt with. The New ones have
not been triaged; the Open ones have.
_Avoid_: open tickets, queue, inbox

**Claim**:
Taking exclusive hold of a ticket while a reply is being composed, so nothing
else answers it at the same time.
_Avoid_: lock, reserve

**Handoff**:
Passing a ticket the assistant could not finish to a person.
_Avoid_: escalation, fallback, handover

**Reopen**:
A customer replying to a ticket that had been resolved, putting it back in
front of a person.
_Avoid_: reactivate, unresolve

### The unattended path

**Ingestion**:
Turning an arriving email into either a new ticket or a message on an existing
thread.
_Avoid_: intake, import, capture

**Classification**:
Filing a newly arrived ticket under one category.
_Avoid_: tagging, labelling, triage (triage is a person's judgement)

**Category**:
The subject a ticket is filed under — the four the desk recognises.
_Avoid_: type, topic, label

**Auto-reply**:
An answer written from knowledge articles and sent to the customer with nobody
reading it first.
_Avoid_: auto-response, canned reply, automated response

**Decline**:
The auto-reply's decision not to answer a ticket, and the recorded reason. A
declined ticket is a normal outcome, not a failure.
_Avoid_: rejection, error, failure, bail

**Pipeline**:
The whole unattended path a ticket travels, from received to resolved, with
every exit off it.
_Avoid_: workflow, flow, automation chain

**Stage**:
One of the six stops on the pipeline a ticket can be at.
_Avoid_: step, phase, status

**Simulated ticket**:
A ticket an admin injected through the real ingestion path in order to watch it
travel the pipeline. Real in every respect except that its sender cannot
receive mail.
_Avoid_: test ticket, fake ticket, dummy ticket

### Knowledge

**Knowledge article**:
A written answer the desk keeps, which agents read and the auto-reply may draw
on.
_Avoid_: doc, KB entry, FAQ, help article

**Revision**:
A complete snapshot of an article as it stood at one edit, with who made it.
_Avoid_: version, diff, change

**Internal note**:
The part of an article that only people may read, and which never reaches a
customer or a model.
_Avoid_: private note, comment, remark

**Citation**:
The articles a particular auto-reply was built from, recorded on the reply
itself.
_Avoid_: source, reference, link

### Assisted work

**Polish**:
Rewriting an agent's own draft reply before that agent sends it.
_Avoid_: enhance, improve, rewrite

**Summary**:
A generated account of a thread, drawn for one agent beside the thread it
describes and never kept.
_Avoid_: digest, overview, recap

### Sending

**Outbox**:
The record of every email the desk means to send, and of what became of each
one. An email is in the outbox before it is anywhere else.
_Avoid_: queue, spool, mail log, email table

**Delivery**:
What became of one outbound email — still to go, taken by a provider, refused,
or never attempted because there is nobody to attempt it with.
_Avoid_: status, send state, result

**Undeliverable**:
Not attempted, because this deployment has no mail provider. A supported state
and the ordinary one today; distinct from an email that was tried and refused.
_Avoid_: failed, unsent, error, pending

**Mail provider**:
The outside service that accepts an email and carries it. The desk speaks to
exactly one, through one module, and works without any.
_Avoid_: transport, mailer, SMTP, Postmark (in prose about the domain)

### Getting in

**Invitation**:
The link that lets a new colleague choose their first password. An account
exists before it is accepted and cannot be signed into until it is.
_Avoid_: welcome email, activation, signup link, onboarding

**Reset**:
The link that lets a colleague who has lost their password choose another. The
same mechanism as an invitation, told apart by whether they ever had one.
_Avoid_: recovery, forgot-password, change password
