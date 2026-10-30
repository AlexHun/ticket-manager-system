---
name: coding-standards
description: Routes to this repo's coding standards, architecture invariants and measured gotchas, split by area — backend, frontend, the `/__dev` dev tools, visual design, UI copy, security, AI features, testing, deployment, cross-cutting conventions, and the ticket domain model. Use when implementing or changing any code in this repo, reviewing a diff, branch or PR, answering a question about conventions or how something is done here, or working on tickets, statuses, auth, Prisma, pg-boss, email ingestion, the outbox, AI prompts, the knowledge-base auto-reply, shadcn or Radix UI, Tailwind tokens, react-query, CSP headers, Railway deploys, any test, any new or restyled screen — fonts, colours, spacing, loading, empty and error states, motion — or any UI text — labels, buttons, tooltips, error messages, empty states, tutorial steps or outbound email wording — or any prose about the code, such as a comment, an ADR, a skill, a plan, or a commit or PR body.
---

# Coding standards

Standards for the AI-Powered Ticket Management System. Nearly every rule in the reference files was **measured**, and several record a case where the obvious approach lost. Treat them as findings, not preferences.

## Process

1. **Name the areas the work touches** — from the table below. Most tasks touch two or three.
2. **Read every matching file in full** before writing or reviewing a line. Skimming for the section that looks relevant is how the load-bearing caveat two paragraphs down gets missed. The table routes to the *smallest* file that covers the work — take the narrow row when it applies, then read that one in full. A file already read in this session is not read again.
3. **Apply them.** When a standard and the request genuinely conflict, say so in one line and proceed — do not silently pick a side.

**A question is not a change.** Answering "how is X done here" reads the *one* file whose row covers X. Writing, changing or reviewing code reads every matching row.

Done when every matching file has been read and every rule in it either applied or explicitly flagged as conflicting.

## Where to look

| Read | When the work touches |
| --- | --- |
| [domain.md](../../../docs/standards/domain.md) | Ticket statuses, assignment, the `/pipeline` page, the automated assistant account, handoff routing, reopen behaviour |
| [backend.md](../../../docs/standards/backend.md) | `apps/api` — Prisma, Express, CORS, Better Auth config, pg-boss jobs, `ingest.ts`, the outbox, outbound mail |
| [frontend.md](../../../docs/standards/frontend.md) | `apps/web` — shadcn/Radix controls, Tailwind tokens, forms, axios + react-query, sonner, the React hooks and promise lint rules, `AiShine` |
| [dev-tools.md](../../../docs/standards/dev-tools.md) | `/__dev`: `apps/web/src/dev/` and `apps/web/dev/` — the Sessions, Usage, project map and test runner pages, the Vite plugin, transcripts and the usage history, `bun run tokens`, the develop server's Basic Auth, spawning `git`/`gh` from the dev server |
| [design.md](../../../docs/standards/design.md) | How a screen looks — fonts and type tokens, colour and surfaces, spacing, alignment, radius, icons; any new or restyled UI |
| [design-states.md](../../../docs/standards/design-states.md) | How a screen behaves — hover/focus/disabled states, loading skeletons, empty and error screens, motion and transitions, semantic markup |
| [copy.md](../../../docs/standards/copy.md) | Any word a person reads — labels, buttons, headings, tooltips, placeholders, `aria-label`s, empty states, toasts, dialogs, error messages (API ones included), tutorial steps, the invitation and reset emails |
| [docs-and-comments.md](../../../docs/standards/docs-and-comments.md) | Any prose about the code — a comment, a standards file, an ADR, a skill or agent, a plan, a commit or PR body: counts, positions, "every"/"only" claims, retelling an ADR, quotations |
| [security.md](../../../docs/standards/security.md) | Email HTML, the polish and summarise prompts, CSP, webhook auth, the classifier, the pipeline simulator, anything a stranger's text reaches |
| [security-auto-reply.md](../../../docs/standards/security-auto-reply.md) | The knowledge-base auto-reply specifically — its prompt, its corpus and `/knowledge`, the six output checks, `composeReply`, the escape rate on `/evals` |
| [ai-features.md](../../../docs/standards/ai-features.md) | Polish, summarise, classify, auto-reply, `ai/provider.ts`, model settings, structured output, usage logging, retry policy |
| [testing.md](../../../docs/standards/testing.md) | Test commands, any `apps/web` component test, or a script/env question |
| [testing-api.md](../../../docs/standards/testing-api.md) | Any `apps/api` test — `bun test`, the in-process Postgres, `resetDb`, `mock.module` and the registry hazard, route tests, shared stubs, `dbCalls` |
| [deployment.md](../../../docs/standards/deployment.md) | Railway, Dockerfiles, migrations, `COOKIE_DOMAIN`, `VITE_API_URL`, anything build-time |
| [conventions.md](../../../docs/standards/conventions.md) | TypeScript strictness, `bun run lint` and its floating-promise rules, `@ticket/shared` types and `USER_ROLE`, zod in `@ticket/core`, new dependencies, delegating bulk work to a worker-model subagent, context7 and chrome-devtools MCP usage |

## Always

**Ask before inventing a UI control.** If shadcn/ui has no component for the need, stop and ask rather than hand-rolling or substituting a native one.

**Prompt rules are advisory; code-level checks are the feature.** Every prompt-only defence in this repo has a measured failure rate. Never weaken a string comparison or schema constraint that guards model output, and never add a path that sends model output without one.

## Deeper background

These are the sources the standards were distilled from — reach for them when a standard's *reason* matters more than the rule:

- `project-scope.md`, `tech-stack.md` — what the system is meant to be. `tech-stack.md` is authoritative for stack choices.
- `GLOSSARY.md` + `docs/adr/` — the domain model and the decisions behind it.
- `SCRIPTS.md` — every script and seed, and which may point at production.
- `DEPLOYMENT.md` — the full Railway runbook.
