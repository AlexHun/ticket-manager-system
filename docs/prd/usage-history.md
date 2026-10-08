# PRD: Usage history

**Status:** Shipped · **Author:** Aleksei Hunich · **Date:** 2026-10-03

## Problem

The Usage page reads its figures from the local Claude Code transcripts, and
those transcripts are deleted after 30 days. On 2026-10-03 the oldest of the
167 on disk dates from 2026-09-02, so every issue worked before that date
already reports no spend. Each day another day of history goes. And each
reading replaces the one before, so nothing can say whether the figures
moved. #413 showed what that costs: the scan counted every API response once
per content block (2.32× overall, up to 3.89× for one issue), and that went
unnoticed because no earlier reading was kept to compare with. With it fixed,
the p25 / median / p75 of actual output tokens are 33k / 56k / 79k and forecast
accuracy is 33 of 60 (55%). Whether that is getting better or worse can still
only be answered from memory.

## Users

The developer working in this repository, on the `/__dev/usage` page and in
`bun run tokens`. This isn't an `admin` or `agent` feature. The job is the same
one the first Usage PRD gave: decide whether an issue's forecast was right and
whether the bands still fit. The new part is "over time", which a single
reading can't answer.

## Success metrics

| Metric                                                       | Today                                               | Target                        |
| ------------------------------------------------------------ | --------------------------------------------------- | ----------------------------- |
| **Issues whose recorded spend shrinks between two readings** | every issue whose last transcript ages past 30 days | 0                             |
| Days with a scan that have a point on the trend              | 0 (nothing is kept)                                 | every one, from launch        |
| _Guardrail:_ how long one press of Scan takes                | 2-5s over 136 transcripts, plus ~2s of `gh`         | no slower as transcripts grow |

The guardrail matters because of the stopgap below. With pruning switched off,
the transcript directory now only grows (167 files, 241 MB today), and a scan
that rereads all of it gets slower every week.

**Stopgap, applied 2026-10-03:** `cleanupPeriodDays: 3650` in this machine's
`~/.claude/settings.json`. It stops the loss for now, but it is one setting on
one machine. It can be reverted without anyone noticing, and it records no
trend. It buys time for this PRD; it doesn't replace it.

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                             | Priority |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | An issue's spend on the Usage page doesn't decrease when a transcript it was read from is deleted from disk.                                                                            | Must     |
| R2  | Turns added to a transcript after an earlier scan (a session still running, or resumed) are counted by the next scan, and no turn is ever counted twice, however often Scan is pressed. | Must     |
| R3  | The page and `bun run tokens` report the same figures for every issue, including issues whose transcripts are gone.                                                                     | Must     |
| R4  | The stored history lives only on this machine, outside git. No commit, CI artefact or production build contains it.                                                                     | Must     |
| R5  | `/__dev/usage` still opens and scans with the API and Postgres down.                                                                                                                    | Must     |
| R6  | The page charts forecast accuracy and the p25 / median / p75 of actual output tokens over time, with one point per calendar day on which a scan was taken (that day's last scan).       | Must     |
| R7  | Every verdict on the page is judged against the current bands. Each trend point shows the band edges that were in force on its day.                                                     | Must     |
| R8  | The page states the earliest date its history covers, so an issue with no spend before that date reads as "not recorded", not as zero.                                                  | Must     |
| R9  | With the stored history deleted, the next scan rebuilds it from the transcripts still on disk without error. Only the history of transcripts already pruned is lost.                    | Should   |
| R10 | With the stored history unreadable, a scan still reports what the transcripts on disk show, plus a warning that names the store as the source that failed.                              | Should   |
| R11 | A correction to how spend is counted or attributed (as #413 and #253 were) changes the stored history's figures too, including for transcripts no longer on disk.                       | Should   |

### Non-goals

- **One issue's spend over time.** The trend covers the population: accuracy
  and percentiles. How a single issue grew across scans is closer to the
  per-session drill-down the first Usage PRD declined.
- **Recovering spend from before 2026-09-02.** No copy exists. History starts
  from what is on disk when this lands (R8 says so on the page).
- **Sharing history across machines or committing it.** It has the same reach
  as the transcripts it is read from: one developer, one machine.
- **A point per press of Scan.** Several presses in one hour would produce
  near-identical points and make a day look like several days.
- **A dollar figure.** Still declined for the reason the first Usage PRD gave.

## Constraints

- **This reverses a documented decision.** `UsageReport` in
  `apps/web/src/dev/usage-protocol.ts` says the dev server "caches nothing" and
  "a held copy is the one thing this page must not serve". The first Usage
  PRD lists "History across runs" as a non-goal. Both assumed the transcripts
  stay on disk. The measurement above shows they don't. The reversal should be
  recorded as an ADR, and that comment rewritten, in the same change that adds
  the store, so the code and the ADR never disagree.
- `/__dev` reaches neither the API nor Postgres (`DevRoutes.tsx`), so the
  history can't live in the application database. The request names a local
  SQLite file, which fits this constraint, and `*.sqlite` is already gitignored.
- The dev-tools backend exists only under `vite dev` (`apply: "serve"`), so
  nothing here may produce a production artefact.
- Both readers run under Bun: `vite` is started with `bunx --bun`, and
  `bun run tokens` is a Bun script.
- Forecast bands are measured in **output tokens**, and an issue is a GitHub
  work item, never a _ticket_. Both carry over from the first Usage PRD.

## Risks

| Risk                                                                                              | Impact                                                                      | Mitigation                                                                       |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A growing transcript is counted again on every scan                                               | Spend inflates silently; every verdict drifts toward "over"                 | R2, plus a test that scans one transcript twice and appends to it in between     |
| The rules for counting or attributing spend change (as #413 and #253 did) after history is stored | Stored figures follow old rules and live figures follow new ones; R3 breaks | R11. #413 is the case that already happened once: it halved every figure         |
| The stopgap makes this look unnecessary                                                           | The PRD stalls and the setting is later reverted                            | Stated in Success metrics. The trend (R6) is something the setting can't provide |
| Vitest runs the dev modules under Node, where a Bun-only database module doesn't load             | The store can't be unit tested the way `usage.ts` is today                  | Open question below, for the plan                                                |

## Open questions

- [ ] How is the store exercised in tests, given vitest runs on Node and both
      real readers run on Bun? — needs the plan
- [ ] **Assumed:** a "day" for R6 is the developer's local calendar day, not
      UTC. Confirm with the developer
- [ ] **Assumed:** the band edges are the `forecast/S|M|L` thresholds the
      script already uses. A trend point records them so that a later move is
      visible, but this PRD doesn't decide how bands get moved
- [ ] **Assumed:** `forecast/XL` stays as the first Usage PRD left it (an open
      question there, and out of scope here)
