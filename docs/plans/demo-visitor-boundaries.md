# Plan: Demo visitor boundaries, enforced and tested

**PRD:** [docs/prd/demo-visitor-boundaries.md](../prd/demo-visitor-boundaries.md) · **Status:** Draft · **Date:** 2026-09-30

## Layers crossed

```
web (App.tsx gates, nav-items.ts `demo` flags)
  → api (every router under apps/api/src/routes — its guard choice)
    → apps/api/src/middleware/auth.ts (guard: session lookup → allowed? → park)
    │   new: the session lookup as its own module, the one seam a test replaces
    → apps/api/src/demo/admin-view.ts (mayUseAdminView, seesAdminScreens — leaves)
    → @ticket/shared  new: one Record of admin screens → does a demo see it
  test infrastructure:
    apps/api/src/test/preload.ts (already binds ../db once, ADR-0014)
    tests/e2e/demo-session.spec.ts (the hand-kept list of 24 requests)
```

No database, queue or `@ticket/core` change.

## What the code says that the PRD did not

- **Every one of the 15 stubs replaces all three guards with one function
  that sets no `role`.** So the real `requireAdmin` would refuse every
  identity a route test sends today. An identity supplied by a test has to
  carry a role, and the honest source is the `user` row `src/test/fixtures.ts`
  already seeds. Spike 1 decides this.
- **`middleware/auth.ts` imports `../auth`**, which throws at import without
  two secrets. That import is why the stubs exist at all (`testing-api.md`).
  The guard's one real dependency on it is `auth.api.getSession`. Move that
  call behind its own module, and the preload can replace the lookup while
  every guard runs for real.
- **Converting one file at a time does not work.** While any file still
  registers `../middleware/auth`, the process-wide registry can hand a
  converted file the old stub, depending on load order. Because the stub
  checks nothing, the converted file's new guard assertions fail only on the
  CI order that loads the stub first. That is #170's lesson, so slice 1 moves
  all 15 files together.

## How the E2E bar applies here

Slices 1 and 2 change no behaviour. Their E2E bar is
`tests/e2e/demo-session.spec.ts` **passing unchanged**. That spec is what they
must not break (the PRD guardrail and R6), and a slice that had to edit it has
changed what someone can reach. Slices 3 and 4 do change behaviour: the gates
and the navigation are derived from the new table. Their bar is the same spec
plus the navigation assertions it already makes.

## Slice 1 — The route tests run the real guards

**Retires:** whether `middleware/auth.ts` can load under test with only its session lookup replaced, and whether all 15 files survive the real guards.
**Covers:** R1, R3

The session lookup becomes its own module. The preload replaces it once for
the whole process, beside the `../db` binding, and answers from the request's
`x-test-*` headers, whose names are unchanged. All 15 `mock.module("../middleware/auth")`
registrations and their `fakeGuard` copies are deleted in the same commit.
Every stub fell back to a default identity when a header was missing, and
three (`evals`, `eval-schedule`, `tickets`) chose their own. There is one
default now, set in the preload, and a test wanting anyone else says so
through the shared helper. A per-file default would be state, which is the
registry hazard in another form.

- A developer's route test now passes through `requireAdmin` for real. A test
  that sent an agent to an admin route and expected 200 starts failing, and
  each one is either fixed or found to be a real finding (see the PRD's first
  risk).

**Hardcoded for now:**

- No test yet asserts a _refusal_ per route. That is slice 2.
- The E2E list is still typed out by hand. That is slice 4.

**E2E:** `demo-session.spec.ts` unchanged. **API suite:** green in both CI
orders, not only on Windows. A new preload binding is exactly what
`testing-api.md` says to verify on `ubuntu-latest`.

## Slice 2 — A wrong guard fails a unit test

**Retires:** whether R2 is real coverage or a claim, proven by mutation.
**Covers:** R2
**Un-hardcodes:** "no refusal is asserted per route".

Each router's test file asserts its own boundary as a table:

