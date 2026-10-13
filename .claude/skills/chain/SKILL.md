---
name: chain
description: Run every ticket of one PRD or plan to done, one after another — each implemented by a fresh subagent through implement and merged into develop before the next starts. Use when the user wants to chain, run or work through all the tickets of a PRD or plan, or do them one by one.
---

# Chain

Work through one PRD's tickets in sequence. This session is the **conductor**:
it picks the next ticket, hands it to a **worker** subagent with a fresh
context, has a **reviewer** subagent check the green PR, gates the merge, and
moves on. It never implements anything itself, so it stays small across the
whole chain while each ticket still gets its own context, as CLAUDE.md's
one-ticket-per-session rule asks.

Arguments: the plan or PRD path (`docs/plans/<slug>.md`, `docs/prd/<slug>.md`)
or an explicit list of issue numbers, plus an optional `auto`. Asking is the
default: every merge waits for the user's yes. `auto` merges a green, approved,
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
clean and `git fetch origin` has run, then read its forecast label with
`gh issue view <n> --json labels` and start the worker agent it names:

| Label        | Worker           | Model and effort   |
| ------------ | ---------------- | ------------------ |
| `forecast/S` | `chain-worker-s` | Haiku 5.5, `high`  |
| `forecast/M` | `chain-worker-m` | Sonnet 5.5, `high` |
| `forecast/L` | `chain-worker-l` | Opus 5.5, `medium` |

Each worker's own prompt, in `.claude/agents/`, carries the instructions; its
frontmatter pins the full model ID, because a family alias such as `opus`
resolves to the conductor's own model whenever that is in the same family. Give
it only `Issue #<n>.` and wait for its completion notice. Pass no `model` or
`effort` with the call: either would override the frontmatter. A ticket with
no forecast label, or more than one, waits for the user to pick the worker.

Raise `chain-worker-s` to `effort: max` only if `ticket-reviewer` keeps sending
back the same kind of mistake from S tickets.

Steps 3 to 5 act on the worker's `RESULT` line.

**Red CI is fixed, not skipped.** When the worker still returns `ci=red`,
continue that same worker with SendMessage, so it keeps its diagnosis so far:

> CI on #<pr> is still red. Find why, fix it, push, and watch until green. End
> with the same `RESULT` line.

Allow three such rounds per ticket. A ticket still red after the third is the
one red case that stops the chain (step 5): a failure that resists three
focused attempts wants the user's judgement, not a fourth.

## 3. Review before merge

Once the worker returns `ci=green` with `questions=none`, start one
`ticket-reviewer` agent with `PR #<pr>.` and wait for it. It is the ticket's
only review: the workers skip `implement`'s own `code-review`. It ends with:

`REVIEW pr=#<pr> verdict=<approve|changes> findings=<…>`

On `changes`, continue the **same worker** with SendMessage, so it keeps its
context, and pass the reviewer's blocking findings verbatim:

> The pre-merge review of #<pr> asks for changes: <findings>. Fix them on the
> same branch, push, and watch CI until green. End with the same `RESULT` line.

When it returns `ci=green` again, start a fresh `ticket-reviewer` on the PR. A
red result here counts against the three CI rounds of step 2. Allow two such
fix rounds per ticket; a third review still at `changes` stops the chain
(step 5).

## 4. Gate the merge

Merge only on `verdict=approve` from the latest review. Re-check the PR
yourself: `gh pr checks <pr>` all passing and
`gh pr view <pr> --json mergeable,baseRefName` showing `MERGEABLE` into
`develop`. Then:

- With `auto`, merge. Without it, show the PR link with the `RESULT` and
  `REVIEW` lines and ask; the user's yes covers this one PR only.
- Merge with `gh pr merge <pr> --merge --delete-branch`, the repo's merge-commit
  style. `Closes #<n>` in the PR body closes the ticket, which is what unblocks
  the next one.
- `git fetch origin`, then go back to step 2.

## 5. Stop

The chain stops, and reports, when any of these holds:

- every ticket from step 1 is closed: done. The last worker's `implement`
  marked the PRD `Status: Shipped`; if its header still says otherwise, say so
  in the report;
- a ticket is still `ci=red` after three fix rounds;
- a ticket's review is still `verdict=changes` after two fix rounds;
- a worker returns `pr=none` or `questions` that are not `none`;
- the next ticket is blocked by an open issue outside the chain;
- a merge fails or the user declines one.

Report a table with one row per ticket — ticket, worker, PR, CI fix rounds,
review rounds, merged or why it stopped — and, when stopped early, the one
thing the user has to decide before `/chain <same argument>` can resume.
