# Plan: `@ticket/shared` split by domain

**PRD:** [docs/prd/split-shared.md](../prd/split-shared.md) · **Status:** Draft · **Date:** 2026-10-17

## Layers crossed

```
callers  apps/api, apps/web, @ticket/core, tests/e2e   import "@ticket/shared", unchanged (R3)
  → packages/shared/src/index.ts   re-exports only (R2)
    → new: packages/shared/src/<domain>.ts   one per block, ≤ 600 lines (R1)
      → changelog-entries.json   read by the changelog file, unmoved
guards  new: packages/shared/src/exports.test.ts   the export list, before and after
        apps/api/src/standards-guard.test.ts, apps/web/dev/standards-guard.test.ts   deep imports (R5)
```

No route, schema, database or UI changes. Every change outside the package is
a guard rule (R5) or a doc citation (R7, R8).

## The done bar, and why it changes here

The skill's bar is a Playwright spec per slice. This moves code inside one
package and changes nothing a browser can see. As in
`docs/plans/doc-citations.md`, each slice is done when:

- the export test (slice 1) is green: the package exports the same names, and
  every value has the same `typeof` and the same serialised value, as the
  snapshot taken from the file before the split;
- typecheck, the web build, the shared and API suites (in both of CI's file
  orders) and the E2E suite are green (R4, R6);
- the diff of a moved block is a pure move. The PR shows it with
  `git diff --color-moved`, and lists any line that changed in transit.

## Slice 1 — The export snapshot, and the changelog block moved

**Retires:** whether the changelog test's `mock.module` still binds once
`CHANGELOG_LATEST_VERSION` is a re-export, whether the re-exports resolve with
or without `.ts`, and whether the project map still draws the package.
**Covers:** R2, R3, R4, R5 (deep imports)

- Before anything moves, `exports.test.ts` records every export's name, `typeof`
  and serialised value to a committed snapshot, read from the current file.
- The changelog block (`ChangelogEntry` through `ChangelogStatusResponse`)
  moves to its own file, with the JSON import it needs. It is the block a test
  replaces, so it goes first.
- **Extensions, decided here:** the index's re-exports spell `.ts`, if
  typecheck, the web build and `bun test` all take them. Then a loader that
  resolves nothing extensionless (#428) can read the package later. If one of
  them refuses, they stay extensionless and the PR says which one refused.
- The standards guards fail an import of a shared file by path or subpath. The
  API guard covers `apps/api`. The web guard covers `apps/web` and `tests/e2e`
  (#393). The shared package's own test covers `@ticket/core`, which no guard
  reads today.
- The project map is opened at `/__dev` and still shows `@ticket/shared`'s
  dependents. The PR includes a screenshot.

**Hardcoded for now:** every other block stays in the index.

**Done:** the bar above, with the changelog test unchanged and green.

## Slice 2 — The blocks with no cross-domain values

**Retires:** the bulk of the move, which is mechanical. **Covers:** R1 for
these blocks

- Tickets (about 730 lines, split in two at a seam the slice names in its PR),
  events, users, AI responses, knowledge, dashboard stats, outbox, activity,
  tutorials, new features, dashboard layout and brand, one commit per block.
- A block that only imports types from another file, or a value that file
  never imports back, moves here. A block whose values are keyed on another
  block's values at import time waits for slice 3.

**Done:** the bar above.

## Slice 3 — Pipeline, evals and demo, the blocks that read each other

**Retires:** circular imports. `DECLINE_STAGE` and `DECLINE_OUTCOME` key on
`AUTO_REPLY_DECLINE` and `PIPELINE_STAGE` while the module loads, and
`DEMO_SEES_ADMIN_SCREEN` keys on `ADMIN_SCREEN`. An import cycle between two
of these files reads a constant before it is set. **Covers:** R1 for the rest,
R5 (the index)

- Pipeline, evals (about 780 lines, split in two; the schedule and planned
  runs from line 2699 on are the likely seam) and demo move, ordered so that no domain file imports one that
  imports it back. A constant two files need moves to the lower one, and the PR
  names each one moved.
- The index now holds re-exports only. The shared package's test fails a
  definition added to it.

**Done:** the bar above, the PRD's metrics met, and an index with no
definitions in it.

## Slice 4 — The docs follow

**Covers:** R7, R8

- Each doc citing `packages/shared/src/index.ts` for one domain's symbol cites
  that domain's file instead. ADR-0019's stale line number is dropped.
- `conventions.md` says where a new shared export goes, beside its `USER_ROLE`
  rule.

**Done:** the citation check is green, and no doc names the index for a symbol
it no longer defines.

## Requirement coverage

| Req | Slice   | Note                                       |
| --- | ------- | ------------------------------------------ |
| R1  | 2, 3    | 1 moves changelog, the smallest block      |
| R2  | 1, 2, 3 | the snapshot from slice 1 is checked after |
| R3  | 1, 2, 3 | no import outside the package changes      |
| R4  | 1       | the block the test replaces moves first    |
| R5  | 1, 3    | deep imports in 1; the index rule in 3     |
| R6  | 1, 2, 3 | the bar                                    |
| R7  | 4       | Should                                     |
| R8  | 4       | Should                                     |

## Spikes

- **Does every tool take `.ts` re-exports?** Typecheck needs
  `allowImportingTsExtensions`, or TypeScript's rewrite option. Also check the
  web build, `bun test`, Vitest and Playwright's loader. context7 was
  unreachable when this was written, so none of it is verified. Timebox 1h,
  the start of slice 1.

## Deferred

- **Subpath exports** (PRD non-goal).
- **Renaming or deleting an export** found unused during the move. It is
  listed in the PR (PRD non-goal).
- **One guard reading `packages/`** waits on the one-repo-scanner plan's R6.
  Until then the shared package's own test covers `@ticket/core`.
