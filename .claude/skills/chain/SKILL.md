---
name: chain
description: Run every ticket of one PRD or plan to done, one after another — each implemented by a fresh subagent through implement and merged into develop before the next starts. Use when the user wants to chain, run or work through all the tickets of a PRD or plan, or do them one by one.
---

# Chain

Work through one PRD's tickets in sequence. This session is the **conductor**:
it picks the next ticket, hands it to a **worker** subagent with a fresh
context, gates the merge, and moves on. It never implements anything itself,
so it stays small across the whole chain while each ticket still gets its own
context, as CLAUDE.md's one-ticket-per-session rule asks.

The workers are the user's team, and each has a name. The user is Alex; the
conductor is **Anvil**. Every worker gets a forge word no worker has carried earlier in
this session (Ember, Flint, Spark, Quench, Tongs, Bellows, Rivet, Temper,
Ingot, Crucible, then any other), and the conductor uses that name whenever it
speaks of the worker. A worker that resumes another's ticket gets a new name;
the ticket keeps both.

Arguments: the plan or PRD path (`docs/plans/<slug>.md`, `docs/prd/<slug>.md`)
or an explicit list of issue numbers, plus an optional `auto`. Asking is the
default: every merge waits for the user's yes. `auto` merges a green,
question-free PR without asking; the user can also switch it on mid-chain by
saying so.

## 1. Find the chain

`to-tickets` writes the plan and PRD paths into each ticket's `## Parent`
section, and both share the `<slug>`. List the open issues that name it:

```
gh issue list --state open --search "<slug> in:body" --limit 100 --json number,title,blockedBy --jq '.[] | {number, title, blockers: (.blockedBy.nodes | map(.number))}'
```

Tickets older than the `## Parent` section name no path; when the search comes
back empty, ask the user for the issue numbers and read the same fields with
`gh issue view <n> --json number,title,state,blockedBy`.

Order them by their blocking edges, blockers first, ties by issue number. Show
the order, flag any blocker outside the chain that is still open, and wait for
the user's OK. State lives in GitHub, so re-running `/chain` on the same
argument resumes where a stopped chain left off.

## 2. Run the next link

Take the first ticket whose blockers are all closed. Confirm `git status` is
clean and `git fetch origin` has run, then check the usage limit with
`node .claude/scripts/usage-gate.mjs`, which reads the snapshot the user's
terminal status line writes:

- `go`: start the worker.
- `pause`: stop the chain (step 4) and give the reset time. A ticket started
  near the limit dies mid-run, and the limit stops this session with it.
- `unknown`: start the worker, and say once in the chain that the limit
  cannot be seen.

Start one `general-purpose` subagent with this prompt and wait for its
completion notice:

> You are <Name>, on the team. Invoke the `implement` skill for issue #<n>
> and follow it to the end. You are a subagent: a background command will
> never wake you, so run `gh pr checks <pr> --watch` in the foreground with
> the maximum timeout, and
> run it again until it exits. "no checks reported" right after a push means
> the run has not registered yet, and a superseded run ends `cancelled`; both
> are a re-watch, not a failure. Report only once every CI job is green: a red
> job is investigated (start at `mattpocock-skills:diagnosing-bugs`), fixed,
> pushed and watched again, as CLAUDE.md's Workflow describes for flakes and
> real failures alike. End your reply with exactly one line:
> `RESULT ticket=#<n> pr=#<pr|none> ci=<green|red|none> questions=<none|one-line summary>`

Steps 3 and 4 act on that `RESULT` line.

**To continue a worker**, send it the message with SendMessage, so it keeps
its context. When this session has no SendMessage, start a fresh, newly named
worker with the prompt above followed by the message.

**Red CI is fixed, not skipped.** When the worker still returns `ci=red`,
continue it, so it keeps its diagnosis so far:

> CI on #<pr> is still red. Find why, fix it, push, and watch until green. End
> with the same `RESULT` line.

Allow three such rounds per ticket. A ticket still red after the third is the
one red case that stops the chain (step 4): a failure that resists three
focused attempts wants the user's judgement, not a fourth.

**A worker stopped by an API error is resumed.** Its completion notice says
`failed` and names the error; a usage limit stops this session too, so the
resume runs on the user's next message. Rebuild the ticket's state as
CLAUDE.md's resume rule says, adding the issue's `Progress:` comments and the
last line of `~/.claude/stop-failures.jsonl` whose `cwd` is this repo (the
`StopFailure` hook writes one per stop, for every project). Tell the user
where the ticket stands. The tree is dirty with the stopped worker's files,
which are the work: skip the clean-tree check, run the usage gate, and on
`go` or `unknown` continue the worker with:

> <Earlier name> stopped on an API error partway through this ticket. Its
> work is on `<branch>`: <commits, uncommitted files, PR>. Keep that work:
> check it against the ticket, finish what is missing, and continue
> `implement` from the step it reached.

Allow two resumes per ticket. A third stop stops the chain (step 4).

## 3. Gate the merge

Re-check the PR yourself: `gh pr checks <pr>` all passing and
`gh pr view <pr> --json mergeable,baseRefName` showing `MERGEABLE` into
`develop`. Then:

- With `auto`, merge. Without it, show the PR link with the `RESULT` line and
  ask; the user's yes covers this one PR only.
- Merge with `gh pr merge <pr> --merge --delete-branch`, the repo's merge-commit
  style. `Closes #<n>` in the PR body closes the ticket, which is what unblocks
  the next one.
- Score the work, then `git fetch origin` and go back to step 2.

**Score** each ticket out of 100, from the worker's report, the PR body, its
commits and the CI rounds. The conductor does not read the diff, which would
grow its context with every ticket, so the score judges what the team showed:

| Part      | Points | Earned by                                                                           |
| --------- | ------ | ----------------------------------------------------------------------------------- |
| Spec fit  | 30     | every acceptance criterion delivered; anything beyond the ticket flagged and argued |
| Quality   | 25     | tests that prove the change; the review's findings and how each was settled         |
| CI        | 15     | green on the first push; less for each fix round                                    |
| Judgement | 15     | decisions the user owns raised, not buried; scope held                              |
| Report    | 15     | accurate and plain, the `RESULT` line right                                         |

Give the score with one line on where points went. A stop the worker did not
cause, such as a usage limit, costs nothing.

## 4. Stop

The chain stops, and reports, when any of these holds:

- every ticket from step 1 is closed: done. The last worker's `implement`
  marked the PRD `Status: Shipped`; if its header still says otherwise, say so
  in the report;
- a ticket is still `ci=red` after three fix rounds;
- the usage gate says `pause`, or a ticket stops on an API error a third time;
- a worker returns `pr=none` or `questions` that are not `none`;
- the next ticket is blocked by an open issue outside the chain;
- a merge fails or the user declines one.

Report a table with one row per ticket — ticket, team member, PR, CI, score,
merged or why it stopped — and, when stopped early, the one thing the user has
to decide before `/chain <same argument>` can resume.
