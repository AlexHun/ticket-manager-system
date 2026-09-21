# Plan: The evals vocabulary and its projection live in the wrong modules

**PRD:** [docs/prd/run-projection-and-shared-vocabulary.md](../prd/run-projection-and-shared-vocabulary.md) · **Status:** Draft · **Date:** 2026-09-21

## Layers crossed

```
web (apps/web/src/pages/EvalsPage.tsx — read-only here, never edited)
  → api (apps/api/src/routes/evals.ts — GET /runs, requireAdmin)
    → @ticket/core (packages/core/src/schemas/evals.ts — evalRunsQuerySchema)
      → apps/api/src/evals/   stored-verdict.ts · runner.ts · start-run.ts
      │   new: run-projection.ts
      → db (Prisma: EvalRun, EvalCaseResult)
  and, crossing all of it:
    packages/shared/src/index.ts — the vocabulary both ends speak
```

`EvalsPage.tsx` is in the diagram because it is what breaks if the projection
lies, and out of scope because it is a PRD non-goal.

## The done bar, and how this plan reads it

Same inversion as [usage-page-module-seams.md](usage-page-module-seams.md):
these slices add no path to drive, so **slice 1 builds the spec and every later
slice is done when it passes unchanged.** R4 and R7 say the output is
byte-identical; a guardrail that had to be edited is a slice that changed a
published measurement.

`tests/e2e/evals.spec.ts` already seeds `EvalRun` rows through `testDb`, so the
PRD's open question about whether a seeded run exists is answered: it does, and
slice 1 borrows the technique.

## Slice 1 — The runs endpoint gets a snapshot

**Retires:** the plan's premise — that a rate moved by a refactor is detectable. Today `evals.test.ts` asserts the four projections in isolation and nothing asserts the assembled body.
**Covers:** R4

Seed one `EvalRun` with stored verdicts that reach **every branch the projection
has** — each outcome, a decline of each kind, an output-check decline, an
unclassified repeat, a case with no previous run and one with — then snapshot
the whole `GET /api/evals/runs` body.

- A developer can run one spec and find out whether any rate, row or counter now
  differs from what it was before their branch.

**Hardcoded for now:**

- One run, one corpus. Multi-run comparison (`previousRuns`, `anchorRun`) gets a
  second seeded run in the same slice — it is the half most likely to shift.
- `startedAt` / `finishedAt` / ids are masked; they are not measurements.
- Nothing moves. This slice changes no production file.

**E2E:** `tests/e2e/evals-projection-guardrail.spec.ts` — the response body
matches a committed snapshot.

## Slice 2 — The projection moves out of the route

**Retires:** whether 430 lines can leave a route module without the four exports' tests changing meaning.
**Covers:** R1, R8
**Un-hardcodes:** nothing — this is the move slice 1 was built to police.

`apps/api/src/routes/evals.ts:99–528` becomes `new:
apps/api/src/evals/run-projection.ts`, beside `stored-verdict.ts` which parses
the column it reads. **Two commits, and the order is the mitigation:** the code
moves first, then the tests move unchanged from `routes/evals.test.ts:1088–1360`
into `run-projection.test.ts`. A test that was rewritten rather than moved is
the failure this ordering exists to make visible in the diff.

- The module that turns verdicts into rows is a module you can find by name.

**Hardcoded for now:**

- The four functions are still exported one by one, and the route still calls
  them one by one. Narrowing that is slice 3.

**E2E:** slice 1's guardrail unchanged. `evals.spec.ts` and `evals.test.ts`
unchanged. **Confirm on CI, not only on Windows** — a new module under
`apps/api/src/evals/` is exactly where `mock.module`'s one-process registry
collides, and file order differs between the two.

## Slice 3 — The route's interface becomes one name

**Retires:** whether the projection has a single useful entry point, or whether the route genuinely needs the pieces.
**Covers:** R2, R3
**Un-hardcodes:** four exports that exist only so a test can reach them.

`routes/evals.ts` exports `createEvalsRouter` and nothing else. The projection
presents whatever the spike below settles on — one function that builds a run's
rows, or two. Its test asserts through that interface rather than through four
private tallies.

- Request parsing, authorisation and status codes are in the route; nothing that
  derives what the response carries is.

**E2E:** slice 1's guardrail unchanged. The projection's own suite still covers
every branch slice 1's fixture reaches — if it cannot, the interface is wrong,
not the test.

## Slice 4 — `@ticket/shared` becomes a barrel

**Retires:** whether thirteen domain modules can be cut from the file's existing ordering without a circular import.
**Covers:** R5, R6, R7
**Un-hardcodes:** 3,236 lines in one file.

`packages/shared/src/index.ts` splits at the seams its own ordering already
shows, and becomes `export *` over them — the shape `@ticket/core` has had all
along. Nothing outside the package changes an import, because the package
exposes exactly one entry point and no deep import of it exists.

- Reading what an eval Run row carries costs the evals vocabulary, not thirteen.

**Runs last, on a clean tree, as its own commit with nothing else in it.** 61
commits touch this file; a branch rewriting it conflicts with anything else
open. This is the PRD's sequencing constraint and it is not negotiable by
convenience.

**E2E:** slice 1's guardrail unchanged, plus the whole suite — this slice's real
assertion is that `bun run typecheck` and both unit suites are green with zero
call-site edits. A single changed import outside `packages/shared` fails R6.

## Requirement coverage

| Req | Slice | Note                                                                             |
| --- | ----- | -------------------------------------------------------------------------------- |
| R1  | 2     |                                                                                  |
| R2  | 3     |                                                                                  |
| R3  | 3     |                                                                                  |
| R4  | 1     | Built in slice 1, re-run unchanged by 2, 3 and 4                                 |
| R5  | 4     |                                                                                  |
| R6  | 4     | Verified by the diff: zero changed imports outside `packages/shared`             |
| R7  | 4     |                                                                                  |
| R8  | 2     | `Should` — satisfied by the destination directory, so it costs nothing to honour |

Every `Must` has a slice. No slice exists without a requirement.

## Spikes

- **Is the projection one module or two?** The per-repeat tallies (`reachedFrom`,
  `filedFrom`, `categoriesFrom`, `checksFrom`) and the run-level metrics
  (`metricRow`, `previousMetric`, `previousRuns`, `anchorRun`) are different
  questions over the same rows, and the second pair reaches the database.
  Timebox 2h, blocks slice 3.
- **Where does `EvalsConfig` belong?** It is the route's injected configuration
  today. If it survives slice 3 as a route export, R2 is only half true.
  Timebox 1h, blocks slice 3.

## Deferred

- **`apps/web/src/pages/EvalsPage.tsx`** — 1,062 lines, four pure helpers
  (`verdict`, `percent`, `deltaLabel`, `categoryLabel`) reachable only through
  its 1,529-line test. The mirror image of slice 3 on the client. PRD non-goal;
  wants its own PRD, and it should get one.
- **`evals/runner.ts`'s interface** — fixed by
  [ADR-0018](../adr/0018-a-measuring-module-reads-the-taxonomy-not-the-retry-table.md).
  Not reopened.
- **Moving names between `@ticket/shared` and `@ticket/core`** — PRD non-goal.
  Slice 4 keeps the package's interface identical.
- **`changelog-entries.json`** — generated by CI on every push to `main`. Stays.
