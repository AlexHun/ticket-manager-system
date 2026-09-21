# PRD: The dev server's node half has nothing to test through

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-09-21

## Problem

`apps/web/dev/` is the node half of the three `/__dev` tools — a Vite plugin
serving seven routes, a project scanner, a suite runner and a run queue. Six
source modules, **1,765 lines of which have no test at all**: `scan.ts` (1,158),
`suites.ts` (466) and `child-env.ts` (141). `plugin.test.ts` contains exactly one
`describe`, and it covers one of the seven routes. `graph`, `suites`, `events`,
`start`, `cancel` and `clear` have none.

This is not an oversight, it is a shape. Each of those surfaces creates what it
depends on instead of accepting it:

- `scan.ts` reads the real repository tree from `REPO_ROOT`, a module constant
  computed at import from `import.meta.dirname`. There is no way to point it at
  a fixture, so any test of it would assert against this repository's own
  current file layout.
- The run queue — `runs`, `listeners`, `active`, `queue`, and the mutually
  recursive `drain`/`startRun` — is closure state inside `devToolsPlugin()` with
  no accessor. The only way to observe whether a run queued or started is to
  mount the plugin and read an SSE stream, and `plugin.test.ts`'s request helper
  assumes exactly one JSON write per request, so it cannot drive
  `text/event-stream` at all.
- `suites.ts` spawns child processes, and the suite it can launch binds ports
  3002/4001 and resets the test database. A test that actually runs it is a test
  that runs the whole E2E suite.

The one route that _is_ tested shows what the difference costs. `plugin.test.ts`
exists, in its own words, "for one bug, and for the reason that bug survived five
green E2E cases": the spec sets `CLAUDE_TRANSCRIPT_DIR`, which is the point of
the override and also means it never reaches the branch that derives a directory
when nothing is set. That branch shipped wrong, and everyone who pressed Scan on
a fresh checkout got ENOENT. The fix — `resolveTranscriptDir(env, { cwd })`,
taking the root as an argument — is the only seam in the directory, and it is
the only route with a test.

## Users

The developer working in this repository, and specifically the one **changing
the dev tooling** — who today has one honest way to find out whether a change
works, which is to restart the dev server and press the button.

That loop is worse than it sounds. Editing anything under `apps/web/dev/`
restarts the dev server, because it is a `vite.config.ts` dependency, which
cancels any run in flight. `bun --hot` leaves stale workers and stale workspace
packages. So the feedback loop for 1,765 untested lines is "restart, click,
squint".

## Success metrics

| Metric                                                     | Today                          | Target              |
| ---------------------------------------------------------- | ------------------------------ | ------------------- |
| Lines in `apps/web/dev/` with no test                      | 1,765                          | under 400           |
| Plugin routes with a test                                  | 1 of 7                         | 7 of 7              |
| Ways to observe the run queue's state                      | 1 — mount the plugin, read SSE | 1 — call the module |
| Modules that take their root or their spawn as an argument | 1 (`resolveTranscriptDir`)     | all of them         |
| Time to find out whether a scanner change works            | dev-server restart + a click   | a test run          |
| _Guardrail:_ what `/__dev/map` and `/__dev/tests` show     | —                              | unchanged           |

## Scope

### In this pass

| #   | Requirement                                                                                                                                           | Priority |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | The project scan can be run against a directory named by the caller, and produces the same shape of result for a fixture tree as for this repository. | Must     |
| R2  | Every one of the plugin's seven routes has a test that reaches it through the plugin, not around it.                                                  | Must     |
| R3  | Whether a run queued, started, was cancelled or was cleared is assertable without reading an event stream.                                            | Must     |
| R4  | A test can drive the run queue without spawning a real process, binding a port or touching a database.                                                | Must     |
| R5  | The environment a spawned child receives is assertable from a test — including which keys were stripped and which runtime it will find on `PATH`.     | Must     |
| R6  | A test exists for every branch that derives a value when no override is set, not only for the branch the override takes.                              | Must     |
| R7  | What the three `/__dev` pages display, and what the plugin's seven routes return, is unchanged.                                                       | Must     |
| R8  | A failure inside a route handler is reported as a 500 with a readable body, and that is covered by a test.                                            | Should   |

### Non-goals

- **Testing what `scan.ts` concludes about this repository.** R1 is about being
  able to point it somewhere; asserting that this repo has 14 modules in a layer
  is a test that fails on every future commit. Fixture trees only.
