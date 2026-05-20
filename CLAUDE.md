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
- Auth: **Better Auth** (`better-auth`) with the Prisma adapter. Server config at `apps/api/src/auth.ts` (email/password enabled, `disableSignUp: true`, `role` additional field `admin|agent`, `TRUSTED_ORIGINS` required, `BETTER_AUTH_SECRET` validated ≥32 chars, `rateLimit` enabled only in production). Server-side RBAC middleware at `apps/api/src/middleware/auth.ts` exports `requireAuth` and `requireAdmin` — apply to every protected route (frontend `AdminRoute` is UX, not security). Client at `apps/web/src/lib/auth-client.ts` exports `signIn` / `signOut` / `useSession` and reads `VITE_API_URL` for cross-origin baseURL. Cookie-based sessions — **not JWT**.
- AI: Anthropic SDK (Claude). Use **prompt caching** for the KB block.
- Email: Postmark inbound + outbound. Thread via `Message-ID` / `In-Reply-To` / `References`.
- CORS: cross-origin in dev → API uses `cors` middleware in `apps/api/src/index.ts` with `origin: trustedOrigins` (exported from `auth.ts`) and `credentials: true`. Mounted before the Better Auth handler. Frontend uses `credentials: "include"`.
- Testing: see the `playwright-e2e-author` agent for the E2E setup (Playwright config, test DB, alt ports, env file, run/seed scripts).

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

For E2E test commands (`test:e2e`, `db:test:*`), see the `playwright-e2e-author` agent.

Bun env gotchas: `bun --env-file=X x ...` and `bun --env-file=X run <script that calls bun>` do **not** propagate the env to the child — the inner `bun` re-loads default `.env`. For Prisma CLI use `dotenv-cli`. Workspace filter syntax is `bun run --filter <pkg> <script>`, not `bun --filter <pkg> run <script>`.

## Fetching documentation

Use the **context7** MCP server for any library, framework, SDK, API, or CLI question — React, Vite, Express, Prisma/Drizzle, Tailwind, shadcn/ui, Anthropic SDK, Postmark, `express-session`, `connect-pg-simple`, Bun, etc. Use it even for libraries you think you know; training data may lag behind current versions.

Flow: `mcp__context7__resolve-library-id` → `mcp__context7__query-docs`.

Prefer context7 over web search for library docs. Skip it for refactoring, business-logic debugging, or general programming concepts.

## Conventions

- Strict TS; no unused locals/params; `verbatimModuleSyntax` (use `import type` for type-only imports).
- Shared cross-app types live in `packages/shared` — don't duplicate `Ticket` / `User` / API contracts in the apps.
- Don't introduce JWT, Redis, a queue, or vector DB without a concrete need — `tech-stack.md` explicitly defers them.

## Frontend

- Forms: **react-hook-form** + **zod** via `@hookform/resolvers/zod`. Define the schema, infer the values type with `z.infer`, disable inputs on `isSubmitting`, surface server errors in local state.
- Icons: **lucide-react**. Use `Loader2` with `animate-spin` for pending/loading states.
- Tailwind v4 (CSS-first, no `tailwind.config`). Theme tokens are CSS variables in `apps/web/src/index.css` under `:root` / `.dark`; reference them as `var(--background)` etc. shadcn/ui components live in `apps/web/src/components/ui/`.
- Data fetching: **axios** + **@tanstack/react-query**. Don't use `fetch` directly. Use the shared axios instance from `@/lib/api` (preconfigured with `baseURL: VITE_API_URL` and `withCredentials: true` for cookie-based sessions). Wrap every server call in `useQuery` / `useMutation` — pass the `signal` from the query function into axios for automatic cancellation. The `QueryClientProvider` is wired in `apps/web/src/main.tsx`.
