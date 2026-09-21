# PRD: The evals vocabulary and its projection live in the wrong modules

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-09-21

## Problem

`apps/api/src/evals/` is a well-formed directory: eight modules — the runner,
`stored-verdict`, `classify-case`, `schedule`, `start-run`, `frozen-corpus`,
`config`, `schedule-queue` — and each one has its own test file beside it.

The thing that turns a Run's stored verdicts into the rows the Evals page
renders is not one of them. It is **430 of the 764 lines of
`apps/api/src/routes/evals.ts`** — `tally`, `reachedFrom`, `metricRow`,
`previousMetric`, `filedFrom`, `categoriesFrom`, `checksFrom`, `rate`,
`thresholdsFrom`, `previousRuns`, `anchorRun` — sitting above the two route
handlers that begin at line 529. Four of those are `export`ed, and nothing in
production imports them: their only caller is `routes/evals.test.ts:1088–1360`.
The route module's interface was widened so its test could reach past the
router.

That projection reads a column `evals/stored-verdict.ts` writes, and is read by
a page that computes against the same figures — so a change to what a Run row
carries lands in three files at once. `routes/evals.ts` and `EvalsPage.tsx` were
co-edited **9 times in the last 200 commits**, and `routes/evals.ts` and
`packages/shared/src/index.ts` another 9.

Which is the second half. The vocabulary both ends speak is **one 3,236-line
file** — 133 KB, 240 exports, thirteen domains, no section headers — while its
sibling `@ticket/core` is a **12-line barrel** over twelve domain modules with
the same domain names. The evals block alone is 775 lines of it. Reading
`@ticket/shared` to find out what an `EvalMetricRow` is costs the tickets
vocabulary, the knowledge vocabulary, the dashboard's stats, the pipeline, the
outbox, activity, tutorials, the new-feature badge, the dashboard layout and the
changelog.

## Users

The developer working in this repository. Not `admin` and not `agent` — nothing
in this PRD changes anything either of them can see.

The job is **changing what a Run reports**, which today means opening a 764-line
route module, a 3,236-line vocabulary file and a 1,062-line page, and knowing
which of the three owns the thing you came to change.

## Success metrics

| Metric                                                           | Today                          | Target                          |
| ---------------------------------------------------------------- | ------------------------------ | ------------------------------- |
| `routes/evals.ts` interface                                      | 6 exports, 4 of them test-only | 1 (`createEvalsRouter`)         |
| Lines in `routes/evals.ts` that are not routing                  | 430 of 764                     | 0                               |
| Projection behaviour assertable without importing a route module | none                           | all of it                       |
| Largest module in `packages/shared/src/`                         | 133 KB / 3,236 lines           | under 20 KB                     |
| Call sites changed by the `@ticket/shared` split                 | —                              | 0                               |
| _Guardrail:_ `GET /api/evals/runs` response                      | —                              | byte-identical before and after |

The guardrail matters because a Run's rates are a published measurement. A
refactor that moved one would be indistinguishable, from the page, from a model
getting worse.

## Scope

### In this pass

| #   | Requirement                                                                                                                                                 | Priority |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | Turning a Run's stored verdicts into the rows and rates the Evals page reads is one module, tested through its own interface.                               | Must     |
| R2  | No function exists solely so a test can reach it — the route module exports what production calls and nothing else.                                         | Must     |
| R3  | The route module contains routing: request parsing, authorisation, status codes and the response shape, and no derivation of what the response carries.     | Must     |
| R4  | `GET /api/evals/runs` returns a byte-identical body, for the same database contents, before and after.                                                      | Must     |
| R5  | A domain's shared vocabulary is one module — reading what an eval Run row carries does not require reading the ticket, knowledge or changelog vocabularies. | Must     |
| R6  | Nothing outside `packages/shared` changes an import to get R5.                                                                                              | Must     |
| R7  | `packages/shared` presents the same names, with the same types, after the split as before it.                                                               | Must     |
| R8  | The projection module sits beside the module that parses the column it reads.                                                                               | Should   |

### Non-goals

- **Any change to what a Run measures, reports or is judged against.** R4 and R7
  are the boundary. The metrics, thresholds, counters and bands are untouched.
