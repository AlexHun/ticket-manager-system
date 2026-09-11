# CLAUDE.md

AI-Powered Ticket Management System — a support desk that ingests email, classifies tickets, and drafts or sends replies grounded in a knowledge base.

## Coding standards

**Invoke the `coding-standards` skill before implementing, reviewing, or answering a question about how anything is done in this repo.** It routes to `docs/standards/` — backend, frontend, security, AI features, testing, deployment, cross-cutting conventions, and the ticket domain model. Nearly every rule there was measured; several record a case where the obvious approach lost.

Take the skill's _narrowest_ matching row and read that file in full; a question reads one file, a code change reads every matching row, and a file already read this session is not read again. The rules are dense on purpose — never summarise a standards file in place of reading it.

## Workflow

Feature work runs in this order, unbroken in one context up to the tickets:
`/write-a-prd` → `/prd-to-plan` → `/mattpocock-skills:to-tickets`, then one
`/mattpocock-skills:implement` per ticket. `write-a-prd` and `prd-to-plan` are
this repo's tuned spec pair and fill the slot `/mattpocock-skills:to-spec`
holds elsewhere.

**One ticket per session.** A ticket ends at `/mattpocock-skills:code-review`;
report it done and stop there rather than opening the next one, so the next
ticket starts in a fresh context. Context cost per turn climbs steeply with
session length, and past roughly 150k tokens reasoning degrades — a ticket that
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
