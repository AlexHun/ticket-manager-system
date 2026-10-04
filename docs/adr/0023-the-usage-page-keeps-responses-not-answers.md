# The Usage page keeps responses, not answers

**The dev server now keeps what a Usage scan read**: every API response a scan
finds is stored in a local SQLite file, and every reading is tallied over
everything stored. **It still keeps no answer**: no row, no total, no report.
(Since #419 it keeps one kind, a day's trend point: see "The trend" below.)
This reverses the rule `UsageReport` stated from the first Usage slice (#248)
until [#417](https://github.com/AlexHun/ticket-manager-system/issues/417): "the
middleware caches nothing", and "a held copy is the one thing this page must
not serve". It also lifts the first Usage PRD's "History across runs" non-goal
(`docs/prd/dev-tools-usage-page.md`).

## Why the old rule stopped holding

It assumed the transcripts stay on disk, and they don't. Claude Code deletes
them after 30 days. On 2026-10-03 the oldest of the 167 on this machine dated
from 2026-09-02, so every issue worked before then already read as unstarted,
and another day of history went each day (`docs/prd/usage-history.md`). A page
that only re-reads the disk reports less spend for the same issue every week.
Nothing about the work has changed, so that's a wrong answer, and the
"cached copy" the old rule guarded against would at least have kept the spend.

The old rule's real claim survives: the figures on screen were computed at
`gatheredAt` by the rules the code holds _now_. That's why the store keeps
inputs and not outputs.

## What is kept, and what is not

**One row per API response**: its identity (`message.id`, then the record's
`uuid`, then file name and line number), session, branch, timestamp, output and
cache-read tokens. That's `TranscriptResponse` in `apps/web/dev/transcripts.ts`,
stored by `apps/web/dev/usage-store.ts`.

Not kept: the issue a branch names, whether a turn counts as unattributed, any
per-issue sum. `tallySpend` decides all of those on every read. Two corrections
have already changed those rules after the fact. #413 found every response
counted once per content block (2.32x overall), and #253 began totalling work
on `main`. Per-issue totals stored before either fix would have stayed wrong for
good once their transcripts were gone. Stored responses are re-read under the
fixed rule (R11), and `usage-store.test.ts` holds that by changing the rule over
rows whose transcript is deleted.

## Where it lives, and when it is open

- **`~/.claude-usage-history/<project-slug>.sqlite`**, keyed on the slug the
  transcript directory uses, with `USAGE_HISTORY_FILE` as the override (the
  third seam beside `CLAUDE_TRANSCRIPT_DIR` and `GH_ISSUES_FILE`). Outside the
  repository, so no commit, CI artefact or build can contain it. Outside
  `~/.claude`, so the cleanup it outlives never touches it.
- **Opened per scan, closed before the response.** A handle held across
  requests would stop a spec, or the developer, from deleting the file on
  Windows. A scan takes seconds, so there's nothing worth keeping a handle for.
- **Either runtime's SQLite.** The developer's dev server and `bun run tokens`
  run on Bun, which can't resolve `node:sqlite` (1.3.13, measured). Vitest and
  the E2E's dev server (`bunx vite`, without `--bun`; see `playwright.config.ts`)
  run on Node, which can't load `bun:sqlite`. The store talks to a narrow
  `SqlDatabase` surface that both satisfy, and `openUsageStore` imports
  whichever one the running process has. The plan had expected only Bun
  processes to open the real file. That turned out wrong for the E2E server,
  and the runtime check covers both.

## The trend: the one answer kept (#419)

Slice 3 adds a `trend_point` table beside the responses: one row per local
calendar day on which a scan was taken, holding that day's quartiles of output
tokens, its accuracy tally (`onTarget` of `scored`), and the band edges the
code held. The day's last scan replaces its row. That's a stored answer, and
it's kept on purpose: a past day can't be asked again. The forecast labels `gh`
reported and the band edges in force are gone by the next day, and the trend
exists to show those moving.

What it doesn't change:

- **Spend and a tally, never a verdict.** No row's verdict is stored, so every
  verdict on the page is still judged against today's bands (R7).
- **Today's point is the panels.** It's computed by `trendPointFor` in
  `apps/web/src/dev/usage-readings.ts` with the same `recordedSpend`,
  `percentiles` and `forecastAccuracy` the distribution and accuracy panels
  call, over the same rows, so the two can't disagree.
- **A correction still reaches every figure that is computed per reading.** A
  past day's point is the one figure that keeps the rules it was taken under.
  That's correct for a record of what a day said, and it's why the point carries
  its band edges.

Two consequences of writing the point inside `gatherUsage`, the one door:

- **`bun run tokens` writes it too.** It's a scan over the same history, so
  it's a scan the day's point can come from, and the page and the terminal
  still can't disagree about it.
- **A degraded scan still replaces the day's point.** A scan without `gh` has
  nothing to score, so its point shows a gap where a good scan earlier that day
  had a figure. That's the "last scan of a day" rule taken literally. If it
  bites, the fix is a rule about which scans may replace a point, not a
  different key.

## Considered options

**Per-issue totals per scan.** Smaller, and enough for a trend. Rejected
because counting and attribution would be frozen at scan time, which is
exactly what #413 showed can be wrong.

**The application database.** Rejected: `/__dev` reaches neither the API nor
Postgres (`DevRoutes.tsx`), and R5 requires the page to scan with both down.

**Raising `cleanupPeriodDays` and keeping no store.** It's the stopgap in place
since 2026-10-03, and it's one setting on one machine that can be reverted
without anyone noticing. It also records no trend, and slice 3 needs one.

## Consequences

- `UsageReport` gains `historySince`, the earliest stored timestamp, and the
  page states it beside the reading (R8), so a gap before it reads as "not
  recorded" rather than zero.
- `gatherUsage` takes the history file as an optional third argument. The plugin
  and `bun run tokens` both pass the same resolved file, which keeps them in
  agreement (R3). Unit tests about the join pass none and see only what's on
  disk.
- Since #419 `gatherUsage` also takes a clock as a fourth argument, which stamps
  both `gatheredAt` and the day's trend point, so a unit test can move a day.
  `UsageReport` gains `trend`, every stored point oldest first.
- Since #420 a store that can't be read costs a warning, not the scan. The
  reading is then the transcripts on disk alone, read whole, beside a warning
  whose source is `USAGE_WARNING_SOURCE.history`. Nothing replaces the
  damaged file; the developer moves or deletes it. A deleted store needs nothing:
  the next scan creates a fresh one from the transcripts still on disk, so only
  the history of transcripts already pruned is lost (R9, R10).
- Every E2E run that scans has to point `USAGE_HISTORY_FILE` somewhere
  disposable. `resetTranscriptWorkingCopy` removes it alongside the working
  copy, and the guardrail passes it to the `bun run tokens` it spawns.
  Otherwise a fixture scan writes fixture spend into the developer's real
  history.
