# CLAUDE.md

AI-Powered Ticket Management System — a support desk that ingests email, classifies tickets, and drafts or sends replies grounded in a knowledge base.

## Coding standards

**Invoke the `coding-standards` skill before implementing, reviewing, or answering a question about how anything is done in this repo.** It routes to `docs/standards/` — backend, frontend, security, AI features, testing, deployment, cross-cutting conventions, and the ticket domain model. Nearly every rule there was measured; several record a case where the obvious approach lost.

## Agent skills

Configuration the `mattpocock-skills` engineering skills read. Written by
`/mattpocock-skills:setup-matt-pocock-skills`.

### Issue tracker

GitHub Issues on `AlexHun/ticket-manager-system`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, label strings unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root, created lazily by `/domain-modeling`. See `docs/agents/domain.md`.
