# Plan: The pipeline says only what is coming

**PRD:** [docs/prd/pipeline-offer-truth.md](../prd/pipeline-offer-truth.md) · **Status:** Draft · **Date:** 2026-09-30

## Layers crossed

```
web (apps/web/src/pages/PipelineRail.tsx, PipelinePage.tsx — Recent arrivals)
  → api (apps/api/src/routes/pipeline.ts — GET /, requireAdminView)
    → @ticket/shared (PipelineCounts, PipelineConfig, PipelineRun)
      → apps/api/src/jobs/  classify-ticket.ts (handle, reconcile, classifierWillStillAct)
      │                     auto-reply-ticket.ts (enqueueAutoReply)
      │   new: one owner for "will the classifier still act" (shape: spike 1)
        → db (Prisma: Ticket) — new: a column recording the auto-reply offer
          → pg-boss: CLASSIFY_RECONCILE_SWEEP, the auto-reply queue
```

No `@ticket/core` schema is involved: `GET /api/pipeline` takes a range and
nothing else, and that does not change.

## Standards this plan reads against

- **`domain.md` says `/pipeline` is built from columns that already existed, "no
  migration… nothing written for the page's benefit".** Slice 1 adds a column.
  It is not written for the page. The job writes it as a record of a decision
  it made, the same kind of evidence `autoReplyDecline` is (ADR-0007: the row is
  the truth). The PRD's R4 requires it. Slice 1 amends that sentence in
  `domain.md` rather than leaving the two to disagree.
- **`testing-api.md`'s registry hazard.** Any new module in `jobs/` that a test
  stubs needs `bun test ./<a> ./<b>` in both orders, and a CI run, before it is
  believed. `jobs/sweeps.test.ts` already owns `./boss` and `../ai/provider`.
- **Time-sliced rows are seeded with an explicit past `createdAt`**, never
  `now()`. Every seeded ticket in the specs below is pinned.

## How the E2E bar applies here

Playwright runs two API servers on one database (`playwright.config.ts`).
`:3002` has no key and auto-reply off, and it is the one the web page talks to.
`:3003` has a key (the fake OpenAI on `:3999`) and auto-reply on. The bugs this
plan fixes are visible only on a deployment where something _could_ run, so
the specs that retire them call `:3003`'s `GET /api/pipeline` directly, the way
`knowledge-auto-reply-approval.spec.ts` calls its simulator. The rendered rail
is asserted on `:3002`. Tickets are seeded through `testDb` with pinned dates,
and `resetTickets()` runs in `beforeEach`.

As a bonus, this is the first coverage `GET /` gets through its real
`getBoss()`, which `pipeline.test.ts` cannot reach.

## Slice 1 — The auto-reply offer is recorded

**Retires:** the migration on `Ticket`, and whether legacy rows can read honestly without a queue lookup (spike 2).
**Covers:** R1, R4, R7

`enqueueAutoReply` records on the ticket that it was offered, in the same
transaction as the job it sends. When it declines to send, it records nothing.
`toRun` reads that record, not `config.autoReplyEnabled` and
`autoReplyArticleCount`: a classified ticket with no record reads `notOffered`.
Old rows have no record, and they read the same way, per spike 2's
recommendation.

- A ticket classified while auto-reply was off reads `notOffered` on a
  deployment where auto-reply is on today.

**Hardcoded for now:**

- The classifier's half still reads `classifierWillStillAct` and its two
  restatements. That is slice 2.
- The rail's counts do not use the new record yet. That is slice 4.
- The no-key branch stays in `PipelineRail.tsx`. That is slice 3.

Also in this slice: the `domain.md` sentence above, and a dated follow-up note
on ADR-0019's "questions about the deployment" line, as the PRD's constraint
asks.

**E2E:** `tests/e2e/pipeline-offer.spec.ts` against `:3003`. There are three
seeded tickets:

- classified, with no offer recorded → `notOffered`. This is the bug, and it is
  red before the slice.
- classified, with an offer recorded, still `New` → `pending`.
- a ticket run through `POST /api/pipeline/simulate` → its recorded offer is
  set and its outcome settles to `resolved` or `declined`.

## Slice 2 — One owner for the classifier's offer

**Retires:** whether one statement can serve both a per-row predicate and a window-wide count (spike 1).
**Covers:** R2, R3, R6
**Un-hardcodes:** `classifierWillStillAct`, `reconcile`'s `where` and `pipelineCounts`' `classifyPending` query as three copies.

Whatever spike 1 settles, the reconcile sweep, `toRun` and `pipelineCounts`
read one statement of "no category filed, inside the reconcile window". Both
"change one and change the other" comments are deleted. What they warned about
can no longer happen.

