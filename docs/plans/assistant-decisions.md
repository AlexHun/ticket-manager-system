# Plan: One answer to what the assistant decided

**PRD:** [docs/prd/assistant-decisions.md](../prd/assistant-decisions.md) · **Status:** Draft · **Date:** 2026-10-16

## Layers crossed

```
web (apps/web/src/pages/PipelinePage.tsx — Recent arrivals; the dashboard's effectiveness card)
  → api  routes/pipeline.ts           GET /, requireAdminView   (toRun, pipelineCounts)
  │      routes/ticket-effectiveness.ts  GET /api/tickets/effectiveness
  │      routes/tickets.ts            PATCH /:id/category, PATCH /:id/assignee (unchanged; the E2E drives them)
    → @ticket/shared (PipelineCounts, AssistantEffectivenessResponse — field comments only)
      → apps/api/src  new: assistant-decisions.ts — the one statement of each fact
      │               jobs/classify-ticket.ts (handle writes the classifier's own record)
        → db (Prisma: Ticket) — new: a column only the classifier writes, backfilled
          → pg-boss: the classify queue (already there; slice 1 reaches its far side)
```

No `@ticket/core` schema changes: neither route takes a new input.

## Standards this plan reads against

- **`domain.md`: `/pipeline` is rebuilt from columns the jobs write, and a
  decision the job made is evidence on the row** (the `autoReplyOfferedAt`
  precedent, #360). Slice 1's column is the same kind of thing: the classifier's
  record of what _it_ filed, which no agent write touches. ADR-0007 holds; the row
  is the truth.
- **`domain.md`: "a query rather than a row predicate, because every reader can
  run one".** `classifierWillStillAct` set that shape. Each fact here is a
  Prisma `where` in `assistant-decisions.ts`. `pipelineCounts` and the
  effectiveness route count with it, and the routes ask it of the tickets they
  list and pass `toRun` the answer, the way `awaiting.classifier` is passed
  today. `toRun` stops reading `classifiedAt`/`category`/`autoResolvedAt` to
  decide these facts, so there is no second statement beside the query.
- **The effectiveness route's raw SQL goes.** Its only reason for SQL was the
  `LEFT JOIN "user"` behind `u.automated`. With slice 2 reading `autoResolvedAt`,
  every count is a `prisma.ticket.count` over a shared `where`.
- **`testing-api.md`**: time-sliced rows are seeded with a pinned past
  `createdAt`; `assistant-decisions.ts` has no imports a test would stub, so it
  adds no registry hazard. Nothing new is `mock.module`d.
- **ADR-0012**: the backfill reads activity rows, which live a year. The screens
  show at most 90 days, so every ticket they can show still has its row.

## How the E2E bar applies here

Same set-up as `tests/e2e/pipeline-offer.spec.ts`: tickets seeded through
`testDb` with pinned dates, `resetTickets()` in `beforeEach`, and the agent's
correction made through the **real** route (`PATCH /api/tickets/:id/category`,
`PATCH /api/tickets/:id/assignee`) signed in as an agent, never by writing the
column. The no-key API on `:3002` serves the rendered `/pipeline` and the
dashboard. The specs assert both the rendered Recent arrivals row and the two
JSON responses. One new spec, `tests/e2e/assistant-decisions.spec.ts`, grows a
test per slice.

## Slice 1 — The classifier's verdict is recorded

**Retires:** the migration on `Ticket` and the backfill from activity rows.
These are the two places this can go wrong in production rather than in a test.
**Covers:** R1, R2, R5 (classification half), R6 (classification half)

- `handle` in `jobs/classify-ticket.ts` records the category it filed in a new
  nullable column, in the same conditional `updateMany` that writes `category`
  and `classifiedAt`. The terminal path records nothing, which is how "gave up"
  stays distinguishable. No other module writes the column.
- The migration backfills it from each ticket's assistant-authored
  `category_changed` row (`toValue`). The classifier writes that row exactly
  once per ticket (`ticket-effectiveness-override.ts`'s header), so there is
  nothing to choose between.
- New `assistant-decisions.ts` exports `classifierFiled` and `classifierGaveUp`
  as `Prisma.TicketWhereInput`s over the new column and `classifiedAt`.
  `pipelineCounts`' `machineFiled` and `classifyAbandoned`, `toRun`'s two
  booleans and the effectiveness route's `classified` all read them.
- After this slice, an agent who clears a category the classifier filed sees
  `/pipeline` still showing that ticket past the classified stop, and the
  dashboard still counting it as classified.

**Hardcoded for now:** "resolved by the assistant" still read two ways (slice 2);
the window and decline tally still copied (slice 3); the effectiveness route's
`resolvedByAssistant` still raw SQL (slice 2).

**E2E:** `tests/e2e/assistant-decisions.spec.ts`. The setup seeds a ticket as the
classifier leaves it (column, `classifiedAt`, the activity row) and a second
ticket stamped by the terminal path. An agent clears the first one's category
through `PATCH`. Then `GET /api/pipeline` reads the first as not `abandoned` and
the second as `abandoned` at `classified`. The effectiveness response counts the
first in `classified` and in the override count. The rendered Recent arrivals
row for the first shows no abandoned exit.

## Slice 2 — Resolved by the assistant, read one way

**Retires:** the dashboard's published auto-resolve rate moving. It must move only
for the tickets R3 names. **Covers:** R3, R5 (resolution half), R6 (resolution half)
**Un-hardcodes:** the two readings of "resolved by the assistant".

- `assistant-decisions.ts` adds `assistantResolved` (`autoResolvedAt` set). A
  customer's reopen already clears that column in `ingest.ts`, which is exactly
  R3's withdrawal, and an agent's reassignment or status change does not. The
  effectiveness route counts with it; `pipelineCounts` and `toRun` read it as
  well.
- The effectiveness route's raw SQL is replaced by `prisma.ticket.count`s over
  the shared `where`s.
- The `AssistantEffectivenessResponse.autoReply.resolved` comment in
  `@ticket/shared` (which says the two "never disagree") and the effectiveness
  route's comment are rewritten. `domain.md` gains one sentence: the assistant
  being the assignee is the routing rule, and `autoResolvedAt` is what is
  counted.
- R6 needs no backfill here: `autoResolvedAt` has been written since
  `20260812120100_ticket_starts_new_and_auto_reply`, so every row the screens
  show carries it.

**E2E:** extends the spec. Seed an auto-resolved ticket and have an agent reassign
it through `PATCH /:id/assignee`. Both responses count it as resolved. Seed a
second one and post a customer reply through the inbound webhook (the reopen
path). Neither response counts it.

## Slice 3 — The two screens agree

**Retires:** drift between the two routes' remaining copies. **Covers:** R4, R7
**Un-hardcodes:** the copied window, `DAY_MS`, `ts()` and the zero-filled decline tally.

- `assistant-decisions.ts` takes a range and returns the window counts both
  routes publish: classified, gave up, resolved, declines by reason. Both
  routes call it. `routes/ticket-stats.ts`'s `DAY_MS` comes from the same place.
- `countCategoryOverrides` moves into it, and `ticket-effectiveness-override.ts`
  is deleted. Its header's reason (the `./db` registry) went with ADR-0014.
  Its tests move out of `ticket-effectiveness.test.ts`, and the comment in
  `ticket-effectiveness-edit-distance.ts:109` that names it is updated.
- `pipeline.test.ts` and `ticket-effectiveness-handler.test.ts` lose the
  per-site predicate tests that the new module's own tests now cover.

**E2E:** one agreement test in the spec. It seeds a mix covering every case in
R1–R3, plus an untouched filed ticket, an untouched abandoned one and one
declined. For the same range it asserts that `/api/pipeline`'s counts and
`/api/tickets/effectiveness`' classified, resolved and per-reason declines are
equal.

## Requirement coverage

| Req | Slice | Note                                              |
| --- | ----- | ------------------------------------------------- |
| R1  | 1     |                                                   |
| R2  | 1     | the terminal-path ticket in slice 1's E2E         |
| R3  | 2     |                                                   |
| R4  | 3     | the agreement test                                |
| R5  | 1, 2  | one fact per slice; slice 3 adds no new statement |
| R6  | 1, 2  | backfill in slice 1; none needed in slice 2       |
| R7  | 3     | Should                                            |

## Spikes

None. Both checks the plan relied on were made while writing it: the activity
row's `toValue` holds the filed category (`schema.prisma`, `TicketActivity`),
and `autoResolvedAt` predates every row the screens can show.

## Deferred

- **An agent filing a category while the classifier is still working** (PRD
  open question). The classifier's write is skipped, so the new column stays
  empty and `classifiedAt` stays null. That ticket reads as it does today. It
  needs a product answer, not a reporting fix.
- **Stage derivation** stays in `toRun` (PRD non-goal, ADR-0019).
- **A baseline count of disagreements on production.** It can be taken by hand
  before slice 1 merges; nothing in the plan builds it.
