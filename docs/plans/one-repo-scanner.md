# Plan: One scanner for the repo's own tooling

**PRD:** [docs/prd/one-repo-scanner.md](../prd/one-repo-scanner.md) · **Status:** Draft · **Date:** 2026-10-16

## Layers crossed

```
callers  apps/api/src  standards-guard.test.ts, validation-copy.test.ts, doc-citations.ts (→ scripts/graph.ts)
         apps/web/dev  standards-guard.test.ts, scan.ts (project map), usage-store.ts, issues.ts, child-env.ts
  → new: tools/repo-scan (@ticket/repo-scan): stripComments, offendingLines + the rule shape,
                                            trackedFiles, repositoryFreeEnv
    → git (ls-files, rev-parse --local-env-vars), gh
```

No app, route, schema or database layer is involved. Nothing ships to production
except the Dockerfiles' extra manifest line.

## Why `tools/`, and the constraint that shapes it

- **`tools/lint` set the precedent** (`conventions.md`, Lint): repo tooling that
  both apps need is a workspace of its own under `tools/`, not a module inside
  one app. `packages/` is for code the apps ship. A new workspace's
  `package.json` is one more manifest each Dockerfile copies before
  `bun install --frozen-lockfile` (`deployment.md`). Slice 1 adds that line to
  both.
