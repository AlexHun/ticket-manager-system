# CLAUDE.md

Project memory for the AI-Powered Ticket Management System. See `project-scope.md`, `tech-stack.md`, and `implementation-plan.md` for full detail.

## Project

Support ticket system that ingests email, classifies tickets with Claude, and drafts/sends replies grounded in a knowledge base. Two roles: **admin** (manages agents) and **agent** (works tickets).

## Stack (authoritative: `tech-stack.md`)

- Auth: **Better Auth** (`better-auth`) with the Prisma adapter. Server config at `apps/api/src/auth.ts` (email/password enabled, `disableSignUp: true`, `role` additional field `admin|agent`, `TRUSTED_ORIGINS` required, `BETTER_AUTH_SECRET` validated ≥32 chars, `rateLimit` enabled only in production). Server-side RBAC middleware at `apps/api/src/middleware/auth.ts` exports `requireAuth` and `requireAdmin` — apply to every protected route (frontend `AdminRoute` is UX, not security). Client at `apps/web/src/lib/auth-client.ts` exports `signIn` / `signOut` / `useSession` and reads `VITE_API_URL` for cross-origin baseURL. Cookie-based sessions — **not JWT**.
- AI: Anthropic SDK (Claude). Use **prompt caching** for the KB block.
- Email: Postmark inbound + outbound. Thread via `Message-ID` / `In-Reply-To` / `References`.
- Testing: see the `playwright-e2e-author` agent for the E2E setup (Playwright config, test DB, alt ports, env file, run/seed scripts).

## Security

- **Never render email HTML.** Inbound `htmlBody` is stored but never served: it is left out of `MESSAGE_SELECT` (`apps/api/src/routes/tickets.ts`) and out of the `ThreadMessage` wire type in `@ticket/shared` (`Omit<Message, "htmlBody" | "authorId">`), so a route that tried to send it wouldn't compile. The UI renders `textBody` as a React text node; HTML-only senders get a placeholder. Don't reach for `dangerouslySetInnerHTML`, and don't hand-roll a tag-stripper to fake a plain-text part — that is exactly how the hole reopens. Sanitizing (DOMPurify + sandboxed iframe) only comes up if rendering customer HTML becomes a real requirement.
- **Security headers ship from two places.** API: `helmet` in `apps/api/src/index.ts`, mounted above the Better Auth handler so auth responses are covered too, with `default-src 'none'` — the process only ever answers with JSON. Web: the policy is built by `cspDirectives` in `apps/web/vite.config.ts` and injected as a build-time `<meta>` tag, because `vite build` emits a static `dist/` and no host is fixed; `vite preview` serves the same policy as a real header and is the reference for whatever ends up hosting the build. **Production hosting must set that header** — `frame-ancestors` cannot travel in a meta tag.
- The web CSP holds `script-src 'self'` with no nonce/hash machinery, which is only true while the built `index.html` carries no inline script — check `dist/index.html` before relying on it. `style-src` needs `'unsafe-inline'` (shadcn's chart `<style>` element, plus Radix/Recharts/sonner style attributes); that is the accepted weak directive, and inline *scripts* stay blocked. `connect-src` is derived from `VITE_API_URL` at build time, so a new API origin means a rebuild, not just a redeploy.

## Commands

- `bun run --filter @ticket/web test` — run web component tests once (CI). Also `test:watch` (headless TUI) and `test:ui` (Vitest UI dashboard, best for authoring).

For E2E test commands (`test:e2e`, `db:test:*`), see the `playwright-e2e-author` agent.

Bun env gotchas: `bun --env-file=X x ...` and `bun --env-file=X run <script that calls bun>` do **not** propagate the env to the child — the inner `bun` re-loads default `.env`. For Prisma CLI use `dotenv-cli`. Workspace filter syntax is `bun run --filter <pkg> <script>`, not `bun --filter <pkg> run <script>`.

## Fetching documentation

Use the **context7** MCP server for any library, framework, SDK, API, or CLI question — React, Vite, Express, Prisma/Drizzle, Tailwind, shadcn/ui, Anthropic SDK, Postmark, `express-session`, `connect-pg-simple`, Bun, etc. Use it even for libraries you think you know; training data may lag behind current versions.

Flow: `mcp__context7__resolve-library-id` → `mcp__context7__query-docs`.

Prefer context7 over web search for library docs. Skip it for refactoring, business-logic debugging, or general programming concepts.

## Conventions

- **Never write new tests unless explicitly asked.** No new spec files, no new `it`/`test` cases, no new E2E specs — not "for coverage", not as a bonus after a feature, not proactively after a bug fix. Do not launch the `playwright-e2e-author` agent on your own initiative. When a change breaks an *existing* test, fix that test (or the code) as part of the change — that is maintenance, not new tests. If you think something needs coverage, say so in one line and move on; wait for the user to ask.
- Strict TS; no unused locals/params; `verbatimModuleSyntax` (use `import type` for type-only imports).
- Shared cross-app types live in `packages/shared` — don't duplicate `Ticket` / `User` / API contracts in the apps.
- Role values must reference the single source of truth in `@ticket/shared`: import the `USER_ROLE` runtime constant and the `UserRole` type. Compare and assign with `USER_ROLE.admin` / `USER_ROLE.agent` — never the bare `"admin"` / `"agent"` string literals, never inline `as "admin" | "agent"` casts, and never redefine the union in-app. This applies to app code, tests, fixtures, and third-party configs that take role literals (e.g. Better Auth `inferAdditionalFields`, use `[USER_ROLE.admin, USER_ROLE.agent]`).
- **Every UI control comes from shadcn/ui** — `apps/web/src/components/ui/`, added with `bunx --bun shadcn@latest add <component>`. Never hand-roll or substitute a native control (`<select>`, `<input type="checkbox">`, `<input type="radio">`, …): OS-drawn widgets ignore the theme tokens and cannot be styled to match. If shadcn has no component for what you need, **stop and ask** before building a custom one. Details in `apps/web/CLAUDE.md`.
- **zod schemas** live in `packages/core` (`@ticket/core`), organized by domain under `src/schemas/` (e.g. `schemas/users.ts`, `schemas/auth.ts`) and re-exported from `src/index.ts`. Define each schema once there, infer its TS type with `z.infer<typeof ...>`, and import from both client (`react-hook-form` + `zodResolver`) and server (`schema.safeParse(req.body)`). Don't redefine the same shape per-app or hand-roll equivalent `typeof`/regex checks on either side.
- Don't introduce JWT, Redis, a queue, or vector DB without a concrete need — `tech-stack.md` explicitly defers them.

Workspace-specific conventions live in `apps/api/CLAUDE.md` and `apps/web/CLAUDE.md`.
