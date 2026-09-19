# Plan: Usage page — a spend table you can read

**PRD:** [docs/prd/usage-table-legibility.md](../prd/usage-table-legibility.md) · **Status:** Draft · **Date:** 2026-09-19

## Layers crossed

```
web (apps/web/src/dev/UsagePage.tsx — SpendTable, new: UsageFilters.tsx)
  → contract (apps/web/src/dev/protocol.ts — USAGE_SPINE / USAGE_DETAIL / USAGE_COLUMNS)
    → tests (apps/web/src/dev/UsagePage.test.tsx + tests/e2e/dev-usage.spec.ts)
      → fixtures (tests/e2e/fixtures/transcripts/, fixtures/gh-issues.ts)

  ✗ no API route, no @ticket/core schema, no domain module, no Prisma, no queue
  ✗ no change to apps/web/dev/usage.ts — the scan is untouched by construction
```

This feature is **shallower than the usual stack, and that is the design**. The
PRD makes "no backend change" a constraint: every field these slices render is
already on the wire. The layer that carries the risk here is not a database, it
is `protocol.ts` — `USAGE_COLUMNS` is a **positional contract** that two test
suites index rows against and neither can import the page. A slice that starts
needing `apps/web/dev/usage.ts` has drifted into the spend-over-time PRD.

**The contract's new shape** (resolves the PRD's first open question): two lists
whose concatenation is the order, rather than one list with a flag.

```ts
export const USAGE_SPINE = ["title", "out", "comparison"] as const;
export const USAGE_DETAIL = ["turns", "sessions", "cacheRead"] as const;
export const USAGE_COLUMNS = [...USAGE_SPINE, ...USAGE_DETAIL] as const;
```

Detail columns **append**, so a cell's index is stable whether the toggle is on
or off — the spine occupies 0..2 in both states. That is what lets one index map
serve both, instead of two maps that can disagree.

## Slice 1 — One cell for the forecast comparison

**Retires:** whether `Unknown` and `NotStarted` survive being collapsed into one
cell — the page's central claim, and the thing most likely to break quietly.
Also proves the positional contract tolerates a _shrinking_ column set before
slice 2 asks it to tolerate a varying one.
**Covers:** R3, R4

Nine columns become seven. `forecast`, `bucket` and `verdict` merge into a
single `comparison` cell reading `S <60k → S <60k` with the verdict Badge after
it; `turns`, `sessions` and `cacheRead` stay visible and untouched.

- A developer sees each issue's forecast, the band it landed in, and its verdict
  in one cell, and can still tell "`gh` could not say" from "no work yet" by
  hovering either half.

**Hardcoded for now:**

- The three diagnostic columns are still always visible — no toggle yet (slice 2)
- Column order is still fixed; nothing sorts (slice 3)
- Every row always renders; nothing filters (slices 4–5)

**E2E:** `tests/e2e/dev-usage.spec.ts` — its three existing row tests rewrite
onto the one cell. The fixture already holds all three states: `#101` (band +
spend → `on target`), `#102` (spend, no band → `Unknown` on the forecast half),
`#103` (band, no spend → `NotStarted` on the landed half). The assertion that
matters is that `#102` and `#103` render **different** markers with different
hover text, not one shared dash.

## Slice 2 — The spine, and a toggle for the rest

**Retires:** whether two fixed column sets can both be positional contracts at
once. · **Covers:** R1, R2
**Un-hardcodes:** slice 1's "three diagnostic columns always visible"

Introduces the `USAGE_SPINE` / `USAGE_DETAIL` split above. The table renders the
spine by default — four columns including the issue row-header — and one shadcn
control above it appends the three detail columns.

- A developer opens the page and reads every default column without scrolling
  sideways, then presses one control to get turns, sessions and cache-read back.

**Hardcoded for now:** nothing sorts or filters yet (slices 3–5)

**E2E:** extends slice 1's spec — assert four `columnheader`s after a scan,
press the toggle, assert seven, and assert a spine cell's index is unchanged
across both states. Measure the table's scroll width against its client width at
a 1280px viewport to hold R1 honestly rather than asserting a column count and
calling it "readable".

## Slice 3 — Sortable headers, and the sink

**Retires:** whether unstarted rows can be kept out of the ranking without a
second code path — the second place `bucketFor(0) === "S"` can produce a lie.
· **Covers:** R5, R6, and R11 for sort

Copies `ModuleTable`'s shape (`aria-sort` on the `<th>`, a `<button>` inside,
`ArrowUp`/`ArrowDown`, click-active-column-to-flip). Default stays output tokens
descending so the first render after a scan matches the server's order and does
not reshuffle. Rows with `spend === null` sort to the bottom **unconditionally**,
in both directions.

