# PRD: Dev-tools Sessions page

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-10-19

## Problem

A `/chain` runs a conductor session that starts one worker subagent per issue,
and each worker starts its own (review agents, Explore, bulk-reader). While it
runs, the only view of what is happening is the terminal: which worker is on
which issue, which step of `implement` it has reached, what comes next, and
whether anything is stuck waiting on a permission answer. A worker waiting on
the developer looks the same as one working, so time is lost to waits nobody
saw. Spend arrives afterwards: the Usage page totals an issue, but not which
subagent spent it, and the `Usage:` comment `chain` posts records context size,
not output tokens per subagent.

## Users

The developer working in this repository, not `admin` or `agent`. Like Map,
Tests and Usage, the page lives under `/__dev`, outside `ProtectedRoute` and the
role system. The jobs: watch a chain while it runs and catch a stuck subagent
early, and read afterwards how many output tokens each subagent and each issue
cost.

## Success metrics

| Metric                                                                                | Today                                         | Target                           |
| ------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------- |
| **Time from a subagent starting to wait on the developer to the developer seeing it** | unknown: noticed only by reading the terminal | TBD, needs Aleksei               |
| Issues whose output-token total here differs from the Usage page's                    | n/a                                           | 0 (guardrail)                    |
| Subagents in a session with no output-token figure of their own                       | all of them: no surface shows one             | 0 for sessions with a transcript |

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                                                                                            | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| R1  | A developer can open a Sessions page from the dev tools and see this repository's Claude Code sessions on this machine, each as a tree of the session and every subagent under it, to any depth, without the API or the database running.              | Must     |
| R2  | Each card shows the task it was given, its subagent type, its model, its state (Running, Waiting for you, Done or Stopped), its elapsed time and its own output tokens.                                                                                | Must     |
| R3  | Each card with children also shows the output tokens of itself and everything under it, and its children can be collapsed.                                                                                                                             | Must     |
| R4  | While a session runs, a newly started subagent, a change of state and new tokens show on the open page within 5 seconds, without a reload.                                                                                                             | Must     |
| R5  | A session or subagent waiting on a permission answer or on the developer's input shows Waiting for you within 5 seconds, the page header counts how many are waiting, and the state clears once answered.                                              | Must     |
| R6  | Sessions are grouped by the issue their branch names, each issue showing its total output tokens and a link to it on `AlexHun/ticket-manager-system`; work on `develop` or `main` is its own group, never counted toward an issue.                     | Must     |
| R7  | An issue's output-token total on this page equals the Usage page's and `bun run tokens`'s for the same issue.                                                                                                                                          | Must     |
| R8  | For a running `/chain`, the page lists the chain's issues in the order the chain works them, each marked merged, in progress, next, waiting or blocked, with the worker's name on the one in progress.                                                 | Must     |
| R9  | A worker running `implement` shows the step it has reached: read the ticket, branch, standards, build, commit, review, ship or CI.                                                                                                                     | Should   |
| R10 | Each card shows which tools it has called.                                                                                                                                                                                                             | Should   |
| R11 | A session whose transcript has stopped growing without ending reads as Stopped, not Running, after a stated idle time.                                                                                                                                 | Should   |
| R12 | Wherever this feature reads, writes or displays them, Claude Code's workers are called _sessions_ and _subagents_, and their progress _state_ and _step_, never _agent_, _run_, _status_, _stage_ or _handoff_, which `GLOSSARY.md` gives to the desk. | Must     |

### Non-goals

- **A dollar figure.** Output tokens, as on the Usage page, for that PRD's
  reason: a USD column needs a price list that goes stale.
- **Controlling anything from the page.** No approving a permission, stopping
  a subagent or starting a chain. The page reads; the terminal acts.
- **Other projects on this machine.** This repository's sessions only. A
  machine-wide view is a separate tool, not a page in this repo.
- **Railway's `develop`.** It holds pushed usage rows and no transcripts
  (ADR-0023), so it has nothing live to show.
- **Reading prompts and replies.** A card shows the task it was given, not the
  conversation. A transcript viewer is its own feature.
- **History past the transcripts.** The page shows what is on disk. The Usage
  history keeps spend after Claude Code deletes a transcript, but not the
  tree, so a deleted session drops off this page.
- **The desk's own AI.** Classification, auto-reply, summaries and polish are
  single model calls on the pipeline, not trees of subagents, and would need an
  admin page backed by Postgres.

## Constraints

- `/__dev` reaches neither the API nor Postgres (`DevRoutes.tsx`), and the
  dev-tools backend exists only under `vite dev`. Nothing here may produce a
  production artefact.
- R7 means one implementation of the transcript-to-issue join, the one the
  Usage page and `bun run tokens` already share, including its dedupe that
  keeps the largest output count per response (ADR-0023).
- R5 needs a hook in the committed `settings.json`, so it runs in every clone
  and session. Like `push-usage.mjs`, it must never block or slow the session
  it fires in, and must do nothing outside this machine.
- `GLOSSARY.md` gives _Agent_, _Run_, _Status_, _Stage_ and _Handoff_ to the
  desk (R12).

## Risks

| Risk                                                                                                              | Impact                                                 | Mitigation                                                                        |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| The transcript layout (`subagents/*.jsonl`, `.meta.json`) is undocumented and changes across Claude Code versions | The tree breaks after an update with no warning        | A layout the page can't read shows a warning naming the file, never an empty page |
| A session writes no transcript (session `6732eb5d`, #522)                                                         | That chain is invisible here and its spend is missing  | The page can't fix this; the `Usage:` issue comment stays the fallback            |
| R9's step is inferred from tool calls and drifts when `implement` is edited                                       | A wrong step reads as fact                             | Should, not Must; an unrecognised step shows as unknown rather than a guess       |
| A crashed session reads as Running forever                                                                        | The page tells the developer to wait on something dead | R11                                                                               |
| The R5 hook fires in every session of every clone                                                                 | A slow or failing hook costs every session             | The hook writes one local file and exits; it never reaches the network            |

## Open questions

- [ ] Do Claude Code's hook events say whether the session or one of its
      subagents is the one waiting, and do they fire when input is answered?
      `context7` was unreachable while this was written, so this is
      unverified. _Blocks R5._
- [ ] Where does R8's chain order come from: the chain's issue listing on
      GitHub (blocking edges and the `## Parent` slug, as `chain` step 1 reads
      it), or something the conductor records? _Affects R8 with `gh` down._
- [ ] **Assumed:** 5 seconds is fast enough for R4 and R5. Confirm with Aleksei.
- [ ] **Assumed:** R11's idle time is TBD. It needs a measurement of the
      longest quiet gap a healthy session shows (a long `gh pr checks --watch`).
- [ ] **Assumed:** a top-level session's "task" is its first prompt, cut to one
      line, since it has no `.meta.json` description.
- [ ] **Assumed:** cache-read tokens are left off the cards, as they're left
      out of the forecast comparison on the Usage page.
- [ ] **Assumed:** the page sits in the dev-tools nav beside Map, Tests and
      Usage, under the name "Sessions".