- **`apps/web/src/pages/EvalsPage.tsx`.** It is 1,062 lines with eight nested
  components and four pure helpers (`verdict`, `percent`, `deltaLabel`,
  `categoryLabel`) that only its 1,529-line test reaches. That is a real
  candidate and it is the mirror image of R1 on the client — but it is a
  different module, a different seam and a different risk, and folding it in
  here doubles the blast radius of a PRD whose whole safety argument is R4.
  Its own PRD.
- **`apps/api/src/evals/runner.ts`'s interface.** Fixed by
  [ADR-0018](../adr/0018-a-measuring-module-reads-the-taxonomy-not-the-retry-table.md),
  which measured it and concluded it cannot usefully shrink. Nothing here
  reopens it.
- **Splitting `@ticket/core`.** It is already the shape this PRD wants
  `@ticket/shared` to have.
- **Moving anything out of `packages/shared` into `packages/core` or an app.**
  R6 and R7 mean the package's interface is identical afterwards; where a name
  _belongs_ is a separate argument.
- **`changelog-entries.json`.** CI appends to it on every push to `main`; it is
  generated, not vocabulary, and it stays exactly where it is.

## Constraints

- **`@ticket/shared` exposes exactly one entry point** (`"exports": { ".": … }`)
  and no deep import of it exists anywhere in the repo. That is what makes R6
  achievable at zero cost — and it must stay true, or R6 becomes a rename of
  every import in both apps.
- **`packages/shared/src/index.ts` is the single hottest vocabulary file here**:
  61 commits, and 9 of the last 200 alongside `routes/evals.ts`. A branch that
  rewrites it conflicts with every other branch touching it, so **the split runs
  on a clean tree with nothing else open** — sequence it last.
- **API tests run against a real Postgres in process**
  ([ADR-0014](../adr/0014-api-tests-run-against-a-real-postgres-in-process.md)),
  and `mock.module`'s registry is one process wide. A new module under
  `apps/api/src/evals/` that a test stubs must not collide with a specifier
  another test file already owns — the hazard `docs/standards/testing-api.md`
  documents, and the reason [ADR-0016](../adr/0016-a-feature-config-guard-stays-a-module.md)
  kept the config guards where they are.
- **`bun test` file order differs between Windows and `ubuntu-latest`.** A
  registry collision passes locally and fails on CI. Verify R1's new module on a
  CI run, not only on this machine.
- **Role values come from `USER_ROLE`** and zod schemas live in `@ticket/core`
  — the split must not tempt anything to redefine either.

## Risks

| Risk                                                                                   | Impact                                                                        | Mitigation                                                                                                           |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| The projection moves and a rate changes by rounding or ordering                        | A published measurement shifts, and the page reports it as the model changing | R4, checked by capturing the endpoint's body against a seeded run before the first slice and diffing after each      |
| The `@ticket/shared` split lands mid-flight against another branch                     | Every hunk conflicts; resolving it by hand is how a name gets dropped         | Sequenced last, on a clean tree, as its own slice with nothing else in the commit                                    |
| A `export *` barrel introduces a circular import between two new domain modules        | The build breaks in a way that names the barrel, not the cycle                | Split at the seams the current file's ordering already shows; a domain that needs another's type imports it directly |
| The new evals module collides with an existing `mock.module` specifier                 | Green on Windows, red on `ubuntu-latest`, and the failure names neither file  | Keep it a leaf module, per `testing-api.md`; confirm on CI before the ticket closes                                  |
| R2 removes the four exports and the projection's tests are rewritten rather than moved | Coverage silently narrows while the diff looks like a move                    | The tests move first, unchanged, in their own commit; only then does anything else change                            |

## Open questions

- [ ] Is the projection one module or two — the per-repeat tallies
      (`reachedFrom`, `filedFrom`, `categoriesFrom`, `checksFrom`) and the
      run-level metrics (`metricRow`, `previousMetric`, `previousRuns`,
      `anchorRun`) are different questions over the same rows. — _affects R1_,
      decide in the plan
- [ ] Does `EvalsConfig` stay an export of the route module, or move with the
      projection? — _affects R2_
- [ ] **Assumed:** thirteen domain modules is the right cut for R5, taken from
      the current file's own ordering. `tickets`/`users`/`messages` are
      contiguous today and may want to be one module or three.
- [ ] **Assumed:** R4 is verified against a seeded eval run in the test
      database. Confirm there is one, or that seeding one is in scope.
- [ ] **Assumed:** the Evals page's own 430-line-equivalent problem is deferred
      rather than declined. If it is declined, that deserves an ADR.
