# Testing standards

## Commands

- `bun run --filter @ticket/web test` — run web component tests once (CI). Also `test:watch` (headless TUI) and `test:ui` (Vitest UI dashboard, best for authoring).
- `bun run --filter @ticket/api test` — run API unit tests. Runner is **`bun test`**, not Vitest: the API workspace already runs on Bun and carries no test runner, and `mock.module` covers what these need. Provider, database and session are all mocked, so no `OPENAI_API_KEY` and no database.

For E2E test commands (`test:e2e`, `db:test:*`), see the `playwright-e2e-author` agent.

## API tests (`apps/api`)

- Tests: **`bun test`** (`bun run --filter @ticket/api test`), files next to the source as `*.test.ts`. `mock.module(specifier, factory)` must be registered *before* the module under test is imported, so the module under test comes in through a dynamic `await import(...)` at the top of the file rather than a static import. Spread the real module into the factory (`{ ...actual, generateText }`) when only one export is being replaced — the constants and error classes the code branches on have to stay real or the test asserts against its own stub. `../db` and `../middleware/auth` are the two mocks almost every route test needs: the first opens a database connection at import, the second pulls in `../auth`, which throws without `BETTER_AUTH_SECRET`.
  - **The registry is one process wide and nothing resets it between files.** Every test file's `mock.module` calls and every module they import share it, so two files that mock the same specifier and import the same module are not independent: the module binds to whichever fake was registered when it was first imported, and the other file's tests then run against a stranger's stub. Two consequences, both learned the hard way. A factory that does not spread the real module *is* that module for every file loaded afterwards — `routes/ai.test.ts` and `automation.test.ts` therefore ship the **same** `../middleware/auth` stub, identical headers and defaults, and export `requireAuth` and `requireAdmin` whether or not the file under test uses both. And when two suites would need the same module bound to different fakes, put them in **one file** — `automation.test.ts` covers `automation.ts` and `routes/automation.ts` together for exactly that reason. The failure mode to watch for is a file that passes alone and fails in the suite; run `bun test <a> <b>` in both orders before believing a new mock.
  - **Every `../db` (or `./db`) factory must export `Prisma`**, whether or not the file under test touches it: `const { Prisma } = await import("../generated/prisma/client")` next to the `mock.module` call, exactly as `routes/activity.test.ts` does. `routes/activity.ts`, `routes/ticket-stats.ts` and `routes/ticket-effectiveness.ts` import it as a *value* (`Prisma.sql` composes their raw queries), so a factory that leaves it out can be the one in force when one of those modules is linked, and the run dies with `SyntaxError: Export named 'Prisma' not found in module .../src/db.ts`. **This is intermittent, and that is the point** — it depends on the order `bun test` reaches the files in, so the same commit can go red on one run and green on a re-run of that same run (measured: run 33737874918, 210 pass / 2 errors, then 237 pass on re-run with no code change). Five factories were missing it and were fixed together; don't reintroduce one.

## Component tests (`apps/web`)

- Component tests: **Vitest** + **React Testing Library** + **jsdom**. Test files live next to the component as `*.test.tsx` (e.g. `apps/web/src/pages/UsersPage.test.tsx`). Vitest config is inlined in `apps/web/vite.config.ts` (`globals: true`, `environment: "jsdom"`); jest-dom matchers and RTL `cleanup` are wired in `apps/web/src/test/setup.ts`. Always render with `renderWithQuery(ui, { initialEntries? })` from `@/test/render` — it provides a fresh `QueryClient` (`retry: false`, `gcTime: 0`) and a `MemoryRouter`. Mock module boundaries with `vi.mock`: stub `@/lib/api` (axios) and `@/lib/auth-client` (`useSession`) so tests don't touch the network or the session. (`@/lib/theme` used to be listed here and does not exist — the app is dark-only. The one thing that does read `localStorage` is `@/lib/use-row-density`, which needs no stub: it is wrapped in try/catch and jsdom provides storage.) Prefer accessible queries (`getByRole`, `getByLabelText`) over class/text selectors. Don't try to E2E-style log in here — that lives in Playwright (see the `playwright-e2e-author` agent).

Radix floating-layer widgets need a click-the-trigger approach rather than `selectOptions` — see [frontend.md](frontend.md).

## E2E

- Testing: see the `playwright-e2e-author` agent for the E2E setup (Playwright config, test DB, alt ports, env file, run/seed scripts).

## Scripts and environment

**Every script and all three seeds are catalogued in `SCRIPTS.md`** — what each writes, which of the three environments it belongs to, and the fresh-machine and first-deploy orders. Go there before guessing at a command; the sharp part is which ones may point at production (`db:seed` and `db:seed:kb` yes, `db:seed:tickets` and `db:migrate` never).
Bun env gotchas: `bun --env-file=X x ...` and `bun --env-file=X run <script that calls bun>` do **not** propagate the env to the child — the inner `bun` re-loads default `.env`. For Prisma CLI use `dotenv-cli`. Workspace filter syntax is `bun run --filter <pkg> <script>`, not `bun --filter <pkg> run <script>`.
