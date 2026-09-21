# Plan: The dev server's node half has nothing to test through

**PRD:** [docs/prd/dev-server-test-seams.md](../prd/dev-server-test-seams.md) · **Status:** Draft · **Date:** 2026-09-21

## Layers crossed

```
web  ProjectMapPage.tsx · TestRunnerPage.tsx · UsagePage.tsx
  → apps/web/dev/plugin.ts   7 routes: graph · suites · events · start · cancel · clear · usage
    → apps/web/dev/scan.ts      the project scan            (1,158 lines, no test)
    → apps/web/dev/suites.ts    spawns a suite              (466 lines, no test)
    → apps/web/dev/child-env.ts sanitises the environment   (141 lines, no test)
    → apps/web/dev/usage.ts     already has a seam and a test — the model, not the subject
```

No API, no Prisma, no queue. The "far side" this plan has to reach is a **child
process**, and that hop is where the integration assumptions are.

## The done bar, and what is missing from it

`tests/e2e/` holds ten specs and exactly one of them touches `/__dev`:
`dev-usage.spec.ts`. **There is no E2E spec for the project map or the test
runner at all.** So R7 — "what the three pages display is unchanged" — is a
requirement nothing currently holds for two of the three pages.

That makes slice 1 a real tracer bullet rather than an inversion: the thinnest
observable path through every layer, built because it does not exist.

## Slice 1 — The map and the test runner get a spec

**Retires:** the plan's premise. Today a refactor could empty the project map and no test in this repository would notice.
**Covers:** R7

A Playwright spec that opens `/__dev/map` and `/__dev/tests` against the dev
server and asserts each page is alive: the map renders its four tabs, reports a
non-zero module count, shows all four layers and surfaces its `warnings` list;
the test runner lists the repo's suites and shows none running.

- A developer changing the node half can find out in one spec run whether either
  page still works.

**Hardcoded for now:**

- **Structural assertions only** — tab count, non-zero counts, the layer names,
  the suite names. Never "this repo has 47 modules": that fails on the next
  commit and teaches everyone to ignore the spec.
- Nothing is started. Driving a real run is slice 3's fake-spawn work.

**E2E:** `tests/e2e/dev-tools.spec.ts`.

## Slice 2 — The scan takes its root as an argument

**Retires:** the largest structural unknown — whether 1,158 lines of scanner can be pointed at a tree that is not this one.
**Covers:** R1, R6 (the scanner's half)
**Un-hardcodes:** `REPO_ROOT`, a module constant computed at import.

**Two commits, and the order matters.** First the root becomes a parameter with
`REPO_ROOT` as the caller's argument and nothing else changed — a diff that
should be mechanical enough to read in one pass. Then a fixture tree arrives
with the first real `scan.test.ts` over it.

- The scanner can be asked about a directory the test wrote, and answers the
  same shape it answers about this repository.

**Hardcoded for now:**

- The fixture tree covers the import styles this repo uses, not every style the
  regex handles. Widening it is ordinary follow-up work, not a slice.

**E2E:** slice 1's spec unchanged — the map still draws this repository. Plus
`scan.test.ts`, which is the first test this file has ever had.

## Slice 3 — The run queue becomes a module with a spawn seam

**Retires:** the hardest surface here — closure state observable only through an event stream, and a spawn that binds ports and resets a database.
**Covers:** R3, R4
**Un-hardcodes:** `runs`, `listeners`, `active`, `queue` and the mutually recursive `drain`/`startRun`, all private to `devToolsPlugin()`.

`new:` a run-queue module that takes its spawn as an argument. Two adapters:
the real one, and a fake a test drives. Whether a run queued, started, was
cancelled or was cleared is a question you ask the module.

- A test can queue two runs, cancel the first and assert the second started —
  without a port, a database or a process.

**Hardcoded for now:**

- The replay cap disagrees with the page's (`MAX_REPLAY_EVENTS` 4,000 against
  `MAX_LINES` 3,000). This slice does **not** reconcile them — it makes the
  queue's own cap assertable, and the disagreement becomes visible rather than
  fixed. Reconciling is a change to behaviour and belongs to whoever wants it.

**E2E:** slice 1's spec unchanged; the test runner still lists and still shows
nothing running.

## Slice 4 — The other six routes get tests

**Retires:** nothing new — this banks what slices 2 and 3 made possible.
**Covers:** R2, R8
**Un-hardcodes:** `plugin.test.ts`'s single `describe`.

`graph`, `suites`, `events`, `start`, `cancel` and `clear` each get a test that
reaches them **through the plugin**, the way the usage route's six cases already
do. `events` needs a streaming-capable request helper — `mountPlugin`'s current
one assumes exactly one JSON write per request and cannot drive
`text/event-stream`. A handler that throws is covered here too: R8's 500 path
has no test today.

- Every route the dev server serves has a test that fails when it breaks.

**E2E:** slice 1's spec unchanged.

## Slice 5 — The environment a child gets is assertable

**Retires:** whether `childEnv`'s stripping can be tested without importing the module fresh per case, which `mock.module`'s one-process registry punishes.
**Covers:** R5, R6 (the environment's half)
**Un-hardcodes:** `REPO_ROOT` computed at module load in `child-env.ts`.

The root becomes an argument here too. A test can then assert which keys were
stripped, that the fake `node` from `--bun` is gone, and that `NODE` does not
point into a `bun-node-*` directory.

- The sanitiser that exists because a child saw Bun where it expected Node has a
  test saying so.

**E2E:** slice 1's spec unchanged, plus the test runner still starting a real
suite — verified once by hand, because the whole point of slice 3 is that the
automated path uses the fake.

## Requirement coverage

| Req | Slice | Note                                                                                                         |
| --- | ----- | ------------------------------------------------------------------------------------------------------------ |
| R1  | 2     |                                                                                                              |
| R2  | 4     |                                                                                                              |
| R3  | 3     |                                                                                                              |
| R4  | 3     |                                                                                                              |
| R5  | 5     |                                                                                                              |
| R6  | 2, 5  | The two derive-when-nothing-is-set branches: the scan's root and the child's environment                     |
| R7  | 1     | Built in slice 1 because it did not exist; re-run unchanged by 2–5                                           |
| R8  | 4     | `Should` — the `only()` funnel's rejection path, which `gatherUsage` never reaches because it does not throw |

Every `Must` has a slice. No slice exists without a requirement.

## Spikes

- **Is the run queue its own module, or does the plugin expose it for tests?**
  The first is a real seam with two adapters; the second is a hole in an
  interface that happens to be shaped like a test. Timebox 2h, blocks slice 3.
- **Where does the scanner's fixture tree live, and is it written or checked
  in?** Checked in is readable and adds files nothing else uses; generated is
  smaller and makes a failing scanner test very hard to read. Timebox 1h, blocks
  slice 2's second commit.

## Deferred

- **Reconciling the two replay caps** (4,000 server, 3,000 client). Slice 3
  makes the disagreement visible; changing either is a behaviour change with no
  requirement behind it.
- **Rewriting `scan.ts`'s parser.** Regex-over-source with comments stripped is
  a deliberate decision, and what it cannot parse lands in `warnings` rather
  than being dropped. PRD non-goal.
- **Asserting what the scan concludes about this repository.** PRD non-goal —
  fixture trees only, or the spec fails on the next commit.
- **`apps/web/src/dev/`** — the browser half, and
  [usage-page-module-seams.md](usage-page-module-seams.md).
- **A coverage percentage.** The metric is those specific 1,765 lines, not a
  ratio.
