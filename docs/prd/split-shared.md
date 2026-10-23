# PRD: `@ticket/shared` split by domain

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-10-17

## Problem

All of `@ticket/shared` lives in one file. `packages/shared/src/index.ts` is
3,545 lines and holds 267 exports, from ticket statuses to the demo's limit
messages and the brand name. About 270 files across both apps, `@ticket/core`
and the Playwright specs import it.

The file already sorts itself into about fifteen domain blocks that do not
overlap: tickets, events, AI responses, users, knowledge, dashboard stats,
pipeline, evals, outbox, activity, tutorials, new features, dashboard layout,
changelog, demo and brand. Nothing on disk marks where one block ends.
So a reader looking for the eval vocabulary scrolls past 2,000 lines it does
not need, and a doc that cites "`packages/shared/src/index.ts`" points at all
of it. ADR-0019 cites a line number that has already moved.

The file changed in 24 of the last 300 commits, mostly as copy and pipeline
work. Nothing has broken because of its size. The gain here is locality only,
which is why the 2026-10-16 architecture review rated it Speculative.

## Users

The developer, and the agents working tickets here. The job: find, read and
change one domain's shared vocabulary without loading the rest, and cite it
by a path that names that domain.

## Success metrics

| Metric                                                   | Today       | Target    |
| -------------------------------------------------------- | ----------- | --------- |
| Lines in the largest file under `packages/shared/src`    | 3,545       | ≤ 600     |
| Definitions in the package's index                       | 267 exports | 0         |
| _Guardrail:_ files whose `@ticket/shared` import changes | —           | 0         |
| _Guardrail:_ the API suite in both of CI's file orders   | green       | unchanged |

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                                                    | Priority |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | Each domain's exports live in a file of their own under `packages/shared/src`, and no file there is over 600 lines. The tickets block (about 730 lines) and the evals block (about 780) each become two files. | Must     |
| R2  | The package's index holds re-exports only, and the package exports exactly the same names, with the same types and values, as before the split.                                                                | Must     |
| R3  | Every caller still imports the bare `@ticket/shared`. No import line outside the package changes, and the package's `exports` map still lists `"."` only.                                                      | Must     |
| R4  | `routes/changelog.test.ts`'s registration of `@ticket/shared` is unchanged, and the API suite stays green in both of CI's file orders.                                                                         | Must     |
| R5  | A guard fails a definition added to the package's index, and fails an import of a shared file by path or subpath from any app, `@ticket/core` or `tests/e2e`.                                                  | Must     |
| R6  | Typecheck, the web build, the shared package's own tests and the E2E suite pass with no change outside the package beyond R5's rule and R7's docs.                                                             | Must     |
| R7  | Every doc that cites `packages/shared/src/index.ts` for one domain's symbol cites that domain's file instead. ADR-0019's stale line number is dropped.                                                         | Should   |
| R8  | `conventions.md` says where a new shared export goes, beside its `USER_ROLE` rule.                                                                                                                             | Should   |

### Non-goals

- **Renaming, merging or deleting an export.** This pass moves code. An export
  that turns out to be unused or misplaced is listed in the PR, not fixed.
- **Subpath exports** such as @ticket/shared/evals. They would let a module
  get past the changelog test's registration (#174, #303). See R3.
- **Moving vocabulary between packages.** A shape that arguably belongs in
  `@ticket/core` as a zod schema stays where it is.
- **`changelog-entries.json`.** CI's `bump-version` job writes it by path, and
  it stays where it is.
- **The other candidates from the 2026-10-16 architecture review.** Each has
  its own PRD.

## Constraints

- **The registry hazard** (`testing-api.md`, ADR-0014). `mock.module` binds a
  specifier for the whole process. The changelog test spreads the real module
  and replaces `CHANGELOG_LATEST_VERSION`. That only works while the code under
  test reads the bare specifier, which is why R3 exists.
- **Vite's native config loader resolves nothing extensionless** (#428,
  `frontend.md`). Nothing under `apps/web/dev` imports `@ticket/shared` today.
  If something ever does, the index's relative re-exports must already resolve
  under that loader.
- **`conventions.md`'s `USER_ROLE` rule** names `@ticket/shared` as the single
  source of truth. The constant moves, the rule's wording does not.
- **The project map** (`apps/web/dev/scan.ts`) maps the alias to the index
  file. It must still draw the package's dependents after the split.

## Risks

| Risk                                                                              | Impact                                                                  | Mitigation                                                                                      |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Two domain files import each other (e.g. demo's admin screens and the pipeline's) | A circular ESM import reads a constant before it is set, at import time | No cycles between domain files; a shared piece both need moves to the lower one                 |
| An export is dropped or renamed in the move                                       | A caller fails typecheck, or a value-only use fails at runtime          | R2 is asserted by comparing the export list and `typeof` of every value before and after        |
| `export *` hides a name clash between two domain files                            | The clashing name silently drops out of the package                     | R2's comparison catches it; TypeScript's ambiguity error is the second line                     |
| The split collides with open branches that edit the file                          | A rebase conflict on every open PR touching the vocabulary              | Land it in one slice at a quiet point, and move each block whole so a conflict maps to one file |

## Open questions

- [ ] Do the index's relative re-exports carry `.ts` extensions now, ahead of
      any loader that needs them? — _affects R2_, decide in the plan
- [ ] Which guard owns R5: the shared package's own test for the index, and
      the API and web standards guards for deep imports, or one guard reading
      everything once the one-repo-scanner PRD widens the guards to
      `packages/`? — _affects R5_, decide in the plan
- [ ] **Assumed:** the domain names follow the blocks the file already has,
      and where they fit, `@ticket/core`'s `schemas/` file names, so the
      two packages read alike.
- [ ] **Assumed:** this lands after the open PRD 1–4 tickets that edit the
      shared file, or rebases them, rather than racing them.
