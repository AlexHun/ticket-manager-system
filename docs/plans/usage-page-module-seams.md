# Plan: Usage page — seams the slices keep paying for

**PRD:** [docs/prd/usage-page-module-seams.md](../prd/usage-page-module-seams.md) · **Status:** Draft · **Date:** 2026-09-21

## Layers crossed

This feature reaches no API, no zod schema and no database. Its layers are the
two halves of the dev tooling and the two surfaces that read them:

```
transcripts on disk (CLAUDE_TRANSCRIPT_DIR) + gh listing (ISSUES_FILE_ENV)
  → apps/web/dev/usage.ts        scanSpend · joinIssues · gatherUsage
  → apps/web/dev/issues.ts       fetchIssueMetadata
    → apps/web/src/dev/protocol.ts   the wire contract, the arithmetic, the UI copy
      → apps/web/dev/plugin.ts       POST /__devtools/usage
      │   → apps/web/src/dev/UsagePage.tsx → SpendTable.tsx / UsageCharts.tsx
      └─→ scripts/issue-tokens.ts    `bun run tokens`, the second surface
```

**Both surfaces are the point.** Every slice below is judged by whether the page
_and_ the terminal still say exactly what they said before. `new:` appears in
one place only — `usage-view.ts` in slice 5.

## The done bar, and how this plan reads it

`prd-to-plan` asks every slice to end at a passing Playwright spec driving the
whole path. A refactor has no new path to drive, so this plan inverts it: **slice
1 builds the spec, and every later slice is done when that spec passes
unchanged.** That is not a weaker bar — R8 says the output is byte-identical, so
a guardrail that had to be edited is a slice that changed the measurement.

`bun run tokens` is inside the bar. Nothing in the repo drives that script today
— it has no test of any kind — and half of what these slices move is on its side
of the wire.

## Slice 1 — Both surfaces get a snapshot

**Retires:** the whole plan's premise — that a moved figure is detectable at all. Today it is not.
**Covers:** R8

A Playwright spec that, against the existing E2E transcript fixtures and a
written issue listing, captures **both** outputs and compares them to committed
snapshots: the Usage page's full table text plus its three panels, and the
stdout of `bun run tokens` spawned as a child with the same two env overrides.

- A developer can run one spec and find out whether the page or the terminal
  now says something different from what it said before their branch.

**Hardcoded for now:**

- Nothing moves. This slice changes no production file.
- `gatheredAt` and `scanMs` are masked in both snapshots — they vary per run and
  are not a measurement.
- The snapshot is the E2E fixture's four rows, not a real scan. A real scan is
  this machine's own spend and cannot be committed.

**E2E:** `tests/e2e/dev-usage-guardrail.spec.ts` — the page's table and panels,
and the script's stdout, both match committed snapshots. Fails loudly if either
moves.

## Slice 2 — `protocol.ts` splits three ways

**Retires:** whether the 13 importers really cluster 1:1 by page, or whether something crosses.
**Covers:** R1
**Un-hardcodes:** nothing — this is the move slice 1 was built to police.

`protocol.ts` becomes three modules, one per dev tool. `DEVTOOLS_API` goes
wherever the spike says. Imports updated; nothing else changes.

- A developer adding a Usage column reads one contract module, not three.

**Hardcoded for now:**

- The Usage contract module still holds the browser's UI copy, the view-state
  types and four runtime functions. Splitting _that_ further is slice 5 and R10.

**E2E:** slice 1's guardrail passes unchanged, plus `dev-usage.spec.ts` and the
project-map specs unchanged. **Runs on a clean tree** — it touches every import
in the directory.

## Slice 3 — One statement of "nobody has started it"

**Retires:** whether `rank`'s `-1` and `started`'s `!== null` are the same function. They are not, and the plan has to find out which callers want which.
**Covers:** R2
**Un-hardcodes:** the six separate statements of the absence rule.

One named predicate in the half both ends import. `rank` in `joinIssues`,
`started` in the comparator, `hasSpend` in the facets, the exclusion inside
`recordedSpend` and the `<NotStarted />` cell all read it.

- The rule the page exists to hold has one home, and changing it changes it
  everywhere.

**E2E:** slice 1's guardrail unchanged. The sink is already held by
`usage-sort.test.ts` over every key in both directions — those cases must still
pass untouched.

## Slice 4 — One statement of the default ranking

**Retires:** whether the server's order and `DEFAULT_USAGE_SORT` are genuinely the same claim, or differ in the tie-break.
**Covers:** R3
**Un-hardcodes:** `usage-sort.ts:72`'s "the same claim written twice".

`joinIssues`' `rank(b) - rank(a) || a.issue - b.issue` and the comparator's
default become one expression the other reads.

- The first render after a scan is provably the order the server sent, rather
  than an order that currently matches by hand.

**E2E:** slice 1's guardrail unchanged — the fixture's default ordering is in
the snapshot, and an over-budget row leads it.

## Slice 5 — The narrowing becomes a module

