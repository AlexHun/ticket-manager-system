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
fill the slot `/mattpocock-skills:to-spec` holds elsewhere. `to-tickets`,
`implement` and `retro` are local copies of the plugin skills, adapted to this repo, and
unlike the plugin versions they can be invoked by the agent; use them rather
than the `mattpocock-skills:` versions.

**`develop` is staging; `main` is production.** Branch every change from a
freshly fetched develop —
`git fetch origin && git switch -c <branch> origin/develop` — since local
`develop` lags whatever merged since the last session — and open its PR into
`develop` (the repo's default branch, so `gh pr create` targets it and
`Closes #<n>` closes the ticket on merge). Nothing merges into `main`, which
Railway deploys to production, except a release, made only when the user asks
for it, through the `release` skill. The version bump runs on `develop`, after
every merge, and a release carries that version to `main` unchanged.

**Self-check before every commit.** Search for each reference the change leaves
stale: old symbol names, moved paths, mentions in docs and comments. Re-read
every edited range after the last edit, its delimiters (`*/`, brackets) and
surrounding sentences included. Recount every number stated in prose against
its source. These are the defects review agents most often send back, each one
a fix commit.

**One ticket per session.** A ticket ends when its PR is green in CI: after
`/mattpocock-skills:code-review`, push and run
`node .claude/scripts/wait-checks.mjs <n>` in the foreground, again each time
it ends `pending`: E2E runs 11-18 minutes, longer than one tool call. A red
job whose test has an open `Flake:` issue gets one `gh run rerun <run-id> --failed`; any other red job is diagnosed in this
session, and one that goes green on re-run is filed as `Flake: <test>`. Report
it done and stop there rather than opening the next one, so the next ticket
starts in a fresh context. Context cost per turn climbs steeply with session
length, and past roughly 200k tokens of context review starts finding more —
a ticket forecast past that, about 75 turns in one window, wants splitting,
not compacting (`docs/agents/issue-tracker.md`, #627).

**Resume from the repo, not from memory.** After an API error, a restore or a
`Continue`, read `git status`, the current branch and `gh pr view` before the
next action, and tell the user where things stand. On a resume or after
compaction, `.claude/hooks/print-resume-state.mjs` prints all three into context
at session start; after an API error mid-session, read them yourself.

A bug, a flake, or a regression starts at `/mattpocock-skills:diagnosing-bugs`,
which earns a red feedback loop before it theorises.

## Shell

`git`, `gh`, `bun` and `node` run in both shells; `python` is the Store stub,
and `python -` hangs until the timeout. An edit the Edit tool can't make, bulk
or in a file not yet read, is `bun scripts/replace-once.ts <file> <pairs.json>`
(`--revert` undoes it): UTF-8 without a BOM, CRLF kept, nothing written unless
every pair matches exactly once. Write every multi-line message to a file in
the scratchpad with the Write tool (`Out-File` adds a BOM) and pass the file —
`git commit -F`, `gh pr create --body-file`, `gh issue comment --body-file` —
so quoting never reaches the text. Read `gh` JSON with
`(gh … --json … | ConvertFrom-Json)`, not a quoted `--jq` filter. End a line
on the hook-running or test command so its exit code is the one reported;
`.claude/hooks/block-no-verify.mjs` refuses a trailing `; echo` or `|| true`.
A command that `.claude/settings.json` allows runs in its own call, follow-up
checks in the next: chained, `gh pr merge` did not match its rule and auto
mode refused it (#647). `.claude/hooks/block-env-read.mjs` refuses to read or
write a local env file, which holds live secrets; read its committed example
template for the names.

## Agent skills

Configuration the `mattpocock-skills` engineering skills read. Written by
`/mattpocock-skills:setup-matt-pocock-skills`.

### Issue tracker

GitHub Issues on `AlexHun/ticket-manager-system`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, label strings unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `GLOSSARY.md` + `docs/adr/` at the repo root, created lazily by `/domain-modeling`. See `docs/agents/domain.md`.