- A developer ranks 98 rows by any figure, either way, and the issues nobody has
  started never appear among the cheapest work.

**E2E:** extends the spec — click `Output tokens`, assert `#102` (3,000) now
precedes `#101` (20,000); assert `#103` is the last row in **both** directions;
press Scan again and assert the chosen sort survives.

## Slice 4 — Search, and the reach the filters have

**Retires:** the guardrail — whether narrowing the table leaves the accuracy
figure alone. This is the first slice that can get R10 wrong, so it is where
R10 is proved. · **Covers:** R7, R9, R10, R11, R12

A debounced `type="search"` input (`useDebouncedValue`, 150ms, matching the
project map's) matching issue number and title. `countLabel(shown, total)` from
`dev/module-match.ts` goes on the `TableFrame` label. The bar renders only once
`report` exists, and its state persists across a re-scan.

- A developer types `102` or a word from a title and the table narrows, while
  the charts, the unattributed total and the gathered-at line do not move.

**E2E:** extends the spec — type a query, assert the row count and the
`shown of total` label; assert `CHARTS.accuracy`, `CHARTS.quartiles` and the
unattributed strip read **identically** before and after. Assert the bar is
absent before the first Scan.

## Slice 5 — Facet filters

**Retires:** the fixture ripple — the only change in this plan that moves
numbers the existing chart tests assert on. · **Covers:** R8, thickens R9–R11
**Un-hardcodes:** slice 4's "one box, one kind of narrowing"

Three `FilterSelect`s — forecast band, verdict, started/unstarted — composed with
slice 4's search. Each needs a non-empty "any" token mapped at the boundary,
because Radix rejects `value=""` on a `SelectItem`.

**This slice extends the transcript fixture with a fourth issue that comes in
over its band**, because the current fixture has no `over` row at all and a
verdict filter whose only testable outcome is "matches nothing" does not prove
the feature. The cost is named rather than discovered: adding a fourth issue
with spend moves `CHARTS.accuracy` from `1/1` to `1/2`, shifts all three
quartiles, and rewrites `fixtures/transcripts/README.md` — assertions that
belong to #252, not to this PRD. Do the fixture change and the README in the
same commit as the constants, so no intermediate commit is red.

- A developer narrows to every issue that came in over forecast in one action.

**E2E:** extends the spec — filter to `over` and assert the new fixture issue is
the only row; filter to a band with no members and assert the empty state, not a
blank table; combine a filter with slice 4's query and assert both apply.

## Requirement coverage

| Req | Slice | Note                                                 |
| --- | ----- | ---------------------------------------------------- |
| R1  | 2     | Held by a scroll-width assertion, not a column count |
| R2  | 2     |                                                      |
| R3  | 1     |                                                      |
| R4  | 1     | The slice's whole reason to exist                    |
| R5  | 3     |                                                      |
| R6  | 3     |                                                      |
| R7  | 4     |                                                      |
| R8  | 5     | Needs the fixture extension to be testable at all    |
| R9  | 4     | Thickened in 5 when a second control can narrow      |
| R10 | 4     | Re-asserted in 5; this is the PRD's guardrail metric |
| R11 | 3     | Sort in 3, filters in 4 and 5                        |
| R12 | 4     | `Should` — arrives with the bar it describes         |

Every `Must` has a slice. Every slice cites a requirement.

## Spikes

None. The one open unknown — whether four columns genuinely clear 1280px given
`Title`'s `max-w-[26rem]` cap — is measured by slice 2's own E2E assertion
rather than guessed at beforehand, so it is a slice, not a question.

## Deferred

- **A date filter or calendar** — PRD non-goal. A row is an issue's lifetime
  total; a date window either filters on a proxy that lies or re-sums into
  partials that destroy the band and the verdict.
- **A spend-over-time chart** — PRD non-goal, and the honest form of the
  question underneath the calendar. Needs the scan to read each line's
  `timestamp`, so it is a change to `apps/web/dev/usage.ts` and the wire. Its
  own PRD.
- **Resizing or collapsing the two charts** — PRD non-goal; measured, and not
  what is unreadable.
- **URL-shareable filter state** — PRD non-goal. The scan does not survive a
  reload, so a restored filter would describe rows that are not there.
- **Renaming the `Verdict` constant** in `protocol.ts`, both charts and
  `bun run tokens` — PRD non-goal. Slice 1 removes the word from the UI as a
  side effect; the `CONTEXT.md` line recording that the two senses are unrelated
  rides along with slice 1.
