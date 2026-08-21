# Cross-cutting conventions

Rules that bind in both workspaces.

## Code

- Strict TS; no unused locals/params; `verbatimModuleSyntax` (use `import type` for type-only imports).
- Shared cross-app types live in `packages/shared` — don't duplicate `Ticket` / `User` / API contracts in the apps.
- Role values must reference the single source of truth in `@ticket/shared`: import the `USER_ROLE` runtime constant and the `UserRole` type. Compare and assign with `USER_ROLE.admin` / `USER_ROLE.agent` — never the bare `"admin"` / `"agent"` string literals, never inline `as "admin" | "agent"` casts, and never redefine the union in-app. This applies to app code, tests, fixtures, and third-party configs that take role literals (e.g. Better Auth `inferAdditionalFields`, use `[USER_ROLE.admin, USER_ROLE.agent]`).
- **Every UI control comes from shadcn/ui** — `apps/web/src/components/ui/`, added with `bunx --bun shadcn@latest add <component>`. Never hand-roll or substitute a native control (`<select>`, `<input type="checkbox">`, `<input type="radio">`, …): OS-drawn widgets ignore the theme tokens and cannot be styled to match. If shadcn has no component for what you need, **stop and ask** before building a custom one. Details in [frontend.md](frontend.md).
- **zod schemas** live in `packages/core` (`@ticket/core`), organized by domain under `src/schemas/` (e.g. `schemas/users.ts`, `schemas/auth.ts`) and re-exported from `src/index.ts`. Define each schema once there, infer its TS type with `z.infer<typeof ...>`, and import from both client (`react-hook-form` + `zodResolver`) and server (`schema.safeParse(req.body)`). Don't redefine the same shape per-app or hand-roll equivalent `typeof`/regex checks on either side.
- Don't introduce JWT, Redis, a queue, or vector DB without a concrete need — `tech-stack.md` explicitly defers them.

## Fetching documentation

Use the **context7** MCP server for any library, framework, SDK, API, or CLI question — React, Vite, Express, Prisma/Drizzle, Tailwind, shadcn/ui, Anthropic SDK, Postmark, `express-session`, `connect-pg-simple`, Bun, etc. Use it even for libraries you think you know; training data may lag behind current versions.

Flow: `mcp__context7__resolve-library-id` → `mcp__context7__query-docs`.

Prefer context7 over web search for library docs. Skip it for refactoring, business-logic debugging, or general programming concepts.

## Driving a real browser

The **chrome-devtools** MCP server is registered in **`.mcp.json`** — project-scoped and checked in, so everyone gets the same one. It drives a real Chrome: navigation, DOM, console, network, performance traces. Use it to look at the running app; use Playwright for anything that should still be true tomorrow.

It runs the workspace's pinned `chrome-devtools-mcp` through `bunx`, **not** `npx chrome-devtools-mcp@latest`. The version is the lockfile's, the same way every other dependency here is, and a tool that silently upgrades itself mid-session is one that changes behaviour for reasons no commit explains. Chrome is launched lazily on the first tool call, not at startup, and `--channel` picks a non-stable one if the machine has no stable install.

`.mcp.json` is JSON and cannot hold comments, so the flags are explained here:

- **`--redactNetworkHeaders`** is the load-bearing one. Sessions in this app are **cookies, not JWT**, so without it the network tools would pull a live `Cookie` / `Set-Cookie` session token into the transcript the moment anyone inspected a request. Don't drop it to "see the real headers" — sign-in problems here are almost always `SameSite`/origin issues, which the `COOKIE_DOMAIN` note in `auth.ts` covers without needing the token itself.
- **`--isolated`** gives each run a throwaway profile and never touches a real Chrome profile. It also means every session starts signed out, which is the honest state to debug an auth-gated app from; the seeded credentials are one form fill away.
- **`--viewport=1280x720`** matches Playwright's `devices["Desktop Chrome"]`. `tickets.spec.ts` asserts column widths, that the header stays put while rows scroll, and that the window never scrolls — debugging at some other size would disagree with those for reasons that are not bugs.
- **`--usageStatistics=false`** and **`--performanceCrux=false`** stop it calling outward. CrUX ships trace URLs to a Google API, which for a localhost dev server is noise at best.
- **`--screenshotFormat=webp`** with **`--screenshotMaxWidth=1280`**: screenshots are by far the biggest thing this server puts in context, and a full-size PNG of this dashboard buys nothing a WebP does not.