- **Actually running a suite in a test.** R4 is explicit: a fake spawn. The real
  runner is covered by the fact that the repo's own suites run.
- **Rewriting `scan.ts`'s parser.** It is regex-over-source with comments
  stripped, deliberately not a TS AST, and anything it cannot parse lands in
  `warnings` rather than being dropped. That decision stands; this PRD gives it
  a fixture, not a new parser.
- **The browser half.** `apps/web/src/dev/` is
  [usage-page-module-seams.md](usage-page-module-seams.md).
- **Raising coverage as a number.** Nothing here has a coverage target; the
  metric is untested _lines in these files_, because the specific 1,765 are the
  point.
- **`apps/web/dev/usage.ts` and `issues.ts`.** They already have tests and a
  working override seam — they are the model this PRD copies, not its subject.

## Constraints

- **The dev server runs on Bun** (`bunx --bun vite`), and `--bun` puts a fake
  `node` on `PATH` plus `NODE=…/bun-node-*/node.exe`. `childEnv` exists to strip
  that and every key the repo's `.env*` files declare; R5 must not weaken it.
  `execFileSync`'s `timeout` does not work in that process — any spawn from a
  middleware is async or it is wrong (measured, #249).
- **Editing anything in `apps/web/dev/` restarts the dev server** and cancels a
  run in flight. That is the loop this PRD is trying to make unnecessary, and it
  also means the work itself is slow to do by hand.
- **Relative imports in this directory carry their `.ts` extension** and use
  `import.meta.dirname`, for Vite's `configLoader: 'native'`.
- **`/__dev` is never shipped** — kept out by `import.meta.env.DEV` in `App.tsx`
  and `nav-items.ts`, which Vite folds to `false`. A new entry point here needs
  `.vite/stats.html` checked after a build.
- **An E2E override hides the branch beneath it.** `playwright.config.ts` points
  the web server at a fixture transcript directory and a fixture issue listing,
  which is correct and is also exactly why R6 exists as its own requirement.
- **`reuseExistingServer` will adopt a leftover Vite on 4001** started without
  those overrides, which reads as a missing row rather than the wrong server.
  Anyone verifying this work checks the port owner first.

## Risks

| Risk                                                                                              | Impact                                                                                                   | Mitigation                                                                                            |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Threading a root through `scan.ts` touches 1,158 lines at once                                    | A mechanical change large enough that a real edit hides inside it                                        | The root becomes a parameter in one commit with no other change; the fixture tree arrives in the next |
| A fake spawn diverges from the real one and the queue's tests pass against a fiction              | R3 and R4 hold while the real runner is still broken                                                     | Two adapters, and the real one stays the default; the fake is only reachable from a test              |
| SSE replay and the dropped-line counter are duplicated either side of the stream (4,000 vs 3,000) | A queue test asserts one cap while the page enforces the other                                           | R3 names the queue's own state as the assertable thing, not the stream's                              |
| `childEnv`'s `REPO_ROOT` is computed at module load                                               | R5 cannot be tested without importing the module fresh per case, which `mock.module`'s registry punishes | Take the root as an argument, like everything else here                                               |
| Seven route tests are written and six of them assert a stub                                       | Coverage goes up and nothing is actually held                                                            | R2 says "through the plugin, not around it" — the existing usage tests are the worked example         |

## Open questions

- [ ] Is the run queue extracted as its own module, or does the plugin expose it
      for tests? The first is a real seam with two adapters; the second is a
      hole in an interface. — _affects R3 and R4_, decide in the plan
- [ ] **Assumed:** "under 400 untested lines" means `child-env.ts` gets covered
      and some of `suites.ts`' process plumbing stays untested. Confirm the
      right remainder.
- [ ] **Assumed:** a fixture tree for R1 is checked into
      `tests/` or `apps/web/dev/__fixtures__/` rather than generated per test.
      Generated would be smaller but makes a scanner test unreadable.
- [ ] **Assumed:** R2's six new route tests can use the existing `mountPlugin`
      helper for everything except `events`, which needs a streaming-capable
      request helper written for it.
- [ ] **Assumed:** none of this needs a change to what the three pages fetch.
      R7 says so; nothing has checked whether `/graph`'s response shape is
      reachable from a fixture tree without loosening it.
