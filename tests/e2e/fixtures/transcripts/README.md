# Transcript fixture

Two Claude Code transcripts, in the JSONL shape `apps/web/dev/usage.ts` reads.
`tests/e2e/dev-usage.spec.ts` points `CLAUDE_TRANSCRIPT_DIR` here (via
`playwright.config.ts`) so the Usage page has figures an assertion can be
written against — a real machine's spend is not something a test can name.

What the two files add up to, and why each line is here:

| Issue  | Output tokens               | Turns | Sessions | Cache read                      |
| ------ | --------------------------- | ----- | -------- | ------------------------------- |
| `#101` | 12,000 + 8,000 = **20,000** | 2     | 1        | 300,000 + 100,000 = **400,000** |
| `#102` | **3,000**                   | 1     | 1        | **20,000**                      |
| `#105` | **90,000**                  | 1     | 1        | **250,000**                     |

Three lines are in `session-a.jsonl` to be kept out of every row above, and each
one is a rule worth holding:

- a turn on `main` — belongs to no issue, and must not land in any row. Since
  #253 it is not merely excluded: it is reported on its own, as **1 turn** and
  **5,000** output tokens. It sits _between_ two `feat/101-a` turns in the same
  session, which is what a scan attributing by session rather than by branch
  would get wrong;
- a turn on `chore/no-issue-here` — a branch naming no issue is dropped, not
  bucketed into a zeroth row, and it is not unattributed either: `unattributed`
  means `main` or no branch at all;
- a truncated final line — the ordinary shape of an append-only JSONL file that
  is still being written, and skipping it must not lose the lines above it.

`#105` shares `session-b.jsonl` with `#102`, on its own branch. That is the
mirror of the `main` turn above: two branches in one session must land in two
rows, the same way one session's `main` turn must land in none.

## What the bands and the listing make of these figures

`fixtures/gh-issues.ts` is the other half — it pins what was _forecast_ where
this directory pins what was _spent_. Read together, with the bands in
`apps/web/src/dev/usage-protocol.ts` (`S <60k`, `M 60-150k`, `L 150-250k`,
`XL >250k`,
`max` exclusive):

| Issue  | Forecast     | Landed   | Verdict       |
| ------ | ------------ | -------- | ------------- |
| `#101` | `S` <60k     | `S`      | **on target** |
| `#102` | none         | `S`      | none          |
| `#105` | `S` <60k     | `M`      | **over**      |
| `#103` | `M` 60-150k  | none     | none          |
| `#104` | `L` 150-250k | _no row_ | —             |

`#105` is what #274 added, and it is the ticket's risky half named up front: the
fixture had no over-budget row at all, so a verdict facet's only testable
outcome would have been "matches nothing", which proves nothing about a filter.

**Adding it moved figures that belong to the charts (#252), not to the filters.**
Both are restated as literals in `dev-usage.spec.ts`, and both moved in the same
commit as this file:

- **Accuracy is 1/2 on target (50%)**, where it was 1/1. The denominator is the
  interesting half and is unchanged in kind: only a row carrying _both_ a band
  and spend to read against it is scored, so `#102` (figures, no band) and
  `#103` (band, no figures) are still out of it. `#105` is the second row that
  qualifies, and it missed.
- **The quartiles are p25 3,000 · median 20,000 · p75 90,000.** Nearest-rank
  over the three recorded totals sorted — 3,000, 20,000, 90,000 — puts p25 on
  the first, the median on the second and p75 on the third. Only p75 moved: with
  two values it sat on 20,000 alongside the median. The two lower marks still
  share band `S`, which keeps the grouped-label case the chart draws them with;
  p75 now sits alone in `M`, so the fixture exercises both arrangements.
- **Three issues with recorded spend**, where it was two.

An over-budget row cannot be anything but the largest figure here — `over`
against `forecast/S` means at least 60,000 output tokens — so `#105` also sorts
_first_ under the table's default ranking. Every ordering assertion in the spec
counts it.

Change a number here and `dev-usage.spec.ts` goes red, which is the point: the
spec states these totals as literals rather than recomputing them with the code
under test.