- The rail's counts and the per-ticket outcomes in Recent arrivals agree for
  every ticket, and a developer changing the window edits one place.

**E2E:** `pipeline-offer.spec.ts` gains a seeded mix on `:3003`:

- one ticket per outcome;
- an unclassified ticket inside the window and one past it;
- a hand-filed category;
- a reopened ticket.

It asserts that `counts` and `recent` from one `GET /api/pipeline` agree, which
is R6. `pipeline.test.ts`'s cross-check at `:381–389` is kept only if spike 1
leaves two shapes. If one shape survives, the check is true by construction and
is deleted.

## Slice 3 — The browser stops deciding the no-key exit

**Retires:** the wording regressing when the label decision moves server-side.
**Covers:** R5
**Un-hardcodes:** the `config.aiConfigured` ternary at `PipelineRail.tsx:350`.

With no key, `pipelineCounts` puts no ticket in `classifyPending`. They are
counted as not offered, with the cause named by the API. The rail renders the
exits it is given and branches on no setting to choose one. The
"Never offered — no API key on this deployment" wording survives, sourced from
the server.

- An admin on a deployment with no key sees the same words as today. The
  number beside them comes from a count that already means "never".

**E2E:** `pipeline-offer.spec.ts` on `:3002`, which has no key, through the
rendered page. A seeded ticket that is recent and unclassified shows under the
never-offered exit, and no "Queued" exit is rendered.

## Slice 4 — The auto-reply half says what is coming

**Retires:** an additive change to `PipelineCounts` shipping ahead of or behind the rail.
**Covers:** R8 (Should)
**Un-hardcodes:** slice 1's "counts do not read the record".

`pipelineCounts` splits the classified-but-no-verdict tickets into
still-coming (offered and not settled) and never-offered, reading slice 1's
record. The rail draws them as exits the way its classify half does. The
unlabelled `noVerdict` remainder (`PipelineRail.tsx:335`) shrinks to tickets
answered by hand or reopened, and its comment is updated to match.

**E2E:** extends the spec. On `:3002`, a seeded classified ticket with no offer
shows under the auto-reply never-offered exit. On `:3003`, the API reports an
offered, unsettled one as still coming.

## Requirement coverage

| Req | Slice | Note                                                                   |
| --- | ----- | ---------------------------------------------------------------------- |
| R1  | 1     | Red before the slice; the first assertion written                      |
| R2  | 1, 2  | Auto-reply half in 1, classifier half in 2                             |
| R3  | 2     |                                                                        |
| R4  | 1     |                                                                        |
| R5  | 3     |                                                                        |
| R6  | 2     | Through the real `GET /`, which no test reaches today                  |
| R7  | 1     | Settled by spike 2                                                     |
| R8  | 4     | `Should`; cut if slice 3 runs long, since nothing in 1–3 depends on it |

Every `Must` has a slice. No slice exists without a requirement.

## Spikes

- **One statement, two shapes?** The classifier rule is asked of one row
  (`toRun`) and of a window (`reconcile`, `pipelineCounts`). The candidates:
  - a Prisma `where` fragment built by one function, used by both queries, with
    `toRun` asking it through a row predicate derived from the same constants;
  - the predicate alone, with both queries pinned to it by a shared test table;
  - a SQL view.

  Choose by the deletion test: the winner is the one whose removal puts the rule
  back in three places. Timebox 2h, blocks slice 2.

- **What does a legacy row with no record mean?** The recommendation is
  `notOffered`, with no queue read. The only tickets that mislabel are those in
  flight at deploy time, which settle to `resolved` or `declined` within
  seconds. It keeps `toRun` a function of the row, per ADR-0007. The
  alternative, a migration backfill from evidence (`autoReplyDecline`,
  `autoResolvedAt`, an automated message), should be considered only if a
  settled legacy ticket would otherwise read differently from today. Timebox 1h,
  blocks slice 1.
- **Offered, and _why not_?** The PRD's open question. Recording only
  "offered" is enough for R1–R8. A reason (switch off, no key, empty corpus)
  would let slice 4 label its never-offered exit precisely. Decide before slice
  1's migration, since a second migration costs more than a wider first one.
  Timebox 30m, needs Aleksei.

## Deferred

- **Re-offering tickets passed over while auto-reply was off.** PRD non-goal.
- **An `Outcome` module.** Rejected by ADR-0019. Slice 2 gives one _input_ an
  owner.
- **A job that was offered and then lost** (for example, a queue purged by
  hand). It would read `pending` forever, because `recoverStuck` re-offers only
  `Processing` tickets. That is a separate hole from R1's, and a sweep's job,
  not a report's. File it if slice 1's spec shows it is reachable.
- **The reconcile window's values.** PRD non-goal.
