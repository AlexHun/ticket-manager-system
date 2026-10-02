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
clean and `git fetch origin` has run, then start one `general-purpose`
subagent with this prompt and wait for its completion notice:

> Invoke the `implement` skill for issue #<n> and follow it to the end. You
> are a subagent: a background command will never wake you, so run
> `gh pr checks <pr> --watch` in the foreground with the maximum timeout, and
> run it again until it exits. "no checks reported" right after a push means
> the run has not registered yet, and a superseded run ends `cancelled`; both
> are a re-watch, not a failure. Report only once every CI job is green: a red
> job is investigated (start at `mattpocock-skills:diagnosing-bugs`), fixed,
> pushed and watched again, as CLAUDE.md's Workflow describes for flakes and
> real failures alike. End your reply with exactly one line:
> `RESULT ticket=#<n> pr=#<pr|none> ci=<green|red|none> questions=<none|one-line summary>`

Steps 3 and 4 act on that `RESULT` line.

**Red CI is fixed, not skipped.** When the worker still returns `ci=red`,
continue that same worker with SendMessage, so it keeps its diagnosis so far:

> CI on #<pr> is still red. Find why, fix it, push, and watch until green. End
> with the same `RESULT` line.

Allow three such rounds per ticket. A ticket still red after the third is the
one red case that stops the chain (step 4): a failure that resists three
focused attempts wants the user's judgement, not a fourth.

## 3. Gate the merge

Re-check the PR yourself: `gh pr checks <pr>` all passing and
`gh pr view <pr> --json mergeable,baseRefName` showing `MERGEABLE` into
`develop`. Then:

- With `auto`, merge. Without it, show the PR link with the `RESULT` line and
  ask; the user's yes covers this one PR only.
- Merge with `gh pr merge <pr> --merge --delete-branch`, the repo's merge-commit
  style. `Closes #<n>` in the PR body closes the ticket, which is what unblocks
  the next one.
- `git fetch origin`, then go back to step 2.

## 4. Stop

The chain stops, and reports, when any of these holds:

- every ticket from step 1 is closed: done;
- a ticket is still `ci=red` after three fix rounds;
- a worker returns `pr=none` or `questions` that are not `none`;
- the next ticket is blocked by an open issue outside the chain;
- a merge fails or the user declines one.

Report a table with one row per ticket — ticket, PR, CI, merged or why it
stopped — and, when stopped early, the one thing the user has to decide before
`/chain <same argument>` can resume.