**Retires:** the largest unknown left — whether the filter/sort composition and the detail-toggle's sort reset can leave a `.tsx` while the view state stays on `UsagePage`.
**Covers:** R5, R4 (partly)
**Un-hardcodes:** `SpendTable.tsx` owning the shape of its parent's state.

`new:` `apps/web/src/dev/usage-view.ts` — pure, owning `UsageTableView`,
`DEFAULT_USAGE_TABLE_VIEW`, `visibleRows(issues, view)` and
`withDetail(view, next)`. It absorbs `matchesFacets`, `sortIssues` and
`DETAIL_SORT_KEYS`. `SpendTable` renders the rows it is handed.
`UsagePage` still holds the state — that is #272's measured decision and this
slice does not touch it.

- A developer can ask "what does this filter show" without rendering anything.

**Hardcoded for now:**

- `UsagePage.test.tsx` still asserts all of it through a full page render. Slice
  6 is what makes that stop.

**E2E:** slice 1's guardrail unchanged, plus a new `usage-view.test.ts` unit
suite that imports no component.

## Slice 6 — The page's test stops testing four other modules

**Retires:** nothing — this is the slice that banks the metric.
**Covers:** R4
**Un-hardcodes:** 867 of `UsagePage.test.tsx`'s 1,726 lines.

The sorting, search and facet describe blocks (lines 859–1726) move to
`usage-view.test.ts` as unit cases. What stays in `UsagePage.test.tsx` is what
the page owns: reads nothing until Scan, the warnings, the two absence markers,
the unattributed total.

- The web suite stops mounting a page, stubbing axios and pressing a button to
  ask a comparator a question.

**E2E:** slice 1's guardrail unchanged. `dev-usage.spec.ts` keeps its
browser-level coverage of the same controls — the unit move is not a coverage
trade.

## Slice 7 — A warning says which source failed

**Retires:** whether the page can render structured warnings without changing a character of what it displays.
**Covers:** R7
**Un-hardcodes:** `warnings: string[]`.

`UsageReport.warnings` becomes a discriminated type naming the source — the
transcript directory, or the issue listing. The page words them exactly as it
words them now.

- A caller can branch on which half of the scan failed without matching on
  prose.

**E2E:** slice 1's guardrail unchanged, and `plugin.test.ts`'s existing
missing-directory and no-`gh` cases still pass.

## Slice 8 — The terminal calls `gatherUsage`

**Retires:** the argument `scripts/issue-tokens.ts:11–20` makes against consolidating. Slices 1 and 7 are what make it answerable rather than arguable.
**Covers:** R6, R9
**Un-hardcodes:** nine imports re-assembling the scan, and `usage.ts`'s ten-symbol re-export block.

`bun run tokens` calls `gatherUsage(dir, meta)` once and formats what comes
back — its own diagnostics, its own `-` marker, its own `120k`. `--open` reads
`state` off the row if the spike says that field earns its place.

- The page and the terminal cannot report different figures because they no
  longer run different code.

**E2E:** slice 1's guardrail unchanged — **this is the slice it exists for.**
Every line of the terminal's output is in that snapshot.

## Requirement coverage

| Req | Slice | Note                                                                                                   |
| --- | ----- | ------------------------------------------------------------------------------------------------------ |
| R1  | 2     |                                                                                                        |
| R2  | 3     |                                                                                                        |
| R3  | 4     |                                                                                                        |
| R4  | 5, 6  | Slice 5 makes it possible, slice 6 makes it true                                                       |
| R5  | 5     |                                                                                                        |
| R6  | 8     |                                                                                                        |
| R7  | 7     | Blocks slice 8 — the terminal needs structured warnings before it can word its own                     |
| R8  | 1     | Built in slice 1, then re-run unchanged by every slice after it                                        |
| R9  | 8     | `Should` — drops if the spike says `state` on the wire is a field nothing but one caller reads         |
| R10 | 2, 5  | `Should` — a consequence, not a slice. Measured at the end of 2 and 5; if still over, it needs a ninth |

Every `Must` has a slice. No slice exists without a requirement.

## Spikes

- **Where does `DEVTOOLS_API` live after the split?** All three tools read it,
  so it is either a fourth module or duplicated per tool. Timebox 1h, blocks
  slice 2.
- **Does `state` on `IssueUsage` earn its place?** #253's rule is that a field on
  the wire is a promise something reads it, and after slice 8 the only reader
  would be `--open`. The alternative is leaving the terminal's re-join alone.
  Timebox 2h, blocks slice 8's R9 half only — R6 does not depend on it.

## Deferred

- **`apps/web/dev/scan.ts`, `suites.ts` and the run queue** — same directory,
  different problem. [dev-server-test-seams.md](dev-server-test-seams.md).
- **Deleting `usage-facets.ts` or `UsageFilters.tsx`** — PRD non-goal. Slice 5
  absorbs the predicates into the module that composes them; the facet
  vocabulary #274 argued for stays.
- **Any change to what either surface says** — PRD non-goal, and slice 1 is what
  enforces it.
- **`UsageCharts.tsx`'s untested drawing.** `usage-charts.ts` is covered and
  Recharts renders nothing in jsdom, so the drawn marks are E2E-only. Real, and
  not this PRD.
