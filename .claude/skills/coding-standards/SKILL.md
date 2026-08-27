---
name: coding-standards
description: Routes to this repo's coding standards, architecture invariants and measured gotchas, split by area — backend, frontend, security, AI features, testing, deployment, cross-cutting conventions, and the ticket domain model. Use when implementing or changing any code in this repo, reviewing a diff, branch or PR, answering a question about conventions or how something is done here, or working on tickets, statuses, auth, Prisma, pg-boss, email ingestion, the outbox, AI prompts, the knowledge-base auto-reply, shadcn or Radix UI, Tailwind tokens, react-query, CSP headers, Railway deploys, or any test.
---

# Coding standards

Standards for the AI-Powered Ticket Management System. Nearly every rule in the reference files was **measured**, and several record a case where the obvious approach lost. Treat them as findings, not preferences.

## Process

1. **Name the areas the work touches** — from the table below. Most tasks touch two or three.
2. **Read every matching file in full** before writing or reviewing a line. Skimming for the section that looks relevant is how the load-bearing caveat two paragraphs down gets missed.
3. **Apply them.** When a standard and the request genuinely conflict, say so in one line and proceed — do not silently pick a side.

Done when every matching file has been read and every rule in it either applied or explicitly flagged as conflicting.

## Where to look

| Read | When the work touches |
| --- | --- |
| [domain.md](../../../docs/standards/domain.md) | Ticket statuses, assignment, the `/pipeline` page, the automated assistant account, handoff routing, reopen behaviour |
| [backend.md](../../../docs/standards/backend.md) | `apps/api` — Prisma, Express, CORS, Better Auth config, pg-boss jobs, `ingest.ts`, the outbox, outbound mail |
| [frontend.md](../../../docs/standards/frontend.md) | `apps/web` — shadcn/Radix controls, Tailwind tokens, forms, axios + react-query, sonner, `AiShine`, `/__dev` tooling |
| [security.md](../../../docs/standards/security.md) | Email HTML, any LLM prompt, the auto-reply output checks, CSP, webhook auth, the pipeline simulator, anything a stranger's text reaches |
| [ai-features.md](../../../docs/standards/ai-features.md) | Polish, summarise, classify, auto-reply, `ai/provider.ts`, model settings, structured output, usage logging, retry policy |
| [testing.md](../../../docs/standards/testing.md) | Any test file, test command, mock, or script/env question |
| [deployment.md](../../../docs/standards/deployment.md) | Railway, Dockerfiles, migrations, `COOKIE_DOMAIN`, `VITE_API_URL`, anything build-time |
| [conventions.md](../../../docs/standards/conventions.md) | TypeScript strictness, `@ticket/shared` types and `USER_ROLE`, zod in `@ticket/core`, new dependencies, context7 and chrome-devtools MCP usage |

## Always

**Ask before inventing a UI control.** If shadcn/ui has no component for the need, stop and ask rather than hand-rolling or substituting a native one.

**Prompt rules are advisory; code-level checks are the feature.** Every prompt-only defence in this repo has a measured failure rate. Never weaken a string comparison or schema constraint that guards model output, and never add a path that sends model output without one.

## Deeper background

These are the sources the standards were distilled from — reach for them when a standard's *reason* matters more than the rule:

- `project-scope.md`, `tech-stack.md` — what the system is meant to be. `tech-stack.md` is authoritative for stack choices.
- `CONTEXT.md` + `docs/adr/` — the domain model and the decisions behind it.
- `SCRIPTS.md` — every script and seed, and which may point at production.
- `DEPLOYMENT.md` — the full Railway runbook.
