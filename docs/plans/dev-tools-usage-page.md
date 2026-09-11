# Plan: Dev-tools Usage page

**PRD:** [docs/prd/dev-tools-usage-page.md](../prd/dev-tools-usage-page.md) · **Status:** Draft · **Date:** 2026-09-11

## Layers crossed

```
web (new: apps/web/src/dev/UsagePage.tsx, via apps/web/src/dev/dev-api.ts)
  → wire types (apps/web/src/dev/protocol.ts — DEVTOOLS_API gains `usage`)
    → dev middleware (apps/web/dev/plugin.ts — new route, beside graph/suites)
      → new: apps/web/dev/usage.ts — the branch→issue join, today inside the CLI
        → filesystem (~/.claude/projects/<slug>/*.jsonl) + `gh issue list`
```

**No Express route, no `@ticket/core` schema, no Prisma, no pg-boss.** That is
not a thin slice cutting corners — it is the shape of the feature. `/__dev` is
outside `ProtectedRoute` and reaches neither the API nor Postgres by design
(`DevRoutes.tsx`), and the data this reports lives on the local filesystem. The
skill's usual layer stack does not apply, and a slice that reached for it would
be violating the PRD's first constraint.

The existing consumer, `scripts/ticket-tokens.mjs`, becomes the second caller of
the new module rather than keeping its own copy of the join (R8).

## Slice 1 — One issue's spend, on screen

**Retires:** the two unknowns everything else sits on — can one module serve both
the CLI and the Vite plugin, and can an E2E observe this page on CI, where
`~/.claude/projects` does not exist?
**Covers:** R1, R5, R8

The thinnest observable path: open the page, press Scan, see real issue numbers
and real output-token totals read off real transcript files.

- A developer opens **Usage** from the dev-tools nav, presses **Scan**, and sees
  a table of issue numbers and their actual output tokens, with the time the
  figures were gathered.

Three things this slice must get right, because they are the risk:

- **The shared module is TypeScript, and the CLI moves onto Bun.**
  `apps/web/dev/` is TS with `.ts` import extensions and `import.meta.dirname`
  (`frontend.md`), while `scripts/ticket-tokens.mjs` is plain ESM run by `node`.
  Node 24 would strip types, but that is an undeclared version floor on a repo
  with no `engines` field. Running the CLI as `bun scripts/ticket-tokens.ts`
  removes the floor and matches every other script here. `bun run tokens` keeps
  its name either way.
- **The transcript directory is resolved in one function that honours an
  override.** Today it is derived from `cwd` + `homedir` with no seam, which is
  exactly why no test can reach it. An env override lets Playwright point at a
  fixture directory, and it is the difference between this plan having a done
  bar and not having one.
- **Nothing is gathered until Scan is pressed**, and the result is held in the
  plugin until the next press — so the E2E asserts on a deterministic snapshot,
  not on whatever the machine has been doing.

**Hardcoded for now:** no `gh` call, so no titles, no links, no forecast band and
no verdict · open issues with no spend do not appear · no charts · work on `main`
is counted but not reported · the CLI and the module still say _ticket_ for a
GitHub issue.

**E2E:** `tests/e2e/dev-usage.spec.ts` — with the override pointed at a fixture
transcript directory holding two branches (`feat/101-a`, `fix/102-b`), navigate
to `/__dev/usage`, assert the table is empty before Scan, press Scan, and assert
a row for `#101` carrying that fixture's exact output-token total plus a
gathered-at timestamp. Proves the whole path: page → middleware → module →
filesystem.

## Slice 2 — Titles, links and verdicts

**Retires:** `gh` called from inside the Vite middleware — whether it is
authenticated in that environment, and what the page does when it is not.
**Covers:** R2, R3, R10
**Un-hardcodes:** no `gh` call

- Each row gains the issue's title, a link out to
  `AlexHun/ticket-manager-system`, its `forecast/S|M|L` band, the bucket its
  actual lands in, and a verdict of on target / over / under.
- With `gh` missing or unauthenticated, actuals still render and the forecast
  columns say so rather than the page failing.

Anything spawned from the dev server sanitises its environment first — `childEnv`
in `dev/suites.ts` is the existing pattern and the reason for it (`--bun` puts a
fake `node` on PATH). A `gh` call is a spawn like any other.

**E2E:** extends slice 1's spec with two cases — a fixture metadata source
yielding a known title, link `href` and an on-target verdict; and the
degraded path, asserting actuals survive while the forecast reads as unknown.
The degraded case is the one worth having: it is the state CI is in by default.

