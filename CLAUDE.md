# CLAUDE.md

AI-Powered Ticket Management System — a support desk that ingests email, classifies tickets, and drafts or sends replies grounded in a knowledge base.

## Coding standards

**Invoke the `coding-standards` skill before implementing, reviewing, or answering a question about how anything is done in this repo.** It routes to `docs/standards/` — backend, frontend, security, AI features, testing, deployment, cross-cutting conventions, and the ticket domain model. Nearly every rule there was measured; several record a case where the obvious approach lost.

Take the skill's _narrowest_ matching row and read that file in full; a question reads one file, a code change reads every matching row, and a file already read this session is not read again. The rules are dense on purpose — never summarise a standards file in place of reading it.

## Workflow

Feature work runs in this order, unbroken in one context up to the tickets:
`/write-a-prd` → `/prd-to-plan` → `/to-tickets`, then one `/implement` per
ticket — or `/chain` to run them all in sequence, each ticket in a fresh
subagent, merged before the next starts. `write-a-prd` and `prd-to-plan` are this repo's tuned spec pair and
fill the slot `/mattpocock-skills:to-spec` holds elsewhere. `to-tickets` and
`implement` are local copies of the plugin skills, adapted to this repo, and
unlike the plugin versions they can be invoked by the agent; use them rather
than the `mattpocock-skills:` versions.

**`develop` is staging; `main` is production.** Branch every change from a
freshly fetched develop —
`git fetch origin && git switch -c <branch> origin/develop` — since local
`develop` lags whatever merged since the last session — and open its PR into
`develop` (the repo's default branch, so `gh pr create` targets it and
`Closes #<n>` closes the ticket on merge). Nothing merges into `main` except a
release: one PR from `develop` into `main`, opened only when the user asks for
it, once CI on `develop`'s tip is green. `main` is what Railway deploys to
production. The version bump runs on `develop`, after every merge, and a
release carries that version to `main` unchanged.

**Self-check before every commit.** Search for each reference the change leaves
stale: old symbol names, moved paths, mentions in docs and comments. Re-read
every edited range after the last edit, its delimiters (`*/`, brackets) and
surrounding sentences included. Recount every number stated in prose against
its source. These are the defects review agents most often send back, each one
a fix commit.

**One ticket per session.** A ticket ends when its PR is green in CI: after
`/mattpocock-skills:code-review`, push and run `gh pr checks <n> --watch` in the
background. A red job whose test has an open `Flake:` issue gets one
`gh run rerun <run-id> --failed`; any other red job is diagnosed in this
session, and one that goes green on re-run is filed as `Flake: <test>`. Report
it done and stop there rather than opening the next one, so the next ticket
starts in a fresh context. Context cost per turn climbs steeply with session
length, and past roughly 150k tokens reasoning degrades — a ticket that
outgrows its window wants splitting, not compacting.

**Resume from the repo, not from memory.** After an API error, a restore or a
`Continue`, read `git status`, the current branch and `gh pr view` before the
next action, and tell the user where things stand.

A bug, a flake, or a regression starts at `/mattpocock-skills:diagnosing-bugs`,
which earns a red feedback loop before it theorises.

## Shell

Run `git`, `gh` and `bun` through PowerShell: on this Windows machine the Bash
tool has none of them on its path. Write every multi-line message to a file in
the scratchpad and pass the file — `git commit -F`, `gh pr create --body-file`,
`gh issue comment --body-file` — so quoting never reaches the text. End a line
on the hook-running or test command so its exit code is the one reported;
`.claude/hooks/block-no-verify.mjs` refuses a trailing `; echo` or `|| true`.

## Agent skills

Configuration the `mattpocock-skills` engineering skills read. Written by
`/mattpocock-skills:setup-matt-pocock-skills`.

### Issue tracker

GitHub Issues on `AlexHun/ticket-manager-system`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, label strings unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root, created lazily by `/domain-modeling`. See `docs/agents/domain.md`.
