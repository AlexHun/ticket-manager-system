# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`, or `--body-file <file>` for a multi-line body written to a file first.
- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `(gh issue list --state open --json number,title,body,labels,comments | ConvertFrom-Json) | Select-Object number, title, body, @{n='labels';e={$_.labels.name}}, @{n='comments';e={$_.comments.body}}` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Forecasting an issue's size

An issue is sized twice, both times from one forecast: how many **turns** (API
responses) its work takes. Estimating tokens directly is estimating a number
nobody has an intuition for.

- **The split rule is peak context.** A ticket is cut so the worker that
  implements it stays under **200k tokens of context**, which is about **75
  turns in one window**. Forecast above that, split it, whatever its output
  band says.
- **The label is output tokens.** Every issue carries one `forecast/S|M|L`
  label, applied when it is cut: `S` <60k, `M` 60-150k, `L` 150-250k. Read it
  off the turns at ~500 output tokens per turn, so `S` is under ~120 turns
  and `M` ~120-300. There is no `forecast/XL`. The label forecasts what the
  issue costs, which `bun run tokens` and `/__dev/usage` score. It no longer
  decides splitting. A worker under the ceiling writes at most ~40k output,
  so a ticket cut to it is nearly always an `S`; the label tells tickets apart
  less than it did, and is kept so the forecasts stay scored on one scale.

### Why context, not output (#627)

Measured 2026-10-23 over this machine's transcripts: 26,985 responses, and the
181 issues with at least 5 on their branches. A window is one transcript file:
a session, or one subagent. An issue's peak is the largest context (input,
cache-creation, cache-read and output tokens of one response) in the window
holding most of its turns. For 22 of the 27 tickets whose `/chain` worker
has a `final_context_tokens` in a `Usage:` comment, that figure and the
issue's peak agree within 2%;
the other five differ by 11% or more. Of the 34 tickets with a `Usage:`
comment, 17 (50%) had a worker end past 150k by that figure.

- **Most tickets already pass 150k.** 145 of 181 (80%) peaked past it, at
  quartiles of 156k, 201k and 259k. The old split rule, output at most `L`,
  kept no band under it: by forecast band the median peak was 151k for `S`
  (51 issues), 230k for `M` (67) and 261k for `L` (14).
- **Output predicts peak context poorly.** Across issues, Pearson 0.66 and
  Spearman 0.70. The 114 issues that spent under 60k output peaked at a median
  of 177k, and 78 of them passed 150k. A worker that re-reads a long standards
  file (#624) fills its window without writing much.
- **Turns in one window predict it well.** Over the 414 windows of at least 10
  turns on an issue branch, Pearson 0.87, and the least-squares fit is peak ≈
  75k + 1.7k per turn. The measured medians run close to it below 100 turns:
  160k at ~50 turns, 201k at ~75, and 259k at ~100, where the fit gives 245k.
  The 75k is what a window holds before the work starts.
- **200k is where review starts finding more.** Of 163 issues with a merged
  branch, the share whose branch has a commit naming the review or its
  findings was 42% under 150k (33 issues) and 43% at 150-200k (51), then 66%
  at 200-250k (38) and 78% past 250k (41). The median output in the two bands
  either side of 200k differs far less (38k against 47k). Bigger tickets also
  give a review more to find, so this places the line rather than proving the
  cause. CLAUDE.md's "past roughly 150k" stays the point to start watching a
  session; 200k is the line a ticket is cut to.

**The per-turn figures are re-measured on responses.** Until #413 a turn was a
transcript record, which counted one response once per content block, and the
old ~745 output tokens per turn and the band table's "median issue is 92k"
came from that. On responses: 532 output tokens per turn overall, 506 on issue
branches, and per issue a median of 486 (p25 354, p75 588), with output
tracking turns at Pearson 0.84 across issues. In `bun run tokens` the same
day, which reads the usage history (transcripts Claude Code has since deleted
included) and counts an issue with any spend, the 182 issues with recorded
spend had output quartiles of 25k, 45k and 73k, and 69 of 132 forecasts (52%)
landed in their band. The band edges are unchanged: the Usage page scores and
charts against them, and moving them would re-score every past forecast.

`bun run tokens` scores the forecasts against what was actually spent, joining
transcripts to issues through the branch name — so `<type>/<issue>-<slug>` is
what makes an issue measurable at all. Work done straight on `develop` or `main` belongs to
no issue and is invisible to it.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `(gh api --paginate --slurp 'repos/{owner}/{repo}/pulls?state=open' | ConvertFrom-Json) | ForEach-Object { $_ } | Where-Object { $_.author_association -notin 'OWNER','MEMBER','COLLABORATOR' } | Select-Object number, title, @{n='author';e={$_.user.login}}, author_association, @{n='labels';e={$_.labels.name}}`. `--slurp` wraps each page in an outer array, which the `ForEach-Object` unrolls.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue, and the work under it is its **child** issues (what the skill calls tickets).

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child issue**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the issue is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. An issue is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
