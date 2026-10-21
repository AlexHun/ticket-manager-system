# Transcript fixture

Two Claude Code sessions, in the JSONL shape `apps/web/dev/transcripts.ts`
reads, and three subagent transcripts one of them started (#589).
`tests/e2e/dev-usage.spec.ts` points `CLAUDE_TRANSCRIPT_DIR` at a copy of this
directory (`transcripts.local`, via `playwright.config.ts`) so the Usage
page has figures an assertion can be written against — a real machine's spend
is not something a test can name. The specs remake that copy before they scan,
and are free to change it; these files are never written to.

What the five transcripts add up to, and why each line is here:

| Issue  | Output tokens                                       | Turns | Sessions | Cache read                                                 |
| ------ | --------------------------------------------------- | ----- | -------- | ---------------------------------------------------------- |
| `#101` | 12,000 + 8,000 + 5,000 + 3,000 + 4,000 = **32,000** | 5     | 1        | 300,000 + 100,000 + 60,000 + 70,000 + 30,000 = **560,000** |
| `#102` | **3,000**                                           | 1     | 1        | **20,000**                                                 |
| `#105` | **90,000**                                          | 1     | 1        | **250,000**                                                |

The last three terms of `#101` are its subagents', below. They stay one
session because a subagent's records carry its parent's `sessionId`.

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

No line of the two sessions carries a `message.id`, so each counts as one turn
on its own. Since #413 the scan collapses records sharing an id — Claude Code
writes one API response as one record per content block — onto one turn; that
rule is held by `apps/web/dev/usage.test.ts`, and the subagent transcripts
below are the one place these figures depend on it.

## The subagent tree

`session-a/subagents/` is where Claude Code keeps the subagents session `a`
started, each an `agent-<id>.jsonl` transcript beside an `agent-<id>.meta.json`
in the shape a real one has (read off this machine's transcripts, 2026-10-20).
Every record is on `feat/101-a`, so all of it is `#101`'s:

| Agent               | Started by                                          | Meta file                                                             | Output tokens                        |
| ------------------- | --------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| `a1111111111111111` | session `a`, `toolu_fixture_review` on its 4th line | `general-purpose`, "Review the fixture", depth 1, `finished`          | 5,000 + 3,000 = **8,000**, two turns |
| `a2222222222222222` | `a1111…`, `toolu_fixture_nested` on its 4th line    | `Explore`, "Find the fixture's specs", depth 2, `parentAgentId` named | **4,000**, one turn                  |
| `a3333333333333333` | —                                                   | **unparseable**: cut off mid-key, on purpose                          | none: a prompt, no response          |

The first agent's first response, `msg_fixture_review_1`, is written twice: a
partial **25** output tokens on its text block, then the final **5,000** on its
tool call, as real subagent transcripts write them (#431). The scan keeps the
largest count per id, so it reads 5,000. Keeping the first would read `#101` as
27,025, and summing both as 32,025.

The second agent's meta has no `finished`, so it reads as still running beside
a finished parent, as the one nested meta on this machine did. The third
agent's meta is the file a reader must warn about rather than drop silently;
its transcript holds only the prompt, so it moves no figure.

The scan counts all three subagent transcripts, which is why the page reads
**5 transcripts**. A spec that deletes session `a` deletes `session-a/` with
it, as Claude Code's cleanup would, or `#101` keeps the subagents' 12,000.

Every complete line carries a `timestamp`, which no figure above reads: it is
what the usage history's start date is taken from (#417). The earliest is
**2026-09-02T09:00:00.000Z**, on the first two lines of `session-a.jsonl`, and
`dev-usage-history.spec.ts` asserts the page names it.

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
- **The quartiles are p25 3,000 · median 32,000 · p75 90,000.** Nearest-rank
  over the three recorded totals sorted — 3,000, 32,000, 90,000 — puts p25 on
  the first, the median on the second and p75 on the third. #274 moved only p75:
  with two values it sat on 20,000 alongside the median. The two lower marks
  still share band `S`, which keeps the grouped-label case the chart draws them
  with; p75 sits alone in `M`, so the fixture exercises both arrangements.
- **Three issues with recorded spend**, where it was two.

An over-budget row cannot be anything but the largest figure here — `over`
against `forecast/S` means at least 60,000 output tokens — so `#105` also sorts
_first_ under the table's default ranking. Every ordering assertion in the spec
counts it.

**The subagent tree (#589) moved `#101`'s row and the median, and nothing
else.** `#101` went from 20,000 to 32,000 output tokens, 2 to 5 turns and
400,000 to 560,000 cache read, and the median with it from 20,000 to 32,000.
32,000 is still under `S`'s 60,000, so the verdict, the 1/2 accuracy, the band
the two lower quartiles share and every ordering by output tokens stand; `#101`
already had the most turns, so the ordering by turns stands too. The transcript
count went from 2 to 5. The specs' literals moved in the same commit as this
file.

Change a number here and `dev-usage.spec.ts` goes red, which is the point: the
spec states these totals as literals rather than recomputing them with the code
under test.

## What the Sessions page makes of them

`tests/e2e/dev-sessions.spec.ts` reads the same working copy through
`/__dev/sessions` (#590). Two lines are here for it alone, and neither moves a
figure above:

- the first line of `session-a.jsonl` is its prompt, "Implement issue #101.",
  which is the session's task. It carries no `usage`, so the Usage scan skips
  it, and the same timestamp as the line after it, so the history's start date
  stands;
- the last line of `session-b.jsonl` ends its turn (`stop_reason: "end_turn"`),
  so session `b` reads Done. Session `a` ends on no such line, and its nested
  subagent is still running, so it reads Running.

A session's card is named for its transcript (`session-a`), a subagent's for
its `agentId`. A card's output tokens are its own transcript's, whatever branch each line
ran on, and its elapsed time runs from its transcript's first timestamp to its
latest:

| Card                | Type              | Model              | State   | Elapsed  | Output tokens                               |
| ------------------- | ----------------- | ------------------ | ------- | -------- | ------------------------------------------- |
| `session-b`         | Session           | unknown            | Done    | `5m 0s`  | 3,000 + 90,000 = **93,000**                 |
| `session-a`         | Session           | `claude-opus-5-5`  | Running | `15m 0s` | 12,000 + 5,000 + 8,000 + 7,000 = **32,000** |
| `a1111111111111111` | `general-purpose` | `claude-opus-5-5`  | Done    | `1m 55s` | **8,000**                                   |
| `a2222222222222222` | `Explore`         | `claude-haiku-5-5` | Running | `55s`    | **4,000**                                   |

Session `b` is listed first, being the more recently started. Session `b` has
no prompt, so its task reads "No prompt recorded". `a3333333333333333`'s meta
file is the warning, and it has no card.

The Running states above hold only while the working copy's files are fresh:
a card that is not Done reads Stopped once its files have gone unwritten for
`SESSION_IDLE_MS` (#591). `resetTranscriptWorkingCopy` stamps every copied
file with the current time for that reason. The spec's live cases (#591)
write to the working copy at run time and never to these files: a response
of 1,000 output tokens appended to `session-a.jsonl` (32,000 → 33,000), one
of 500 whose call starts a new subagent (33,500), and that subagent's own 600.