- every write answers 403 to an agent and to a demo visitor;
- every showcase read answers 200 to a demo visitor;
- Users and Outbox answer 403 to a demo visitor.

The table covers the same requests as the E2E list, now at the unit level.

- The PR records a mutation run. Each admin write's guard is swapped in turn
  to `requireAdminView` and then to `requireAuth`, and at least one API unit
  test goes red each time.

**E2E:** `demo-session.spec.ts` unchanged.

## Slice 3 — One statement of what a demo visitor sees

**Retires:** where a statement both apps obey can live without the web importing API code or the leaves gaining imports.
**Covers:** R4, R5, R7

A `Record` over every admin screen, in `@ticket/shared` beside
`DECLINE_STAGE`, says whether a demo visitor sees it. Because it is a
`Record`, a new screen is a compile error until someone answers. Derived from
it:

- `App.tsx`'s choice of `AdminRoute` or `AdminViewRoute`;
- `nav-items.ts`'s `demo` flag;
- `DEMO_HIDDEN_PAGES` in `routes/tutorials.ts`.

It is _checked against_, not derived into, each router's read guard, by a unit
test that reads the table. A guard is chosen where the route is mounted, and
must stay opt-in (the PRD's constraint). The check makes a disagreement red.

Also in this slice, R7: `demo/utc-day.ts`'s header drops "the nightly reset",
which keeps its own cron in `jobs/demo-reset.ts`.

- A developer adding an admin screen gets a type error naming the table before
  anything renders.

**E2E:** `demo-session.spec.ts` unchanged. Its "not found for Users and
Outbox" and navigation assertions are what prove the derivation drew the same
picture.

## Slice 4 — The E2E list comes from the table

**Retires:** the hand-kept list drifting from the screens it guards.
**Covers:** R8 (Should)
**Un-hardcodes:** slice 1's hand-typed request list.

The showcase reads in `demo-session.spec.ts` are generated from slice 3's
table, together with a per-screen list of its read endpoints. The refusals for
Users and Outbox, and the writes, stay as literals, per the PRD's risk
mitigation: the last line of defence does not route through a generator.

**E2E:** the spec itself, which asserts the same requests as before, plus one
test that a screen added to the table without endpoints fails the spec.

## Requirement coverage

| Req | Slice | Note                                                              |
| --- | ----- | ----------------------------------------------------------------- |
| R1  | 1     |                                                                   |
| R2  | 2     | Proven by the mutation run recorded in the PR                     |
| R3  | 1     |                                                                   |
| R4  | 3     | Derived for web and tutorials; checked against for the API guards |
| R5  | 3     | `Record` exhaustiveness, plus the guard check                     |
| R6  | 1–4   | Every slice's E2E bar                                             |
| R7  | 3     | One comment; it rides with the slice that touches `demo/`         |
| R8  | 4     | `Should`; cut if slice 3 runs long                                |

Every `Must` has a slice. No slice exists without a requirement.

## Spikes

- **Where does a test identity's role come from?** The candidates:
  - the seeded `user` row named by `x-test-user`. It is true to the database,
    and a demo identity's `isAnonymous` comes from its row as well;
  - a new `x-test-role` header. It is simpler, but a test can then claim a role
    the row does not have.

  The recommendation is the row. Timebox 1h, blocks slice 1.

- **Can the lookup module leave `middleware/auth.ts` without a runtime import
  of `../auth`?** The `Session` type is a type-only import and is erased. Check
  that nothing else in the guard needs the instance. Timebox 30m, blocks
  slice 1.
- **What is the table keyed by?** A route path, a tutorial page key, or a new
  screen name. The PRD leaves this open. A new key type is likeliest, because
  neither existing one covers every admin screen. Timebox 1h, blocks
  slice 3.

## Deferred

- **#357**, the auth library's self-service endpoints. A separate bug with its
  own ticket.
- **Web tests' inline `DEMO` objects** and **the three ways API tests build a
  demo identity**. Both are PRD non-goals.
- **Whether a demo visitor can take a ticket for themselves.** A PRD open
  question for Aleksei. No slice changes it.
