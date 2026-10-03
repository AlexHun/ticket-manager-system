# Plan: Usage history

**PRD:** [docs/prd/usage-history.md](../prd/usage-history.md) · **Status:** Draft · **Date:** 2026-10-03

## Layers crossed

```
web (src/dev/UsagePage.tsx + a new trend card; useUsageScan, unchanged)
  → dev middleware (dev/plugin.ts → POST /__devtools/usage, apply: "serve")
    → wire contract (src/dev/usage-protocol.ts — UsageReport gains history fields)
      → join (dev/usage.ts gatherUsage — the one door, shared with `bun run tokens`)
        → scan (dev/transcripts.ts — today reads every file, holds nothing)
          → new: store (dev/usage-store.ts) over a local SQLite file
```

There's no API, Postgres, `@ticket/core` or queue. `/__dev` reaches none of
them (PRD constraint), and `bun run tokens` reaches the store through the same
`gatherUsage` the page uses.

**Measured facts the slices rest on** (2026-10-03, this machine):

- **Bun 1.3.13 can't resolve `node:sqlite`** ("Could not resolve"), though
  Bun's current docs list it as implemented. Node 24.11 loads it, with an
  `ExperimentalWarning`. The dev server and `bun run tokens` run on Bun;
  vitest, which runs `apps/web/dev/*.test.ts`, runs on Node. So no single
  SQLite module loads in both places.
- **Both `bun:sqlite`'s `Database` and `node:sqlite`'s `DatabaseSync` offer
  `exec(sql)` and `prepare(sql)` → `run`/`get`/`all`** with positional
  parameters. The one difference that matters: `get` with no row returns
  `null` in Bun and `undefined` in Node.
- `apps/web` declares no Bun types, so `import "bun:sqlite"` doesn't typecheck
  there today.
- The E2E transcript fixtures carry no `message.id` (#414's README note), so a
  record's identity can't rest on `message.id` alone.

## Slice 1 — Scan writes, page reads history

**Retires:** the runtime split above, an open SQLite file colliding with Windows
file locks, and whether the E2E can delete a transcript and see its spend survive.
**Covers:** R1, R3, R4, R5, R8, R11

- A developer presses Scan, deletes a transcript, presses Scan again, and the
  issue's spend is unchanged. The page says from which date its history runs.

Shape:

- `dev/usage-store.ts` talks to a narrow `SqlDatabase` interface: `exec`, and
  `prepare` returning statements with `run`/`get`/`all`, with `get` normalised
  to `undefined`. One opener
  passes it `bun:sqlite`, and only the Bun processes load that opener. The
  vitest suites pass `node:sqlite` in. Types come from a minimal ambient
  declaration of the `bun:sqlite` surface used. **Adding `@types/bun` instead
  is a new dependency, and per `conventions.md` the ticket asks first.**
- **The store holds one row per response, not per-issue totals.** That row has
  the record identity, session, branch, timestamp, output and cache-read
  tokens. Identity is `message.id`, falling back to `uuid`, then to the file
  name plus line number. Attribution (branch → issue, `main` → unattributed)
  and counting stay in code and run over the rows on every read. That's what
  makes R11 true: a future #413-style fix applies to rows whose transcript is
  gone.
- The file lives outside the repo and outside `~/.claude`:
  `~/.claude-usage-history/<project-slug>.sqlite`, using the same slug
  `resolveTranscriptDir` derives. Being outside the repo means every worktree
  and clone of this repo shares one history (R4). Being outside `~/.claude`
  means Claude Code's own cleanup, the thing this feature outlives, never
  touches it. `USAGE_HISTORY_FILE` overrides it, the third seam
  beside `CLAUDE_TRANSCRIPT_DIR` and `GH_ISSUES_FILE`.
- **The store is opened per scan and closed before the response.** That's
  scans, not a server lifetime: a scan is seconds per press, and a handle held
  open across requests would stop a spec (or a developer) from deleting or
  replacing the file on Windows.
- An ADR records reversing "caches nothing" (PRD constraint). The comments on
  `UsageReport`, in `docs/standards/frontend.md`'s Usage bullet and in
  `dev-tools-usage-page.md`'s non-goal are rewritten in the same commit.
- `UsageReport` gains `historySince` (the earliest stored timestamp), shown
  beside `Gathered`.

**Hardcoded for now:**

- every scan re-reads every transcript in full and upserts every row (correct
  thanks to the identity key, just not faster)
- no trend points
- a store that can't be opened throws, the way an unreadable transcript
  directory doesn't

**E2E:** `tests/e2e/dev-usage-history.spec.ts`. `playwright.config.ts` points
`CLAUDE_TRANSCRIPT_DIR` at a gitignored working copy of the fixture directory
and `USAGE_HISTORY_FILE` at a gitignored path. The spec copies the fixtures in
and removes the store before its first scan (the `gh-issues.local.json`
pattern). Assertions: scan, delete one fixture transcript, scan again, and that
issue's row still shows its README total; the page names the history's start
date. `dev-usage.spec.ts` and `dev-usage-guardrail.spec.ts` keep passing
unedited. Repeated scans of an unchanged directory change no figure, which
holds R2's "never twice" half from the first slice.

## Slice 2 — Read only what's new

**Retires:** whether an appended transcript is read correctly from where the
last scan stopped, including a partly written last line.
**Covers:** R2, and the PRD's scan-time guardrail
**Un-hardcodes:** the full re-read

- A transcript that grew since the last scan contributes exactly its new turns.
  An unchanged directory is mostly skipped, so a scan no longer gets slower as
  files pile up.
- The store remembers per file how far it has read (byte offset and size). It
  reads from there, and a trailing line without its newline is left for the
  next scan rather than skipped for good. A file that shrank or was replaced is
  read from the start, and the identity key absorbs the overlap.
- The PR states `scanMs` before and after on this machine, as #414 did for its
  figures.

**E2E:** extends slice 1's spec. Append two records (one a second content block
of a response already stored) to a working-copy transcript, then scan. The row
grows by exactly the new response, and `bun run tokens` against the same two
seams reports the same row (R3).

