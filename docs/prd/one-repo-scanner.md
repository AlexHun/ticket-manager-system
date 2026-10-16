# PRD: One scanner for the repo's own tooling

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-10-16

## Problem

The checks this repo runs over its own source are built from four pieces, and
each piece exists twice:

- **The comment stripper.** `apps/api/src/strip-comments.ts` and
  `apps/web/dev/scan.ts`'s `stripComments` are the same character scanner.
  One returns a string and the other returns `{ code }`, and each one's header
  says "a fix to either copy belongs in both". There are three readers on the
  API side (`standards-guard.test.ts`, `doc-citations.ts`,
  `validation-copy.test.ts`) and two on the web side.
- **The rule runner.** `offendingLines` is identical in the two standards guards,
  down to its comments, apart from the name of the rule type it takes. The rule shape around it has already drifted: only the web guard's
  rules can say what must `pass`.
- **The file list.** Both guards walk the disk with hand-written exclusions
  (`src/generated`, by name). `doc-citations.ts` reads git's tracked files
  instead, on purpose. So a guard reads files CI never sees, and every new
  generated directory needs another exclusion. Neither guard reads `packages/`
  or `scripts/`, so a rule like "the generated Prisma client is imported only
  by `./db`" has no say there at all.
- **The git environment cleanup.** The one in `apps/api/src/doc-citations.ts`
  removes the 15 variables `git rev-parse --local-env-vars` lists. #531 was
  `pre-push` reaching a git call with `GIT_DIR` set, which pointed it at the
  wrong repository. `gitEnv` in `apps/web/dev/usage-store.ts` removes 3 of them.
  **No failure has been observed**: nothing that calls `gitEnv` runs inside a
  git hook today. The first caller that does (running the web suite in
  `pre-push`, or `bun run tokens` from a hook) inherits #531 again.

Each fix so far has landed in one copy, and each review has had to ask whether
the other copy needs it too.

## Users

The developer, and the agents working tickets here. Both edit and extend these
checks. The job: add or fix a rule, or fix the scanner, in one place, and know
that every check that reads source sees the change.

## Success metrics

| Metric                                                                        | Today | Target    |
| ----------------------------------------------------------------------------- | ----- | --------- |
| Copies of the comment stripper                                                | 2     | 1         |
| Copies of the rule runner (`offendingLines` and the rule shape)               | 2     | 1         |
| Copies of the git environment cleanup                                         | 2     | 1         |
| _Guardrail:_ every existing rule's `catches`, `passes` and `ignores` examples | green | unchanged |

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                                       | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | One comment stripper serves every reader in both apps. A fixture that a copy handled wrongly before (a comment opener inside a string, a regex literal, a template literal) is asserted once.     | Must     |
| R2  | One rule runner serves both standards guards. Any rule in either guard can state `catches`, `passes`, `ignores` and an allowlist, and the runner checks that every allowlisted file exists.       | Must     |
| R3  | Every `git` and `gh` process spawned from `apps/` or `scripts/` runs without any of the variables `git rev-parse --local-env-vars` lists, through one cleanup.                                    | Must     |
| R4  | A test fails if a module in `apps/` or `scripts/` spawns `git` or `gh` without going through that cleanup.                                                                                        | Must     |
| R5  | Both standards guards and the validation-copy check read git's tracked files, so a local run and CI check the same set, and no exclusion for a generated or ignored directory is written by hand. | Must     |
| R6  | The guards' rules can apply to `packages/` and `scripts/`, and each existing rule states which of them it covers.                                                                                 | Should   |
| R7  | Each guard's file then holds its rule table and nothing else it would have to copy from the other.                                                                                                | Should   |

### Non-goals

- **The `.claude/hooks/*.mjs` hooks.** They are plain `.mjs` run outside either
  workspace and cannot import TypeScript. Their own git calls stay as they are.
- **New rules.** This pass moves the machinery. It neither adds nor removes what
  any guard bans, except that R6 decides where each existing rule applies.
- **The project map's endpoint matcher** in `apps/web/dev/scan.ts`. It reads the
  stripper's output and keeps doing so. The rest of the map is unchanged.
- **`doc-citations.ts`' behaviour.** It already reads tracked files and cleans the
  environment. It becomes a caller of the shared pieces, not a different check.
- **The other candidates from the 2026-10-16 architecture review.** Each has its
  own PRD.

## Constraints

- **The API's `tsconfig` covers `src/` only**, and the web's dev tooling runs
  under Vite. Wherever the shared pieces live has to be importable from both
  without either workspace reaching into the other's source.
- **Two test runners.** The API suite is `bun test` and the web suite is Vitest
  (`testing.md`, `testing-api.md`). The shared pieces' own tests run in one of
  them. Neither guard may start depending on the other's runner.
- **`pre-push` runs the API suite and not the web suite** (`.husky/pre-push`).
  R4's test belongs where it runs before a push.
- **`conventions.md`** governs a new workspace package or dependency if the plan
  chooses one.
- **`usage-store.ts`' cleanup starts from `childEnv`**, which also removes every
  variable the repo's `.env*` files declare. R3 adds the git variables to that.
  It must not drop the secret-stripping half.

## Risks

| Risk                                                                                  | Impact                                                   | Mitigation                                                                                      |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The two strippers differ in a way no comment records                                  | A merged stripper changes what one guard or the map sees | Run both copies over every tracked file before merging them, and diff the outputs               |
| R5 drops a file a guard read before (an untracked file a developer has not yet added) | A local run misses a breach until the file is committed  | Acceptable: CI and `pre-push` both see committed files, which is the set that ships             |
| R6 turns a rule on for `packages/` and finds existing breaches                        | The first slice that widens a rule goes red              | Each rule is widened in its own commit, and a real breach is fixed or allowlisted with a reason |
| A git that adds a local variable leaves the written-out list short                    | The same class as #531, later                            | R3's test compares the list with `git rev-parse --local-env-vars` on the machine running it     |

## Open questions

- [ ] Where do the shared pieces live: a new workspace package, or a path both
      `tsconfig`s reach? — _affects R1–R3_, decide in the plan
- [ ] Which suite owns the shared pieces' own tests? — _affects R1, R2_, decide
      in the plan
- [ ] **Assumed:** `gh` goes through the same cleanup as `git`, since it resolves
      the repository from git's environment the same way.
- [ ] **Assumed:** `validation-copy.test.ts` keeps its own literal matcher,
      since it is not a rule runner. It moves onto the one stripper (R1) and
      onto tracked files (R5) like the guards.
