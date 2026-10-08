# Plan: Demo welcome

**PRD:** [docs/prd/demo-welcome.md](../prd/demo-welcome.md) · **Status:** Draft · **Date:** 2026-10-08

## Layers crossed

```
web  ROUTE.welcome in apps/web/src/lib/routes.ts
  → LoginPage.startDemo navigates there instead of to the Dashboard
  → App.tsx: a route inside the shell, behind new: a demo-only gate
    → new: apps/web/src/pages/WelcomePage.tsx (copy, steps, owner, stack)
    → new: apps/web/src/lib/welcome-steps.ts (import-free, paths via ROUTE)
  → DemoBanner.tsx: a link back to the welcome
  → DemoUsageCard.tsx: one more figure
    → api  routes/demo.ts: new POST, signed-in demo sessions only
      → apps/api/src/demo/usage.ts (the tally's only writer)
        → db  DemoSessionTally: new followedWelcomeStep column + migration
```

Two facts shape every slice:

- **Only the login click lands on the welcome.** `startDemo` navigates there.
  Nothing redirects, so a reload or a typed address never returns a visitor to
  it (R8), and a new click is a new identity that sees it again. No "welcome
  seen" state is stored anywhere.
- **No suggested step names a ticket by id.** `DEMO_RESET_SWEEP` re-creates the
  showcase tickets with new ids every night (`backend.md`). A step links to a
  screen or a filtered list, through `ROUTE` and `LIST_PARAM`, never a retyped
  path (`frontend.md`).

## Slice 1 — Demo lands on welcome

**Retires:** a screen only a demo session may open (the inverse of
`AdminScreenRoute`), and handing the login click to a page other than the
Dashboard without breaking the `session ⇒ Dashboard` redirect on `/login`.
**Covers:** R1, R2, R6, R7, R8, R9, R10

- A visitor clicks "Use demo session" and lands on a welcome page saying what
  the product does, in `CONTEXT.md`'s words. "Start exploring" takes them to
  the Dashboard, where the Dashboard's Tutorial pops up as it does today. The
  demo banner links back to the welcome from any page. An admin or agent who
  types the welcome address gets the not-found page.

The gate is UX only: the page reads no data, so there is no API boundary
to guard. It reads `viewerOf(session.user).demo`, as `DemoBanner` does.

**Hardcoded for now:** no suggested steps, no owner section, no stack line, no
How it works link; the step click records nothing.

**E2E:** new `tests/e2e/demo-welcome.spec.ts`, each start on its own address
(`helpers/client-address.ts`):

- The demo click lands on the welcome heading, with no Tutorial dialog open.
- Start exploring reaches the Dashboard and its Tutorial dialog.
- A reload on the Dashboard stays there.
- The banner link returns to the welcome.
- An admin opening the welcome address sees the not-found page.

## Slice 2 — Suggested steps, counted

**Retires:** a write from the welcome reaching the tally and coming back out on
the admin's card. It is the one slice with a migration, a route and a guard.
**Covers:** R4, R11
**Un-hardcodes:** no suggested steps; the click records nothing.

- The welcome offers 3–5 suggested steps from `welcome-steps.ts`, each linking
  to a screen a demo session can see. Following any of them marks the
  session's tally row, and the demo usage card on Users shows how many of the
  week's demo sessions followed a step.
- `POST /api/demo/welcome-step` is on `requireAuth` and refuses a session
  that is not `isAnonymous`. It marks the row with a conditional `updateMany`
  on `followedWelcomeStep: false`, the same shape as `markDemoTicketOpened`.
  The click fires the mutation and navigates without awaiting it, so a slow
  write never holds the visitor on the welcome.
- `GET /api/demo/usage` adds the count. It stays on `requireAdmin`.
- **The owner picks the steps** on the ticket. Candidates, all reachable by a
  demo session: tickets the assistant resolved (Tickets filtered to
  Resolved), the pipeline simulator, the latest eval run, the knowledge base,
  the Activity log.

**E2E:** extends `demo-welcome.spec.ts`. It walks every entry of
`welcome-steps.ts`, imported rather than restated, after
`runDemoReset()` from `helpers/demo-reset.ts`, and asserts
each step reaches a page that is not the not-found page. Then it signs in as an
admin and reads the card's count going from 0 to 1. API cases go in
`routes/demo-usage.test.ts`: an admin's session is refused, and a second click
does not count twice.

## Slice 3 — Owner and stack

**Retires:** nothing technical. This slice is the page's content and the
owner's review of it.
**Covers:** R3, R5, R12
**Un-hardcodes:** no owner section, no stack line.

- The welcome introduces Aliaksei Hunich, AI Full-Stack Developer and former
  frontend team lead, with a bio drafted from the owner's CV (never
  committed), and links to `linkedin.com/in/aliaksei-hunich`,
  `github.com/AlexHun` and `mailto:alex.hunich@gmail.com`. It names the stack in
  one line and links to `github.com/AlexHun/ticket-manager-system`. No phone
  number or address.
- The owner approves the bio in the PR before merge.
- The page is now complete, so R12 is asserted in full here: 375 px, keyboard
  only, reading order.

**E2E:** extends `demo-welcome.spec.ts`. The four links carry their `href`s. At
375 px the page has no horizontal scroll. Tabbing from the top reaches every
link and Start exploring in reading order. `contrast.spec.ts` gains a demo-session case
for the welcome. It checks only login and tickets today, both without a demo.

## Slice 4 — Link to How it works

**Retires:** nothing new. It waits on another plan's route.
**Covers:** R13
**Blocked by:** #455 (How it works slice 1), which adds `ROUTE.howItWorks`.

- The welcome links to How it works as the place to see how the system fits
  together.

**E2E:** extends `demo-welcome.spec.ts`. The link opens the How it works page
in a demo session.

## Requirement coverage

| Req | Slice | Note                                                               |
| --- | ----- | ------------------------------------------------------------------ |
| R1  | 1     |                                                                    |
| R2  | 1     | The skeleton's content                                             |
| R3  | 3     | Bio approved by the owner in the PR                                |
| R4  | 2     | The owner picks the steps on the ticket                            |
| R5  | 3     |                                                                    |
| R6  | 1     |                                                                    |
| R7  | 1     | `DemoBanner` renders only for a demo, so R10's banner half is free |
| R8  | 1     | Holds by construction: only the login click navigates there        |
| R9  | 1     | The welcome mounts no `<Tutorial>`                                 |
| R10 | 1     |                                                                    |
| R11 | 2     |                                                                    |
| R12 | 3     | Built from slice 1, asserted once the page is complete             |
| R13 | 4     | Should; blocked by #455                                            |

## Deferred

- **Demo visitor journey tracking** (pages, clicks, time on each). The PRD's
  first non-goal, and the owner's follow-up PRD.
- **A per-step breakdown of R11.** The PRD asks for "at least one step", so the
  POST carries no step key. If the owner later wants to know which step was
  followed, that belongs to the journey-tracking PRD.
- **Editing the welcome copy in the app.** A PRD non-goal; the copy lives in
  `WelcomePage.tsx` and `welcome-steps.ts`.
