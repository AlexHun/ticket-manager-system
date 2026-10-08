# PRD: The pipeline says only what is coming

**Status:** Shipped · **Author:** Aleksei Hunich · **Date:** 2026-09-30

## Problem

`CONTEXT.md` defines _pending_ as "a verdict is still coming" and _not offered_
as "none ever will be". `/pipeline` exists to tell those two apart, and twice in
a row it has not: #353 and #355 were both a ticket drawn as `pending` that no
job would ever touch. Both were fixed by bringing one copy of a rule back in
line with another.

That rule — _will the classifier still act on this ticket?_ — is written down
**four times**: `classifierWillStillAct` (`jobs/classify-ticket.ts:104`), the
reconcile sweep's query (`:326`), `pipelineCounts`' query
(`routes/pipeline.ts:439`), and the no-key branch in the browser
(`PipelineRail.tsx:350`), which decides which exit a count belongs in. Two
comments say "change one and change the other". A fifth change will find a
fourth copy.

The auto-reply half has the opposite defect: it has no record at all.
`enqueueAutoReply` returns silently when auto-reply is off
(`jobs/auto-reply-ticket.ts:138`), and nothing notes that the ticket was passed
over. `toRun` then guesses from **today's** settings. A ticket classified while
auto-reply was off, viewed after it is switched back on, reads `pending` — and
stays `pending` forever, because nothing will ever enqueue it.

## Users

`admin`, and the demo visitor who sees `/pipeline` read-only (ADR-0022). The
job: open `/pipeline` and learn, from what it says is still coming, whether the
unattended path is healthy or stuck. A `pending` that never resolves is the
exact signal of a stuck queue, so a false one sends an admin looking for an
outage that is not there.

The developer is the second user: changing when the classifier gives up on a
ticket should be one edit, not a search for its copies.

## Success metrics

| Metric                                                                   | Today   | Target    |
| ------------------------------------------------------------------------ | ------- | --------- |
| Tickets reading `pending` that no queued job or sweep will act on        | unknown | 0         |
| Places that state whether the classifier will still act on a ticket      | 4       | 1         |
| Places that decide whether the auto-reply was offered a ticket           | 2       | 1         |
| _Guardrail:_ outcome and counts for a ticket whose evidence is unchanged | —       | unchanged |

The guardrail covers every ticket the two bugs do not: a resolved, declined or
abandoned ticket, and a classify-pending one inside the reconcile window, reads
exactly as it does today.

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                           | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | A ticket classified while auto-reply is off reads `notOffered` on `/pipeline`, and still reads `notOffered` after auto-reply is switched back on.                                     | Must     |
| R2  | A ticket reads `pending` on `/pipeline` only while a queued job or a scheduled sweep will still act on it.                                                                            | Must     |
| R3  | Whether the classifier will still act on a ticket is stated once, and the reconcile sweep, a ticket's outcome and the rail's counts all read that one statement.                      | Must     |
| R4  | Whether the auto-reply was offered a ticket is recorded on the ticket at the moment it is decided, and `/pipeline` reads the record rather than the current settings.                 | Must     |
| R5  | With no API key configured, the rail's counts place no ticket in the "still coming" exit, and the web page applies no rule of its own to choose a ticket's exit.                      | Must     |
| R6  | For a seeded mix of tickets covering every outcome, the rail's counts and the per-ticket outcomes in Recent arrivals agree, asserted by one test.                                     | Must     |
| R7  | Tickets that existed before the change never read `pending` unless a job will still act on them.                                                                                      | Must     |
| R8  | The rail's auto-reply half separates "still coming" from "never offered" the way its classify half does, so its unlabelled remainder shrinks to tickets answered by hand or reopened. | Should   |

### Non-goals

- **An `Outcome` module.** ADR-0019 rejected one on the deletion test: `toRun`
  and `verdictOf` share no parameter. Nothing here merges them. R3 gives one
  _input_ to `toRun` a single owner.
- **Re-offering the tickets R1 is about.** A ticket passed over while auto-reply
  was off stays passed over. Offering it later is a product decision about
  customers who already waited, not a reporting fix.
- **Changing the reconcile window**, its 10-minute floor or its 24-hour ceiling.
  R3 moves where the rule lives, not what it says.
- **Separating `unavailable` out of `AutoReplyDecline`** — deferred by ADR-0019
  and still deferred.
- **The effectiveness screen** (`routes/ticket-effectiveness.ts`). It reports
  verdicts, not what is coming.
- **The Usage page column** from the same architecture review — dropped as
  speculative.

## Constraints

- **ADR-0007: the ticket row is the source of truth; a job is only a nudge.**
  R4 follows it. The decision becomes evidence on the row, not something
  re-derived from the queue or the settings.
- **ADR-0019 is refined, not contradicted.** It calls `pending` and
  `notOffered` "questions about the deployment rather than about the ticket".
  For the auto-reply half, R1 is the case where asking the deployment _today_
  gives the wrong answer about a decision made _then_. The ADR's decision
  stands: no `Outcome` module. Its sentence gets a follow-up note once this
  ships.
- **API tests run against PGLite (ADR-0014), and `mock.module`'s registry is one
  per process (ADR-0016, #174).** A new owner for R3 that tests stub must not
  collide with a specifier another test file already stubs.
- **`GET /api/pipeline` is untested today** because it reads queue depth through
  `getBoss()`. R6 must be met without depending on that route.

## Risks

| Risk                                                                           | Impact                                                                        | Mitigation                                                                            |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| R4 needs a new column on `Ticket`, the hottest table                           | A migration on every environment, and any seed that writes classified tickets | One additive, nullable change; R7 decides what `null` means, so no backfill is needed |
| R3's single statement cannot be both a TypeScript predicate and a Prisma query | Two copies survive under one name, and drift again                            | Decide in the plan; whichever shape wins, R6's test is the tripwire                   |
| R5 moves a label decision server-side and the no-key wording regresses         | An admin with no key sees "queued" for work that will never run               | R5's test runs with the key unset                                                     |
| R8 adds counts to `PipelineCounts`, a shared type the web reads                | Rail and API ship out of step for one deploy                                  | Additive fields only; the rail tolerates their absence for one release                |

## Open questions

- [ ] Is R3's single statement a function the sweep and the counts both use,
      or a query both run? — _affects R3_, decide in the plan
- [ ] Does R4 record only "offered / not offered", or also _why_ not (switch
      off, no key, empty corpus)? — _affects R4, R8_, needs Aleksei
- [ ] **Assumed:** R7 reads a ticket with no recorded decision as `notOffered`
      unless an auto-reply job for it is queued or active. Confirm that a
      one-time read of the queue is acceptable here, given ADR-0007.
- [ ] **Assumed:** the demo visitor sees the same outcomes as an admin, with no
      demo-specific wording.
- [ ] **Assumed:** the target for "tickets falsely `pending`" is zero with no
      baseline. There is no measurement today; a count on the production
      database before shipping would give one.