## Slice 3 — The trend

**Retires:** what a day's point holds, and drawing it with the page's existing
chart conventions.
**Covers:** R6, R7
**Un-hardcodes:** no trend points

- The page shows forecast accuracy and the p25 / median / p75 over time, one
  point per local calendar day with a scan (the last scan of the day replaces
  that day's point). Each point carries the band edges in force that day.
- The point is written from the same `recordedSpend`/quartile arithmetic the
  page's panels use (`src/dev/usage-readings.ts`), so a point and the panels
  can't disagree for today.
- Verdicts stay computed from current bands, because only spend is stored.

**E2E:** extends the spec. After a scan, the trend has one point, its quartiles
and accuracy match the distribution and accuracy panels, and a second scan the
same day still leaves one point. The day boundary and the replace-not-append
rule are a vitest case with an injected clock, since Playwright can't move a
day.

## Slice 4 — A broken store costs a warning, not the page

**Retires:** the failure modes of a file the developer can delete or damage.
**Covers:** R9, R10
**Un-hardcodes:** the store that throws

- With the store file deleted, the next scan rebuilds it from the transcripts on
  disk. With it unreadable, the scan reports the live figures and a warning
  whose `source` is a new `USAGE_WARNING_SOURCE.history`. That's a third
  source, and it earns its place where #289's argument against a third value
  didn't: it's a different file that fails independently. `bun run tokens`
  words its own sentence for it, as it does for `transcripts`.

**E2E:** extends the spec. Overwrite the store file with junk, scan, see the
warning and the live figures; delete it, scan, see the history start date reset.

## Requirement coverage

| Req | Slice | Note                                                                   |
| --- | ----- | ---------------------------------------------------------------------- |
| R1  | 1     |                                                                        |
| R2  | 1, 2  | "Never twice" from slice 1's identity key; "appended turns" in slice 2 |
| R3  | 1, 2  | Holds by construction through `gatherUsage`; slice 2's E2E checks it   |
| R4  | 1     | Home-directory file plus `USAGE_HISTORY_FILE`                          |
| R5  | 1     | No new dependency on the API or Postgres                               |
| R6  | 3     |                                                                        |
| R7  | 3     |                                                                        |
| R8  | 1     | `historySince`                                                         |
| R9  | 4     |                                                                        |
| R10 | 4     |                                                                        |
| R11 | 1     | Per-response rows, with attribution recomputed on read; a vitest case  |

## Spikes

- **Upgrade Bun so `node:sqlite` works everywhere?** If a newer Bun resolves
  it, one module serves the dev server, `bun run tokens` and vitest, and slice
  1's opener seam shrinks to nothing. But it's a repo-wide runtime bump (CI's
  `BUN_VERSION`, the API's `bun test`, the Dockerfiles), so it doesn't block
  anything here. Timebox 1h, worth its own ticket if it pays.

## Deferred

- **One issue's spend over time**, **pre-2026-09-02 backfill**, **sharing
  history across machines**, **a point per press**, **a dollar figure**: the
  PRD's non-goals, unchanged.
- **Re-measuring the band edges and "~745 per turn"** in
  `docs/agents/issue-tracker.md` on the corrected figures. #413 left this out
  of scope on purpose. It's a decision this feature makes visible (slice 3's
  trend shows the edges against the quartiles), not one it makes.
- **Recording the forecast an issue carried when work started.** It was raised
  in conversation and isn't in the PRD.
