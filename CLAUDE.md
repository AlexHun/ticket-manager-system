# CLAUDE.md

Project memory for the AI-Powered Ticket Management System. See `project-scope.md`, `tech-stack.md`, and `implementation-plan.md` for full detail.

## Project

Support ticket system that ingests email, classifies tickets with Claude, and drafts/sends replies grounded in a knowledge base. Two roles: **admin** (manages agents) and **agent** (works tickets).

## Repo layout

Bun workspaces monorepo (`package.json` declares `apps/*`, `packages/*`):

```
apps/
  api/      Express + TypeScript backend (REST, Postmark webhook, AI)
  web/      React + Vite + TypeScript frontend
packages/
  shared/   Shared types (Ticket, User, API contracts)
```

TS config: `tsconfig.base.json` (strict, ES2022, ESM, `verbatimModuleSyntax`). Each workspace extends it.

## Stack (authoritative: `tech-stack.md`)

- Backend: Node + Express + TS
- Frontend: React + Vite + TS + Tailwind + shadcn/ui
- DB: Postgres (Neon/Supabase) via **Prisma 7** with the `@prisma/adapter-pg` driver adapter. Schema at `apps/api/prisma/schema.prisma`; CLI config at `apps/api/prisma.config.ts` (this is where `DATABASE_URL` is wired in — Prisma 7 no longer accepts `url` inside `datasource`). Generated client lives at `apps/api/src/generated/prisma` (gitignored, recreate with `bun run db:generate`). Import the singleton from `./db`, not the generated path directly.
- Auth: `express-session` + `connect-pg-simple` + `bcrypt` — **database sessions, not JWT**. Opaque cookie, one DB read per request.
- AI: Anthropic SDK (Claude). Use **prompt caching** for the KB block.
- Email: Postmark inbound + outbound. Thread via `Message-ID` / `In-Reply-To` / `References`.
- CORS: cross-origin in dev → API must set `Access-Control-Allow-Credentials: true`; frontend must `credentials: "include"`.

## Commands

Run from repo root:

- `bun run dev` — all workspaces in parallel
- `bun run dev:api` / `bun run dev:web` — single app
- `bun run build` — all workspaces
- `bun run typecheck` — all workspaces

DB (run inside `apps/api`):

- `bun run db:generate` — regenerate Prisma client
- `bun run db:migrate` — create/apply migrations in dev (`prisma migrate dev`)
- `bun run db:deploy` — apply migrations in prod (`prisma migrate deploy`)
- `bun run db:studio` — open Prisma Studio

## Fetching documentation

Use the **context7** MCP server for any library, framework, SDK, API, or CLI question — React, Vite, Express, Prisma/Drizzle, Tailwind, shadcn/ui, Anthropic SDK, Postmark, `express-session`, `connect-pg-simple`, Bun, etc. Use it even for libraries you think you know; training data may lag behind current versions.

Flow: `mcp__context7__resolve-library-id` → `mcp__context7__query-docs`.

Prefer context7 over web search for library docs. Skip it for refactoring, business-logic debugging, or general programming concepts.

## Conventions

- Strict TS; no unused locals/params; `verbatimModuleSyntax` (use `import type` for type-only imports).
- Shared cross-app types live in `packages/shared` — don't duplicate `Ticket` / `User` / API contracts in the apps.
- Don't introduce JWT, Redis, a queue, or vector DB without a concrete need — `tech-stack.md` explicitly defers them.
