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

The responses come from two places under the project's transcript directory:
the top-level `~/.claude/projects/<slug>/*.jsonl`, and since #431 each
session's subagent transcripts at
`~/.claude/projects/<slug>/<session>/subagents/*.jsonl`. A subagent's records
carry the branch it ran on, so they join issues the same way. Before #431 they
went unread: 1.29M output tokens across 218 files on 2026-10-06, 1.21M of it
on issue branches. A history stored before then gains those rows on its next
scan, through the same per-id dedupe.

Subagent records changed what the dedupe keeps. A subagent transcript writes a
response's first record with a partial `output_tokens` and its last with the
final count; top-level records never differ. So a read keeps the largest count
per id, and a row already stored takes a larger count when a later scan or push
brings one, rather than staying as it was. That's still an input: the
response's own count, not anything derived from it.

For a record with no id, the file name in its key is the path below the
directory (`<session>/subagents/agent-<id>.jsonl`), so a top-level row keeps
the key it was stored under.

Not kept: the issue a branch names, whether a turn counts as unattributed, any
per-issue sum. `tallySpend` decides all of those on every read. Two corrections
have already changed those rules after the fact. #413 found every response
counted once per content block (2.32x overall), and #253 began totalling work
on `main`. Per-issue totals stored before either fix would have stayed wrong for
good once their transcripts were gone. Stored responses are re-read under the
fixed rule (R11), and `usage-store.test.ts` holds that by changing the rule over
rows whose transcript is deleted.

## Where it lives, and when it is open

- **`~/.claude-usage-history/<project-slug>.sqlite`**, keyed on the slug of the
  main worktree's root, so every worktree of a clone shares one history (#423).
  It was keyed on the working directory's slug, as the transcript directory
  still is, which gave each worktree a history of its own and let a deleted
  worktree take the only reader of its spend with it. When git can't answer it
  falls back to the working directory's slug. A file a linked worktree wrote
  under the old key isn't merged in. The history shipped (#417) the same day
  as #423, and the one machine that had scanned with it held no history file
  at all. On another machine, such a file is left where it is and is no
  longer read. `USAGE_HISTORY_FILE` is the override (the
  third seam beside `CLAUDE_TRANSCRIPT_DIR` and `GH_ISSUES_FILE`). Outside the
  repository, so no commit, CI artefact or build can contain it. Outside
  `~/.claude`, so the cleanup it outlives never touches it.
- **Opened per request (a scan, a push or the stored reading), closed before the response.** A handle held across
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

## Railway's develop history is fed by pushes (#428)

Railway's `develop` environment serves `/__dev/usage` from the dev server, but
the transcripts are on the developer's laptop, so a scan there reads none. Its
store is filled by `bun run tokens --push <url>` instead: the laptop sends its
stored `response` rows and its issue listing, and the server inserts the rows
with the same per-id dedupe a local scan uses. The store's file is on a
Railway volume (`USAGE_HISTORY_FILE`), so it survives a redeploy.

This keeps the rule above rather than bending it. What crosses the network is
the rows, the six fields this ADR says are kept, and nothing derived from them,
so develop's figures are still tallied on every read under the code it is
running. No message text, prompt or path is sent: the wire schema is strict at
both ends. Develop's trend points are its own, one per day a push was followed
by a scan there. The laptop's points aren't sent, because a past day's point is
a record of what that machine said that day.

## The page opens on what is stored (#432)

Until #432 the page held its reading only in the Scan mutation, so leaving
the page, reloading it, or a phone discarding its tab opened it empty again.
Once develop's figures came from pushes, that meant pressing Scan to see
figures that were already stored and hadn't changed. So `/__devtools/usage`
gained a `GET`: `readStoredUsage` in `apps/web/dev/usage.ts` computes the same
report from the store's rows and trend, opening the file read only. It reads
no transcript, runs no `gh` and writes nothing. `POST` is still the Scan
button.

This keeps the rule above. The `GET` stores no answer. It tallies the stored
rows on every request, under the code's current rules, the same way a scan
does. Measured on this machine's history (14,352 rows), it takes 32-45ms on
Bun.

To name the same titles and bands as the last scan, the stored reading needs
that scan's issue listing, and the listing is an input like the rows. Each
scan with a history keeps it in a one-row `listing` table: `gh`'s JSON in the
shape `toGhListing` writes, or the warning that said why there was none. When
`GH_ISSUES_FILE` is set, the `GET` reads that file instead. That's how
Railway's develop runs, where a push rewrites the file without a scan.

The reading is dated by a one-row `stamp` table: when rows last arrived, by
a scan (its `gatheredAt`) or a push. That's bookkeeping about the store, like
a cursor, and it's what the page's "Stored at" names.

The alternatives were the other two answers to "the page forgets":

- **Keep the last reading in react-query.** Rejected: it doesn't survive a
  reload or a discarded tab.
- **Store the last report.** Rejected: it's the one thing this ADR rules out.

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
- Since #432 `UsageReport.transcripts` is nullable: null marks the stored
  reading, which counts no transcript. A history no scan has touched since
  #432 has no `listing` table, and its stored reading names every title and
  band as unknown, with a warning that says to press Scan.
- Every E2E run that scans has to point `USAGE_HISTORY_FILE` somewhere
  disposable. `resetTranscriptWorkingCopy` removes it alongside the working
  copy, and the guardrail passes it to the `bun run tokens` it spawns.
  Otherwise a fixture scan writes fixture spend into the developer's real
  history.
