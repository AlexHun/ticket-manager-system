# Cross-cutting conventions

Rules that bind in both workspaces.

## Code

- Strict TS; no unused locals/params; `verbatimModuleSyntax` (use `import type` for type-only imports).
- Shared cross-app types live in `packages/shared` — don't duplicate `Ticket` / `User` / API contracts in the apps.
- Role values must reference the single source of truth in `@ticket/shared`: import the `USER_ROLE` runtime constant and the `UserRole` type. Compare and assign with `USER_ROLE.admin` / `USER_ROLE.agent` — never the bare `"admin"` / `"agent"` string literals, never inline `as "admin" | "agent"` casts, and never redefine the union in-app. This applies to app code, tests, fixtures, and third-party configs that take role literals (e.g. Better Auth `inferAdditionalFields`, use `[USER_ROLE.admin, USER_ROLE.agent]`).
- **Every UI control comes from shadcn/ui** — `apps/web/src/components/ui/`, added with `bunx --bun shadcn@latest add <component>`. Never hand-roll or substitute a native control (`<select>`, `<input type="checkbox">`, `<input type="radio">`, …): OS-drawn widgets ignore the theme tokens and cannot be styled to match. If shadcn has no component for what you need, **stop and ask** before building a custom one. Details in [frontend.md](frontend.md).
- **zod schemas** live in `packages/core` (`@ticket/core`), organized by domain under `src/schemas/` (e.g. `schemas/users.ts`, `schemas/auth.ts`) and re-exported from `src/index.ts`. Define each schema once there, infer its TS type with `z.infer<typeof ...>`, and import from both client (`react-hook-form` + `zodResolver`) and server (`schema.safeParse(req.body)`). Don't redefine the same shape per-app or hand-roll equivalent `typeof`/regex checks on either side.
- **A hand-written mirror of a third-party shape takes that library's type by name, and its own fields are required-and-nullable rather than optional.** An interface whose fields are all `?:` accepts any SDK object you assign it, forever, including after the vendor moves the fields it was written against — the reads then return `undefined` and every `?? 0` downstream turns that into a confident zero. Measured 2026-09-09: `AiUsage` in `apps/api/src/ai/provider.ts` was written against the AI SDK v5 flat usage shape while the installed `ai` is v7, which nests the same values under `inputTokenDetails` / `outputTokenDetails`. It compiled cleanly and logged `cached=0 reasoning=0` for every AI call the app had ever made — the exact prompt-caching alarm [ai-features.md](ai-features.md) says to watch, reading as a measurement rather than a break. Optionality is what made it silent: an absent optional field is a legal value, so structural typing had nothing to say. What _did_ catch it was a fixture forced to build the nested shape because the error constructor was typed on the SDK's own `LanguageModelUsage` — **where the SDK type was named, the compiler told the truth.** So: (1) map through a named adapter function that takes the vendor type by name, so the next bump fails to compile at one line, and (2) declare app-side fields `number | undefined`, not `number?`, so the adapter cannot drop one. The cost is fixtures spelling out what they aren't measuring, which a small helper absorbs.
- Don't introduce JWT, Redis, a queue, or vector DB without a concrete need — `tech-stack.md` explicitly defers them.

## Formatting and git hooks

**Prettier owns formatting; nobody hand-formats and nobody argues about it.** `bun run format` writes, `bun run format:check` reports. The config is `.prettierrc` and it is one line, because the defaults are what this codebase already was — measured, not assumed: at Prettier's default 80 columns a whole-repo run rewrote 176 source files, at 100 it rewrote 245, and only 2,497 of 68,204 lines exceeded 80 to begin with.

- **The one override is `endOfLine: "auto"`, and it is load-bearing on Windows.** This repo is developed with `core.autocrlf=true`, so the working tree is CRLF while the object store is LF. Prettier's default `"lf"` compares against the file on disk, so every file would report as unformatted forever on a fresh Windows checkout — and CI, which checks out LF, would disagree with the developer's machine about a repo neither had touched. `"auto"` takes each file's existing endings, which is LF on CI and CRLF here, and both are right.
- **`.husky/*` is pinned to LF in `.gitattributes`, and that is the exception to the above.** Hooks are executed by `sh`; checked out with CRLF, `sh` reads the stray `\r` as part of the last argument on every line. Nothing else in the tree is pinned — a repo-wide `eol=lf` would rewrite every working copy on the next checkout for no gain.
- **`.claude/` and `.agents/` are in `.prettierignore`.** Most of those skills are vendored from upstream repos and pinned by content hash in `skills-lock.json`; reformatting one changes its hash and puts this repo permanently out of sync with its source. The repo-authored skills sit in the same trees, so both are excluded whole rather than by a per-skill list that would rot.

**Two hooks, split by what they cost.** Husky installs them from `.husky/`; `bun install` runs the `prepare` script that wires `core.hooksPath`, so a fresh clone needs no extra step. (Husky exits 0 when there is no `.git` — which is what the Dockerfiles' `bun install --frozen-lockfile` hits, since `.dockerignore` excludes `.git`.)

- **`pre-commit` — `lint-staged` then `bun run typecheck`, ~20s.** lint-staged runs Prettier over the _staged_ files and re-stages what it rewrites, so what lands is already formatted. The pattern in `.lintstagedrc` is a bare `*` with `--ignore-unknown`, so `.sql` migrations, `schema.prisma` and the `.png` fixtures pass through instead of erroring for want of a parser.
- **`pre-push` — `bun run typecheck` then `bun run test`, ~5.5 min.** Both unit suites, plus a typecheck the commit hook may never have run (a `--no-verify`, another tool's commit, a rebase). The suites are here and not on `pre-commit` because of what they measure on a Windows dev machine: `@ticket/api` ~28s, `@ticket/web` ~4m54s — the web suite is jsdom-bound and Windows runs ~4x slower than `ubuntu-latest` (see [testing.md](testing.md)). A five-minute pre-commit is one people learn to `--no-verify` around, which costs more than it saves. E2E is in neither: it needs Postgres, a migrated `ticket_manager_test` and two servers on alt ports (`SCRIPTS.md`), and CI's `e2e` job owns it.
- **CI re-runs `format:check` anyway** (`.github/workflows/ci.yml`), for the same reason it re-runs typecheck: lint-staged only ever sees staged files, so a `--no-verify` or a merge would otherwise carry unformatted code to `main` unnoticed. A hook is a fast local loop, not a gate.

The whole-repo reformat is one commit, listed in `.git-blame-ignore-revs`. GitHub's blame view reads that file automatically; locally it is `git config blame.ignoreRevsFile .git-blame-ignore-revs`, once per clone.

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
