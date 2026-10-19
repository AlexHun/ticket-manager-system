# Plan: Dev-tools Sessions page

**PRD:** [docs/prd/dev-tools-sessions-page.md](../prd/dev-tools-sessions-page.md) · **Status:** Draft · **Date:** 2026-10-19

## Layers crossed

No API, no Postgres: `/__dev` reaches neither (`DevRoutes.tsx`). The layers are
the dev tools' own.

```
web: new: apps/web/src/dev/SessionsPage.tsx, routed in DevRoutes.tsx,
     ROUTE.devSessions in apps/web/src/lib/routes.ts, the sidebar's Dev group
  → contract: new: apps/web/src/dev/sessions-protocol.ts (import-free),
              DEVTOOLS_API.sessions (+ a stream path) in devtools-paths.ts
    → node half: new: apps/web/dev/sessions.ts, registered in dev/plugin.ts
      → transcripts: apps/web/dev/transcripts.ts (listTranscripts,
                     readTranscripts, tallySpend, issueOfBranch)
        → disk: ~/.claude/projects/<slug>/*.jsonl and
                <session>/subagents/agent-<id>.jsonl + agent-<id>.meta.json
          → new: a waiting-state file written by a new hook in
                 .claude/hooks/, registered in .claude/settings.json
          → gh: one `gh issue list` call (dev/issues.ts), for chains only
```

