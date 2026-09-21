# PRD: Usage page — seams the slices keep paying for

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-09-21

## Problem

The Usage page has been built in six slices since #248, and every one of them
paid the same toll. `apps/web/src/dev/protocol.ts` appears in **15 of the last
24 dev commits** — not because the wire changed fifteen times, but because the
file holds three unrelated contracts, the browser's UI copy, the client's
view-state types and four runtime functions. Adding a search box touched it.
Adding three selects touched it. A change to what the scan actually carries is a
**four-file edit** by construction — `dev/usage.ts`, `protocol.ts`,
`UsagePage.tsx`, `UsagePage.test.tsx` — and that exact quartet moved together in
six commits.

Underneath that, the page's central claim is written out six times. _A row with
no recorded spend is an absence, not a zero_ — the rule the whole feature exists
to hold, because `bucketFor(0)` is `S` and a zeroed row would claim to have beaten
its forecast. It is `rank` in the node half, `started` in the comparator,
`hasSpend` in the facets, a doc comment in the contract, a `<NotStarted />` cell,
and an exclusion inside `recordedSpend`. Six statements of one rule, in both
halves, with nothing holding them in step.

And the table's narrowing — filter-then-rank, an untouched control matches
everything, hiding the detail columns returns the sort to its default — lives
inside `SpendTable.tsx`, which no `.ts` test can import. So **867 of
`UsagePage.test.tsx`'s 1,726 lines** mount the entire page, stub axios, press
Scan and read the DOM in order to assert a comparator's composition. There is no
`SpendTable.test.tsx`, no `UsageCharts.test.tsx` and no `UsageFilters.test.tsx`;
one file is the suite for five modules.

## Users

The developer working in this repository — not `admin`, not `agent`. Same user
and same constraints as [usage-table-legibility.md](usage-table-legibility.md)
and [dev-tools-usage-page.md](dev-tools-usage-page.md): the page lives under
`/__dev`, outside `ProtectedRoute` and outside `AppShell`, and must keep opening
when the API and Postgres are down.

The job this PRD is about is not reading the page. It is **adding the next thing
to it** — and paying four files, one 42 KB module and a full-page render to do
it.

## Success metrics

| Metric                                                                  | Today                             | Target                          |
| ----------------------------------------------------------------------- | --------------------------------- | ------------------------------- |
| Files edited by a change to what the scan carries                       | 4 (six commits running)           | 2                               |
| Narrowing rules reachable from a `.ts` unit test                        | 0 of 3                            | 3 of 3                          |
| `UsagePage.test.tsx` lines that mount the page to assert another module | 867 of 1,726 (50%)                | 0                               |
| Statements of "a row with no recorded spend is an absence"              | 6                                 | 1, read by the rest             |
| Largest module a Usage slice must read                                  | 42 KB (`protocol.ts`, 54 exports) | under 15 KB                     |
| `dev/usage.ts` interface                                                | 19 names (9 own + 10 re-exported) | 2                               |
| _Guardrail:_ what the page and `bun run tokens` print                   | —                                 | byte-identical before and after |

The guardrail is the one that matters. Every figure on this page is a claim
about this repository, and R8 below is what keeps a refactor from quietly
becoming a change to the measurement.

## Scope

### In this pass

| #   | Requirement                                                                                                                                               | Priority |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | A module that renders the project map does not read the Usage page's contract, and vice versa.                                                            | Must     |
| R2  | The rule that a row with no recorded spend is an absence rather than a zero is stated once, and every module that needs it reads that statement.          | Must     |
| R3  | The table's default ranking is stated once, not once on the server and once in the comparator.                                                            | Must     |
| R4  | Filtering, ranking, and the rule that hiding the detail columns returns the sort to its default are all assertable from a test that imports no component. | Must     |
| R5  | The shape of the table's view state is declared by the module that computes against it, not by the component that renders it.                             | Must     |
| R6  | `bun run tokens` obtains its rows, its totals and its diagnostics from one call, and words those diagnostics itself.                                      | Must     |
| R7  | A caller can tell which source a scan's warning came from without reading the warning's text.                                                             | Must     |
| R8  | The page's rendered output and `bun run tokens`' printed output are unchanged, byte for byte, for the same transcripts and the same issue listing.        | Must     |
| R9  | Filtering `bun run tokens` to open issues reads a field on the row rather than re-joining the issue listing the row was built from.                       | Should   |
| R10 | No module in `apps/web/src/dev/` or `apps/web/dev/` exceeds 15 KB.                                                                                        | Should   |

### Non-goals

- **Any change to what the page shows or how it reads.** R8 is the whole
  boundary. If a slice here starts arguing about a column, a label or a figure,
  it has drifted into a different PRD.
