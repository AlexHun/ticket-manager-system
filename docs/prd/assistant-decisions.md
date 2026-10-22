# PRD: One answer to what the assistant decided

**Status:** Shipped · **Author:** Aleksei Hunich · **Date:** 2026-10-16

## Problem

`/pipeline` and the dashboard's assistant-effectiveness figures both report
what the assistant decided about a ticket: whether the classifier filed it, and
whether the auto-reply resolved it. Each reads that from ticket columns an
agent can change, and the two read it differently.

**Classification.** "The classifier gave up" is read as `classifiedAt` set with
`category` null (`routes/pipeline.ts` `toRun` and `pipelineCounts`). An agent
who clears a category the classifier filed produces exactly that pair, since
clearing never touches `classifiedAt`. The ticket then reads as `abandoned` at
the classify stop on `/pipeline`, which ADR-0019 says is an outage, and it drops
out of the dashboard's classified count. That shrinks the denominator every
dashboard rate is taken over. A person correcting the machine is reported as
the machine failing.

**Resolution.** `/pipeline` counts a ticket as resolved by the assistant from
`autoResolvedAt`. The dashboard counts it from the assignee being the
assistant's account (`routes/ticket-effectiveness.ts`). The shared type says
the two "never disagree". They do disagree as soon as an agent reassigns a
ticket the assistant resolved: `/pipeline` still counts it and the dashboard
does not.

"The classifier filed it" is written four times: as a row check in `toRun`, as
a Prisma `where` in `pipelineCounts`, as raw SQL in the effectiveness route,
and as a walk over activity rows (`ticket-effectiveness-override.ts`). The window, the
zero-filled decline tally and the timestamp cast are copied between the two
routes as well.

## Users

`admin`, and the demo visitor who sees `/pipeline` and the dashboard read-only
(ADR-0022). The job: judge whether the unattended path is earning its keep from
two screens, and trust that they describe the same tickets the same way. An
`abandoned` the classifier never reached sends an admin looking for an outage
that is not there.

The developer is the second user: changing what counts as "the classifier filed
it" or "the assistant resolved it" should be one edit, not four.

## Success metrics

| Metric                                                                                             | Today   | Target    |
| -------------------------------------------------------------------------------------------------- | ------- | --------- |
| Tickets where `/pipeline` and the dashboard disagree for the same window on classified or resolved | unknown | 0         |
| Places that state "the classifier filed this ticket"                                               | 4       | 1         |
| Places that state "the assistant resolved this ticket"                                             | 3       | 1         |
| _Guardrail:_ outcome and counts for a ticket no person has touched since the pipeline              | —       | unchanged |

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                                    | Priority |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | A ticket the classifier filed and an agent then un-categorised reads as classified on `/pipeline`, never `abandoned`, and counts in the dashboard's classified figure and its override count.  | Must     |
| R2  | A ticket the classifier gave up on (a terminal failure, nothing filed) still reads `abandoned` at the classify stop and still counts in `classifyAbandoned`.                                   | Must     |
| R3  | A ticket the assistant resolved still counts as resolved by the assistant on both screens after an agent reassigns it or changes its status by hand; only a customer's reopen withdraws it.    | Must     |
| R4  | For the same window, `/pipeline`'s counts and the dashboard's classified, resolved and decline-by-reason figures agree for a seeded mix that covers every case in R1–R3, asserted by one test. | Must     |
| R5  | "The classifier filed it", "the classifier gave up" and "the assistant resolved it" are each stated once, and both routes read that statement.                                                 | Must     |
| R6  | Tickets that existed before the change read correctly under R1 and R3 from the day it ships, wherever the activity trail shows who filed the category.                                         | Must     |
| R7  | The dashboard's time window, its decline tally by reason and `/pipeline`'s are computed by one piece of code.                                                                                  | Should   |

### Non-goals

- **Stage derivation.** `toRun` keeps deciding which stop a ticket exited at.
  ADR-0019 rejected an owner for the Stage, and nothing here reopens that. This
  PRD gives the _facts_ `toRun` reads a single owner.
- **What an agent may do.** Clearing a category stays allowed
  (`PATCH /:id/category`), and so does reassigning a resolved ticket.
- **The other candidates from the 2026-10-16 architecture review** (repo
  tooling, auto-reply shaping, a fake model for tests, splitting
  `@ticket/shared`). Each gets its own PRD.
- **New figures on either screen.** The same numbers, made to agree.
- **The Polish edit-distance figure** on the dashboard. It does not read the
  assistant's decisions.

## Constraints

- **ADR-0007: the ticket row is the source of truth.** Whatever R5 reads is
  evidence on the database, not the queue.
- **ADR-0019 stands.** `abandoned` is the absence of a verdict, and an outage is
  never a decline. R1 is a ticket that _had_ a verdict.
- **ADR-0012: activity is pruned after a year.** R6 may rely on the activity
  trail only inside the windows the screens show (at most 90 days).
- **ADR-0014: API tests run on real Postgres in process.** R4's test seeds rows;
  it does not mock the reads.
- **`docs/standards/domain.md`** states "Resolved by the machine ⇒ assigned to
  the assistant's own account" as the routing rule. R3 keeps the routing and
  changes only which fact the dashboard _counts_. The standard's sentence and the
  `@ticket/shared` field comment are corrected in the same change.

## Risks

| Risk                                                                                       | Impact                                                      | Mitigation                                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| R5 needs both a row predicate (`toRun`) and a database count (both routes), and they drift | Two copies again, under one name                            | Decide the shape in the plan; R4's test is the tripwire                 |
| R3 raises the dashboard's resolved count for tickets agents reassigned                     | The published auto-resolve rate goes up on the day it ships | Name it in the PR and the changelog as a correction, not an improvement |
| R6 relies on activity rows the classifier wrote                                            | A ticket whose rows are missing is read wrongly             | Fall back to today's reading for it; the guardrail metric covers it     |
| Adding a column to `Ticket` for R1, if the plan chooses one                                | A migration on the hottest table                            | Additive and nullable; R6 decides what `null` means                     |

## Open questions

- [ ] Is R5's single statement derived from the activity trail, or recorded on
      the ticket by the classifier and the auto-reply as they decide? — _affects
      R5, R6_, decide in the plan
- [ ] An agent files a category while the classifier is still thinking, so the
      classifier's write is skipped. Does that ticket read as classified by the
      machine, by a person, or neither? — _affects R1_, needs Aleksei
- [ ] **Assumed:** a ticket an agent _re-files_ under a different category reads
      as classified by the machine and counts as an override, as today.
- [ ] **Assumed:** the target of zero disagreements has no baseline. A count on
      the production database before shipping would give one.
- [ ] **Assumed:** the demo visitor sees the same figures as an admin.