Every slice's E2E reads `CLAUDE_TRANSCRIPT_DIR`'s fixture copy, the one the
Usage specs read. The fixture directory has no `subagents/` today, and a
subagent with output tokens on an issue branch **moves the Usage page's
figures** (#274 paid the same cost). Slice 1 adds the fixture, its
`README.md` arithmetic and the moved `dev-usage.spec.ts` constants in one
commit.

## Slice 1: one finished session's tree

**Retires:** whether `toolUseId` in `agent-<id>.meta.json` links a subagent to
the parent `Agent` call reliably enough to draw the tree, across nesting
depths. If it doesn't, the page has no shape.
**Covers:** R1, R2 (Done and Running only), R12

- A developer opens `/__dev/sessions` with the API and Postgres down and sees
  each session on disk as a card with its subagents nested under it to any
  depth. Each card shows the task, subagent type, model, Done or Running (from
  `finished`), elapsed time and its own output tokens.
- A transcript or meta file the page can't read is a warning naming the file,
  never an empty page (the PRD's first risk).
- Read on load, no live updates: a `useQuery` with a Refresh control, like Map.
- The UI text follows `copy.md`; the words come from R12's list (sessions,
  subagents, state, step).

**Hardcoded for now:** the reading is a snapshot (no stream); no Waiting for
you or Stopped; no subtree totals; no grouping by issue; no chain view; no
step; no tools.

**E2E:** new `tests/e2e/dev-sessions.spec.ts`. Against a fixture with a
session → subagent → nested subagent, the page shows three cards nested in that
order, each with the fixture's task, type, model, state and output tokens. One
meta file is unparseable, and a warning names it.

## Slice 2: the page follows a running session

**Retires:** whether a dev-server middleware can notice transcript changes and
push them within 5 seconds on Windows. The warm, append-only read with cursors
(#418, ~60ms) makes polling a candidate; the slice measures it before reaching
for a file watcher.
**Covers:** R4, R11, R2 (Stopped)
**Un-hardcodes:** the snapshot.

- With the page open, a new subagent, a new response's tokens and a change of
  state appear within 5 seconds, without a reload. The stream follows the test
  runner's SSE shape (`DEVTOOLS_API.events`).
- A session whose transcript has stopped growing without finishing reads
  Stopped once the idle time passes. The idle time is a named constant, and its
  value comes from measuring the longest quiet gap a healthy session shows (a
  `gh pr checks --watch`), recorded where the constant is declared.

**E2E:** extends the spec. It appends a response to the working copy's
transcript and writes a new subagent file, and the page shows both within 5
seconds. With the idle time overridden short for the run, a session left
unfinished reads Stopped.

## Slice 3: Waiting for you

**Retires:** the PRD's blocking question. See Spikes; the slice starts only
after the spike answers it.
**Covers:** R5, R2 (Waiting for you)
**Un-hardcodes:** the two missing states.

- A new hook in `.claude/settings.json` records, in a local file outside the
  repo, that a session or subagent is waiting on a permission answer or on
  input, and clears the record when it is answered. Like `push-usage.mjs`, it
  returns at once, never reaches the network, and is a no-op on a machine
  where it can't write.
- The card shows Waiting for you, and the header counts the waiting ones,
  within 5 seconds of the record appearing or clearing.
- The file's location has an override, a fourth seam beside
  `CLAUDE_TRANSCRIPT_DIR`, so the E2E never reads the developer's own.

**E2E:** extends the spec. Writing a waiting record for the fixture's nested
subagent turns its card to Waiting for you and the header to "1"; removing
the record clears both. The hook itself gets a test beside
`apps/api/src/push-usage-hook.test.ts`, run on a fake payload.

## Slice 4: tokens per subtree and per issue

**Retires:** R7's one-join rule against a second reader. The cards' figures
must come from the same deduped responses `tallySpend` totals (largest count
per id, #431), or the page and Usage drift apart. The first decision: how each
response is attributed to its file **without** adding a column to
`TranscriptResponse`, whose six fields are the stored row and the push's wire
(ADR-0023).
**Covers:** R3, R6, R7
**Un-hardcodes:** no subtree totals, no grouping.

- A card with children shows its own and its subtree's output tokens, and its
  children collapse.
- Sessions group under the issue their branch names, each with its total and a
  link to the issue. Work on `develop` or `main` (a `/chain` conductor runs on
  `develop`) is its own group with its own total, never counted toward an
  issue. `tallySpend` already drops `develop` and totals `main` as
  unattributed, and this slice doesn't change it.

**E2E:** extends the spec. The fixture issue's total on `/__dev/sessions`
equals its output tokens on `/__dev/usage` in the same run, read off both
pages rather than restated. The `develop` group shows its own figure.

## Slice 5: a chain's progress

**Retires:** where a chain's order comes from (the PRD's second open
question). A conductor's first prompt names `/chain <path>`, so the slug is in
the transcript. The issues come from the one `gh issue list` call `chain`
step 1 already makes (`--search "<slug> in:body"`, with `blockedBy`), ordered
by the same rule: blockers first, ties by number.
**Covers:** R8

- A session started with `/chain` shows its issues in order, each merged, in
  progress (with the worker's name from its `Agent` call), next, waiting or
  blocked.
- With `gh` unavailable, the list says the order is unknown and still shows
  the workers it can see, as the Usage page keeps its actuals without `gh`.

**E2E:** extends the spec, with a conductor fixture and a listing file through
`GH_ISSUES_FILE`'s pattern (written by the spec, never checked in): three
issues read merged, in progress (named worker) and next.

## Slice 6: the worker's step and its tools

**Retires:** whether `implement`'s step can be read off tool calls without
the page lying. An unrecognised pattern reads as unknown, never as the nearest
guess.
**Covers:** R9, R10

- A worker card shows the `implement` step reached (read the ticket, branch,
  standards, build, commit, review, ship, CI), and each card shows the tools
  it has called.
- The step rules live in one pure module with a unit test per step over
  made-up tool-call sequences, so an edit to `implement` breaks a test before
  it misleads the page.

**E2E:** extends the spec: the fixture worker that has run `gh pr create`
reads "ship", and its card lists the tools in the fixture.

## Requirement coverage

| Req | Slice   | Note                                                    |
| --- | ------- | ------------------------------------------------------- |
| R1  | 1       |                                                         |
| R2  | 1, 2, 3 | Done/Running in 1, Stopped in 2, Waiting for you in 3   |
| R3  | 4       |                                                         |
| R4  | 2       |                                                         |
| R5  | 3       | Blocked by the hook spike                               |
| R6  | 4       |                                                         |
| R7  | 4       |                                                         |
| R8  | 5       |                                                         |
| R9  | 6       | Should                                                  |
| R10 | 6       | Should                                                  |
| R11 | 2       | Should; lands with the stream, which decides the states |
| R12 | 1       | Every later slice's copy is held to it in review        |

## Spikes

- **Which hook events fire when Claude Code waits on the developer, and when
  it stops waiting?** Find out whether a `Notification` event (or a
  permission-specific one) carries which session and which subagent is
  waiting, and which event marks the answer (a `PostToolUse`, a
  `UserPromptSubmit`). Verify against the Claude Code docs through `context7`
  (unreachable while this plan was written) and one recorded payload per event.
  Timebox 2h, blocks slice 3. If only the session can be told, a subagent's
  wait shows on its session's card, and the PRD's R5 is restated to match.

## Deferred

- A dollar figure, controlling sessions from the page, other projects,
  Railway's `develop`, prompts and replies, history past the transcripts, and
  the desk's own AI: the PRD's non-goals, none of them sliced.
- Keeping trees after Claude Code deletes a transcript: the usage history
  keeps spend rows only (ADR-0023), and storing trees would be a new decision
  for that ADR.