- **Rewriting the assertions in `UsagePage.test.tsx` that genuinely belong to the
  page.** Lines 1–612 test what the page owns — R5 of the original PRD (reads
  nothing until Scan), the warnings, the two absence markers. Those stay.
- **Deleting `usage-facets.ts` or `UsageFilters.tsx` outright.** The review found
  both shallow, but #274 argued the facet _vocabulary_ deliberately and that
  argument stands; R4 absorbs the predicates into the module that composes them
  rather than inlining them into a component.
- **`apps/web/dev/scan.ts`, `suites.ts` and the run queue.** They are the same
  directory and the same kind of problem, and they are
  [dev-server-test-seams.md](dev-server-test-seams.md).
- **Changing `bun run tokens`' output**, including its diagnostics wording, its
  `-` marker or its `120k` number format. R6 moves where the strings are built,
  not what they say.
- **Reviving `USAGE_COLUMNS` as anything other than a positional contract.** Both
  suites index cells by position; that constraint is unchanged and is why R1's
  split must keep the column lists together.

## Constraints

- **`USAGE_COLUMNS` is a positional contract** (`docs/standards/frontend.md`,
  #270–#274). Any module the column names move into is imported by both
  `UsagePage.test.tsx` and `tests/e2e/dev-usage.spec.ts`, so it must stay a
  `.ts` module neither suite has trouble reaching.
- **The table's view state must stay on `UsagePage`.** `useUsageScan` is a
  `useMutation` and a mutation clears its `data` the moment it fires, so `report`
  is null for the length of the read and anything held inside the table is thrown
  away by the press of Scan that re-asks the same question (#272, measured). R5
  moves where the shape is _declared_, never where it is _held_.
- **Relative imports in `apps/web/dev/` carry their `.ts` extension** and use
  `import.meta.dirname` — required by Vite's `configLoader: 'native'`. New files
  in that directory follow it or the warning block returns.
- **`protocol.ts` is imported from both halves.** Anything the node half reads —
  today `BUCKETS`, `VERDICT`, `bucketFor`, `forecastAccuracy`, `percentiles`,
  `recordedSpend` — cannot move into a browser-only module.
- **R6 reopens an argument the code already makes.** `scripts/issue-tokens.ts:11–20`
  says consolidating onto `gatherUsage` would trade away the terminal's own
  diagnostics and its `--open` filter. That argument is about the command's
  **output** and it is correct; R6 and R7 change the **interface** so the output
  can stay different. Anyone implementing this should read that comment first.
- **No ADR covers `apps/web/dev/`.** ADRs 0015–0019 all decided "not a module"
  about `apps/api`; none of them reaches here.

## Risks

| Risk                                                                         | Impact                                                                                                             | Mitigation                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| A refactor quietly changes a figure                                          | The page's claims about this repository become claims about a refactor, and nobody notices because the tests moved | R8 as a testable requirement; capture both outputs before the first slice and diff them after each one |
| Moving the column names breaks positional assertions in both suites silently | Suites stay green while asserting against a neighbouring cell                                                      | The column lists move as one unit, and the move is its own slice with no other change in it            |
| Consolidating the six statements of the absence rule lands on the wrong one  | `rank`'s `-1` and `started`'s `!== null` are not the same function; collapsing them carelessly changes the sort    | R2 and R3 are separate requirements for that reason — the sink rule and the ranking are two claims     |
| Adding `state` to the row grows the wire for one caller                      | A field on the wire is a promise something reads it (#253's rule)                                                  | R9 is a `Should`; if only the terminal reads it, the honest answer may be to leave `--open` as it is   |
| The split lands while another Usage slice is in flight                       | Every import in the directory conflicts                                                                            | Sequence R1 first, on a clean tree, before anything else in this PRD                                   |

## Open questions

- [ ] Does the absence rule live beside `bucketFor` in the contract, or in its
      own module both halves import? — _affects R2_, decide in the plan
- [ ] **Assumed:** three contract modules, split by dev page, is the right cut —
      the 13 importers already cluster 1:1, but `DEVTOOLS_API` is read by all
      three and needs a home.
- [ ] **Assumed:** R8 is verified by capturing `bun run tokens` output and a
      Playwright snapshot of the page against the E2E fixture before the first
      slice, and diffing after each. Confirm that is enough, or name a stronger
      check.
- [ ] **Assumed:** 15 KB is the right ceiling for R10. It is roughly what
      `usage-charts.ts` and `usage-sort.ts` already are; nothing measured it.
- [ ] **Assumed:** R6 does not require `gatherUsage` to grow a "which figures do
      you want" parameter — the terminal prints a subset of what the page shows,
      so one sweep serves both.
