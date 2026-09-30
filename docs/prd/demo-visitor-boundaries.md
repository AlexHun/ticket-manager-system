# PRD: Demo visitor boundaries, enforced and tested

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-09-30

## Problem

A demo visitor is a stranger with a session (ADR-0022). What they may see and
do is decided by which guard each API route is mounted on: `requireAdmin`,
`requireAdminView` or `requireAuth`. **No API unit test runs those guards.**
All 15 route test files replace `../middleware/auth` wholesale with a stub
that lets through whoever the `x-test-*` headers name. `users.test.ts` calls its
copy "Deliberately identical". Mounting a write on the wrong guard leaves every
route test green. The only check is a hand-kept list of 24 requests
in `tests/e2e/demo-session.spec.ts`, and its own comment says why it exists:
"the route tests stub them".

Which admin screens a demo visitor sees is also stated four times, and none of
the four checks the others:

- the router's two gates in `App.tsx`;
- five `demo: true` flags in `nav-items.ts`;
- `DEMO_HIDDEN_PAGES` in `routes/tutorials.ts`;
- the guard chosen, one route at a time, on the API.

Adding an admin screen means remembering all four. If one is missed, the UX
and the control disagree.

A related gap in the auth library's own endpoints is tracked separately as
#357. It is referenced here, not repeated.

## Users

- **The developer adding or changing an admin route.** They need a route test
  that fails when the guard is wrong, and one place to say whether a demo
  visitor sees a new screen.
- **The admin, indirectly.** Their real data sits beside the showcase, and the
  guard is what keeps a stranger out of Users and Outbox.

## Success metrics

| Metric                                                            | Today | Target                     |
| ----------------------------------------------------------------- | ----- | -------------------------- |
| Route test files that replace the authorisation guards            | 15    | 0                          |
| Places that state which admin screens a demo visitor sees         | 4     | 1                          |
| A route mounted on a weaker guard, caught by `bun test`           | no    | yes                        |
| _Guardrail:_ what an admin, an agent and a demo visitor can reach | —     | unchanged, route for route |

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                                | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| R1  | Every API route test runs the real `requireAuth`, `requireAdmin` and `requireAdminView`; a test supplies only _who_ is asking.                                                             | Must     |
| R2  | Swapping any admin write's guard for `requireAdminView` or `requireAuth` fails at least one API unit test.                                                                                 | Must     |
| R3  | A test can ask as an admin, an agent, a demo visitor, or nobody, through one shared helper, and no route test file defines its own.                                                        | Must     |
| R4  | Whether a demo visitor sees each admin screen is stated once. The router gate, the navigation, the tutorials list and the API's read guards are all derived from it or checked against it. | Must     |
| R5  | Adding an admin screen without saying whether a demo visitor sees it fails the build or a test. There is no default that opens it.                                                         | Must     |
| R6  | Users and Outbox stay closed to a demo visitor, and every write stays admin-only: the E2E refusals in `demo-session.spec.ts` pass unchanged.                                               | Must     |
| R7  | The comment in `demo/utc-day.ts` names only the clocks that actually read it.                                                                                                              | Must     |
| R8  | The E2E route list in `demo-session.spec.ts` is derived from R4's single statement, not typed out by hand.                                                                                 | Should   |

### Non-goals

- **The auth library's self-service endpoints.** That is #357, a bug with its
  own ticket. This PRD makes route guards testable; it does not re-audit the
  auth library.
- **Changing what a demo visitor may do.** R6 and the guardrail are the
  boundary. No screen opens or closes.
- **Web component tests' inline `DEMO` session objects** (seven files). They
  are copies of a fixture, not of a guard, and nothing is enforced through
  them.
- **The three ways API tests build a demo identity** (a seeded fixture, the
  reset test's own seed, and a real anonymous sign-in in `users.test.ts`). The
  third is deliberate. The first two could merge, but no defect has come from
  them.
- **The demo-session PRD's R4 wording** ("everything an admin can") next to a
  demo visitor not being assignable. That is an open question below, not a
  change.

## Constraints

- **`auth.ts` throws at import without `BETTER_AUTH_SECRET` and
  `TRUSTED_ORIGINS`**, and `routes/users.test.ts` already loads it for real.
  R1 must not make every route test pay that cost or depend on that file's
  setup.
- **`mock.module`'s registry is one per process** (ADR-0016, #174). The 15
  stubs are identical _because_ of it: whichever loads first wins. A single
  replacement lives where ADR-0014 put the database binding, registered once
  for the whole process, or it re-creates the hazard.
- **`mayUseAdminView` and `seesAdminScreens` are leaves on purpose**
  (`backend.md`). R4 must not give them imports that something will then want
  to mock.
- **The guard stays opt-in per route** (`backend.md`, #320). R4 and R5 must
  keep "a new admin route is shut to a stranger until somebody decides
  otherwise". That property is the whole reason `requireAdminView` exists.
- **The repository is public.** Issues and PRs cut from this PRD describe
  guard coverage, not how to get past a guard.

## Risks

| Risk                                                                                         | Impact                                                       | Mitigation                                                                               |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Running the real guards turns up a route already on the wrong one                            | A real hole found mid-refactor, in a public repository       | Fix it privately first, as #357 was handled; the refactor waits                          |
| The shared identity helper is stateful and leaks between files                               | Green alone, red in the suite, differently on Windows and CI | Default to "nobody", reset in every `beforeEach`; run both CI orders before believing it |
| R4's single statement lives in `@ticket/shared` and the API guards cannot import a web route | The API half ends up checked, not derived                    | Accept "checked against" for the API; R5 still holds because the check is exhaustive     |
| R8 generates the E2E list, and a generator bug hides a route                                 | The last line of defence goes quiet                          | Keep R6's hand-written refusals for Users and Outbox as literals                         |

## Open questions

- [ ] Should a demo visitor be able to take a ticket for themselves? The
      demo-session PRD's R4 says "everything an admin can", and they cannot
      today. — _not blocking_; needs Aleksei
- [ ] Is R4's single statement keyed by route path, by tutorial page key, or by
      a new screen name? — _affects R4, R8_; decide in the plan
- [ ] **Assumed:** once R1 and R2 hold, the E2E list stays as belt and braces
      rather than being deleted.
- [ ] **Assumed:** `routes/users.test.ts`'s real Better Auth session stays
      as it is, and R1's helper sits beside it rather than replacing it.
- [ ] **Assumed:** there is no metric baseline beyond the counts above; there
      is no incident count to move.