- **`apps/web/dev` is loaded by Vite's native config loader**, which resolves
  nothing extensionless and requires `.ts` on relative imports (`frontend.md`,
  the `dev/` bullet). So every import inside `tools/repo-scan` carries its
  extension, and the package has no `index.ts` that re-exports extensionless
  (the `@ticket/core` failure #428 recorded). Whether the loader takes the bare
  workspace specifier at all, or the web needs a relative path into `tools/`,
  is slice 1's first question.
- **Its own tests run under `bun test`**, like `@ticket/shared`. CI runs them in
  the `check` job beside `@ticket/shared`'s. They are not in `pre-push`. The
  checks that must run before a push (R4, and the guards themselves) stay in the
  API suite, which is.

## The done bar, and why it changes here

The skill's bar is a Playwright spec per slice. As in
`docs/plans/doc-citations.md`, this has no UI, and its checks run in `pre-push`,
which E2E runs outside of. Each slice is done when:

- every check it touches is green on the real tree;
- each one catches every planted violation it is shown and passes every planted
  exemption;
- each one fails if its file list comes back empty;
- `git push` runs the API-side ones, and CI runs the rest.

## Slice 1 — One comment stripper

**Retires:** whether the two strippers differ in some way no comment records, and
whether Vite's config loader, the Dockerfiles and CI all take a new workspace.
**Covers:** R1

- `tools/repo-scan` is created with `stripComments`. Before the copies are
  merged, both are run over every tracked JS, TS and JSON file and their
  outputs are diffed. Any difference becomes a fixture in the shared stripper's
  tests. The diff result is recorded in the PR.
- It returns the web copy's `{ code }` shape, because the project map's
  endpoint matcher reads template contents from it. The API readers take
  `.code`.
- Both guards, `validation-copy.test.ts`, `doc-citations.ts` and `scan.ts` import
  it. `apps/api/src/strip-comments.ts` and the copy in `scan.ts` are deleted,
  along with each header's "a fix belongs in both".
- Both Dockerfiles copy the new manifest, and CI's `check` job runs its tests.

**Hardcoded for now:** each guard keeps its own runner and disk walk (slice 3);
the git cleanup still exists twice (slice 2).

**Done:** both guards and `validation-copy` are green, unchanged in what they
catch. `bun run dev` starts with no config-loader warning, `/__dev/map` still
draws the routes (`tests/e2e` has no spec for it, so this is checked by hand and
said so in the PR), and both images build locally with `docker build`. CI does
not build them, so the first proof on Railway is the `develop` deploy after
merge, which the PR names as the thing to watch.

## Slice 2 — One git cleanup, and a check that every spawn uses it

**Retires:** the latent #531 gap in `usage-store.ts`. **Covers:** R3, R4

- `repositoryFreeEnv` and its variable list move into `tools/repo-scan`. A test
  there compares the list with `git rev-parse --local-env-vars` on the machine
  running it and fails on a variable missing from the list.
- `gitEnv` in `usage-store.ts` becomes `childEnv` with the shared cleanup applied
  on top, so the secret-stripping half stays (PRD constraint). `issues.ts`'
  `gh` spawn takes the same environment. `doc-citations.ts` imports the shared
  cleanup.
- A new check in the API suite reads the tracked files under `apps/` and
  `scripts/`. It fails on any spawn of `git` or `gh` whose environment does not
  come from the cleanup. Planted cases: an `execFileSync("git", …)` with no
  `env`, and a `spawn("gh", …)` passing `process.env`. The ones it must pass are
  the existing callers.
- A test in `usage-store.test.ts` runs its `git` call with `GIT_DIR` and
  `GIT_INDEX_FILE` pointing at a second repository. The call must still answer
  for `cwd`'s. This is #531's case, carried over.

**Done:** the bar above, plus the planted `GIT_DIR` case red against today's
3-variable `gitEnv` and green after.

## Slice 3 — One rule runner, over tracked files

**Retires:** the guards' drift in rule shape and in the files they read.
**Covers:** R2, R5
**Un-hardcodes:** each guard's own `offendingLines`, rule type and disk walk.

- `tools/repo-scan` gains the rule shape (`forms`, `allowed`, `applies`,
  `catches`, `passes`, `ignores`), `offendingLines`, and a function that turns a
  rule table into its per-rule checks. That covers holds-across-the-tree,
  allowlist-exists, catches, passes and ignores. It takes the test runner's
  `describe`/`test`/`expect` as arguments, so the same function serves
  `bun:test` and Vitest.
- `trackedFiles` moves there from `doc-citations.ts`. Both guards and
  `validation-copy.test.ts` read their files through it. The hand-written
  `src/generated` exclusion is deleted; the `prisma/` and `prisma.config.ts`
  additions become path filters over tracked files.
- Each guard's "reads the tree it means to" test stays, with the same sentinels.

**Done:** the bar above. Every existing `catches`/`passes`/`ignores` example
passes unedited (the PRD guardrail), and the file count each guard reads is
recorded before and after in the PR, with any difference explained.

## Slice 4 — Rules reach `packages/` and `scripts/`

**Retires:** the breaches that may already be there. **Covers:** R6, R7

- The API guard reads `packages/` and `scripts/` too. Each existing rule states
  which roots it covers. A rule is widened in its own commit, and a real breach
  is fixed or allowlisted with a reason (PRD risk).
- Each guard file is left with its rule table and the runner call. Anything else
  that is still duplicated between them moves into `tools/repo-scan`.

**Done:** the bar above, with the rules widened. The PR lists each rule and the
roots it now reads.

## Requirement coverage

| Req | Slice | Note                                    |
| --- | ----- | --------------------------------------- |
| R1  | 1     |                                         |
| R2  | 3     |                                         |
| R3  | 2     |                                         |
| R4  | 2     | in the API suite, so `pre-push` runs it |
| R5  | 3     | `validation-copy` included              |
| R6  | 4     | Should                                  |
| R7  | 4     | Should                                  |

## Spikes

- **Does Vite's native config loader import a bare workspace specifier whose
  files are `.ts`?** Timebox 1h, the first hour of slice 1. If it does not, the
  web's `dev/` imports the package by a relative path into `tools/` and the PR
  says why.

## Deferred

- **The `.claude/hooks/*.mjs` git calls** (PRD non-goal).
- **New rules** (PRD non-goal). Slice 4 only says where existing ones apply.
- **An E2E spec for the project map.** Slice 1 checks it by hand. A spec would
  be a ticket of its own; `docs/plans/dev-server-test-seams.md` named one and
  it was never written.
