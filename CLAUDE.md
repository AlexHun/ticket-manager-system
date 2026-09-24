# CLAUDE.md

AI-Powered Ticket Management System — a support desk that ingests email, classifies tickets, and drafts or sends replies grounded in a knowledge base.

## Coding standards

**Invoke the `coding-standards` skill before implementing, reviewing, or answering a question about how anything is done in this repo.** It routes to `docs/standards/` — backend, frontend, security, AI features, testing, deployment, cross-cutting conventions, and the ticket domain model. Nearly every rule there was measured; several record a case where the obvious approach lost.

Take the skill's _narrowest_ matching row and read that file in full; a question reads one file, a code change reads every matching row, and a file already read this session is not read again. The rules are dense on purpose — never summarise a standards file in place of reading it.

## Workflow

Feature work runs in this order, unbroken in one context up to the tickets:
`/write-a-prd` → `/prd-to-plan` → `/to-tickets`, then one `/implement` per
ticket. `write-a-prd` and `prd-to-plan` are this repo's tuned spec pair and
fill the slot `/mattpocock-skills:to-spec` holds elsewhere. `to-tickets` and
`implement` are local copies of the plugin skills, adapted to this repo, and
unlike the plugin versions they can be invoked by the agent; use them rather
than the `mattpocock-skills:` versions.

Branch every change from a freshly fetched main —
`git fetch origin && git switch -c <branch> origin/main` — since local `main`
lags whatever merged since the last session.

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

A bug, a flake, or a regression starts at `/mattpocock-skills:diagnosing-bugs`,
which earns a red feedback loop before it theorises.

## Agent skills

Configuration the `mattpocock-skills` engineering skills read. Written by
`/mattpocock-skills:setup-matt-pocock-skills`.

### Issue tracker

GitHub Issues on `AlexHun/ticket-manager-system`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, label strings unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root, created lazily by `/domain-modeling`. See `docs/agents/domain.md`.
