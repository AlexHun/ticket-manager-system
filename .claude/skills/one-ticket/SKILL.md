---
name: one-ticket
description: Work exactly one ticket per conversation, parking durable state on the GitHub issue and stopping at context checkpoints to hand the user a /compact or /clear. Use when starting work on an issue, picking up the next ticket from the backlog, asking "what should I work on", or whenever the user wants tickets worked one at a time without context bleeding between them.
---

# One ticket at a time

One ticket per conversation. Finish it, park it, clear, take the next. Never
carry two in one context — the second inherits the first's half-remembered
assumptions, which is the failure this exists to prevent.

## What this skill cannot do

**`/clear`, `/compact` and `/context` are the user's to type.** They are
built-in CLI commands, not tools — no tool call runs them.

So the job is to **reach a checkpoint and stop**, naming the command to type and
why. Never claim to have run one. Never guess a percentage — ask.

## The durable-state rule

Everything needed to resume lives **on the GitHub issue**, never only in the
conversation. Park it before any checkpoint, and a `/clear` costs nothing: the
next session runs `gh issue view <n> --comments` and is caught up.

If it would hurt to lose it, it belongs in a comment on the issue.

## Workflow

### 1. Claim exactly one, move it in progress

```bash
gh issue list --state open --assignee @me          # must come back empty
gh issue view <n> --comments                       # read it and its history
gh issue edit <n> --add-assignee @me               # the session's first write
git checkout -b <type>/<n>-<slug>                  # e.g. feat/42-reply-drafts
```

If something is already assigned to `@me`, that is the ticket in work. Finish or
park it before claiming another — say so rather than picking up the new request.

**Refuse a blocked ticket.** `gh api repos/{owner}/{repo}/issues/<n> --jq
.issue_dependencies_summary.blocked_by` must be `0`. A parent issue with
sub-issues is an epic, not a ticket — claim one of its children.

The assignment **is** "in progress" — this tracker has no separate status
label or board column, so a ticket assigned to `@me` on an open branch is the
whole signal. Nothing else to set.

### 2. Work it

Follow the repo's own rules — invoke `coding-standards` before touching code.
Stay inside the ticket's scope; anything else found on the way becomes a **new
issue**, not a detour:

```bash
gh issue create --title "..." --body "..." --label needs-triage
```

### 3. Checkpoint when context grows

Trigger a checkpoint at **35% context** — the one number to tune, read nowhere
else — or on any of these observable proxies, whichever comes first:

- a full test-suite or E2E run has been read
- more than ~15 files have been read into the thread
- a large search or log dump has landed
- the ticket has taken more than one round of build-and-fix

At a checkpoint: park state on the issue, then stop and ask the user to run
`/context` and `/compact`. Say what survives the compact and what does not.

### 4. Park before every checkpoint or handoff

```bash
gh issue comment <n> --body "$(cat <<'EOF'
**Progress** — <what now works, and what is verified rather than assumed>
**Next** — <the exact next step, specific enough to act on cold>
**Watch out** — <anything learned the hard way; a wrong turn already taken>
**Touched** — `path/one.ts`, `path/two.tsx`
EOF
)"
```

### 5. Complete: commit, push, open the PR

Ticket done means: the ticket's own checks pass (whatever `coding-standards`
requires — tests, typecheck, build), the work is committed, pushed, and a PR
is open against `main` with `Closes #<n>` in the body — that is what flips
the issue to closed, so don't `gh issue close` it directly.

```bash
git status --short                                 # review what's staged
git add <files>                                    # never a blind -A
git commit -m "<type>(<scope>): <what, and why if non-obvious>"
git push -u origin <type>/<n>-<slug>
gh pr create --title "<type>(<scope>): ..." --body "Closes #<n>. <summary>"
```

Confirm before pushing and opening the PR — both are visible, hard-to-reverse
actions. If review turns up more work, keep going on the same branch; the
ticket isn't done until the PR is open and `git status --short` is clean.

Then stop and tell the user to run **`/clear`** before the next ticket — the
PR is out for review and the rest of this thread is dead weight. Don't wait
on the merge inside this conversation; the issue closes on its own once the
PR lands.

## Which command to ask for

| Situation | Ask for | Because |
|---|---|---|
| Mid-ticket, context heavy | `/compact` | the thread still matters; keep the thread, drop the bulk |
| PR open, ticket done | `/clear` | nothing here is needed again; the issue and PR hold what matters |
| Switching tickets for any reason | `/clear` | this is the whole point of the skill |
| User asks to keep going anyway | neither | say the risk once, then continue — it is their call |