## Slice 3 — Issues nobody has started

**Retires:** nothing dangerous — it is the first slice that changes where rows
come from, since the set is no longer "issues with spend".
**Covers:** R4
**Un-hardcodes:** open issues with no spend do not appear

- An open issue with a forecast and no recorded work appears with its band and
  an empty actual, rather than being absent from the page.
- The CLI gains the same rows, because it is the same module.

**E2E:** extends slice 2's spec — a fixture issue with no matching branch renders
with its forecast, an empty actual, and no verdict.

## Slice 4 — The two charts

**Retires:** nothing; deliberately late, because a chart over numbers that are
still moving is a chart nobody can check.
**Covers:** R6
**Un-hardcodes:** no charts

- Forecast accuracy, and the distribution of actual output tokens with its p25 /
  median / p75 marked on it.

Recharts, as the dashboard uses. It honours `prefers-reduced-motion` itself
(`isAnimationActive: 'auto'`), so no `useReducedMotion` wiring is needed here.
A chart's table-relief path is a known accessibility gap on `ChartCard` (#123) —
do not copy that shape; the table on this page is the relief path and it is
already there.

**E2E:** extends the spec — after Scan, both charts are present and the accuracy
figure matches what the fixture's verdicts imply. Playwright's `fullPage`
screenshots catch Recharts mid-animation, so assert on roles and text, never on
a screenshot.

## Slice 5 — What ran on `main`

**Retires:** nothing; it is the last number the module does not yet carry.
**Covers:** R7
**Un-hardcodes:** work on `main` is counted but not reported

- Turns that ran on `main` or on no branch are reported as their own total, in
  turns **and** tokens, clearly not part of any issue.

Today the script counts these turns and discards their tokens (`unattributed++`
and nothing else), so this slice changes what the module accumulates, not just
what the page prints.

**E2E:** extends the spec — the fixture's `main` turns appear in the footer with
both figures, and no issue row includes them.

## Slice 6 — An issue is not a ticket

**Retires:** the last chance to do this cheaply — every later reader is one more
person who learns the wrong word.
**Covers:** R9, and R11 as far as code can carry it

- `scripts/ticket-tokens.*` and its `SCRIPTS.md` row call a GitHub work item an
  _issue_. `bun run tokens` keeps its name — it is already neutral, and renaming
  it buys nothing.
- `docs/agents/issue-tracker.md` records that a new issue carries a
  `forecast/S|M|L` label when it is cut (R11).

`CONTEXT.md` is not touched: it is the support desk's glossary, and _Ticket_
must keep meaning one customer's request.

**E2E:** none of its own — this slice changes words, and the specs from slices
1–5 are what prove it changed nothing else.

## Requirement coverage

| Req | Slice | Note                                                            |
| --- | ----- | --------------------------------------------------------------- |
| R1  | 1     |                                                                 |
| R2  | 2     |                                                                 |
| R3  | 2     |                                                                 |
| R4  | 3     |                                                                 |
| R5  | 1     |                                                                 |
| R6  | 4     |                                                                 |
| R7  | 5     |                                                                 |
| R8  | 1     | Established by the module split; every later slice inherits it. |
| R9  | 6     |                                                                 |
| R10 | 2     |                                                                 |
| R11 | 6     | Partly. Code can document the rule; only people can apply it.   |

## Spikes

- **Is `gh` authenticated inside a process spawned from the Vite dev server,
  after `childEnv` has stripped the repo's `.env*` keys?** Timebox 1h, blocks
  slice 2. If it is not, slice 2's degraded path becomes the primary path and the
  forecast columns need a different source — which would be a real change of
  shape, not a detail.

## Deferred

- **A dollar figure** — PRD non-goal. Output tokens are the unit the bands are
  denominated in.
- **A production or admin-facing page** — PRD non-goal, considered and declined:
  the transcripts are local to one machine.
- **History across runs, and per-session drill-down** — PRD non-goals. Nothing is
  persisted, so there is no trend line to draw.
- **`forecast/XL`** — an open question on the PRD, not a slice. The script has
  the bucket; the repository has no such label. Slice 2 renders whatever labels
  exist and does not create any.
- **Retro-labelling the 86 closed issues** — an open question on the PRD. It
  would give the accuracy metric a base immediately, at the cost of estimates
  made knowing the answer. Not a code change either way.
