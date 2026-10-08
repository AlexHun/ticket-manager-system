# PRD: Demo welcome — what this is, who built it, what to try

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-10-08

## Problem

A demo visitor clicks "Use demo session" and lands on the Dashboard with no
idea what the product is, who made it or where to start. The Dashboard's
Tutorial explains the Dashboard, not the project, and the demo banner only
says the data resets nightly. Today the owner fills that gap by introducing
themself and the project in person or by message, which does not happen when
the link is passed on, and a visitor who is left guessing gives up within a
few minutes.

## Users

**A demo visitor** (HR, a hiring manager or a client) wants to know in under a
minute what the product does, who built it and what is worth clicking first.

**The owner** wants to hand out the demo link without an introduction to go
with it, and to know whether the welcome actually sends visitors somewhere.

Admins and agents are unaffected: they never see the welcome.

## Success metrics

| Metric                                                            | Today   | Target               |
| ----------------------------------------------------------------- | ------- | -------------------- |
| Share of demo sessions that follow at least one suggested step    | n/a     | None — observed only |
| _Guardrail:_ share of demo sessions that open at least one ticket | unknown | Does not fall        |

The primary figure has no target on purpose: it is there for the owner to see
where visitors go, not to pass or fail the page. The demo usage card already
counts the guardrail (demo-session PRD, R14). A welcome that sends visitors
anywhere but into a ticket would show up there.

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                                                                                                    | Priority |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | After "Use demo session", a new demo session lands on a welcome page instead of the Dashboard.                                                                                                                                                                 | Must     |
| R2  | The welcome page says in plain words what the product does: support email arrives, the assistant classifies it, and either replies from the knowledge base or hands the ticket off to an agent. It uses the terms in `CONTEXT.md`.                             | Must     |
| R3  | The welcome page introduces the owner: name, role, a short bio and links to LinkedIn, GitHub, a CV and email.                                                                                                                                                  | Must     |
| R4  | The welcome page offers 3 to 5 suggested steps, each one sentence long and each linking to a real screen of the demo (for example a ticket the assistant resolved, the pipeline simulator, a past eval run). Every link opens a screen a demo session can see. | Must     |
| R5  | The welcome page names the stack in one line and links to the source repository.                                                                                                                                                                               | Must     |
| R6  | A "Start exploring" control leaves the welcome page for the Dashboard.                                                                                                                                                                                         | Must     |
| R7  | The demo banner offers a way back to the welcome page throughout the demo session.                                                                                                                                                                             | Must     |
| R8  | A demo session opens on the welcome page only once. Once it has left the welcome by any route, reloading or opening any address during the same session no longer redirects there. A new demo session sees it again.                                           | Must     |
| R9  | No page Tutorial pops up over the welcome page. The Dashboard's Tutorial still appears the first time the visitor reaches the Dashboard.                                                                                                                       | Must     |
| R10 | Admins and agents never see the welcome page: they land on the Dashboard as they do today, the banner link does not exist for them, and opening the welcome page's address shows the not-found page.                                                           | Must     |
| R11 | The demo usage card shows, alongside the existing figures, how many of the week's demo sessions followed at least one suggested step.                                                                                                                          | Must     |
| R12 | The welcome page reads well at 375 px wide, works from the keyboard alone and makes sense to a screen reader in the order it reads.                                                                                                                            | Must     |
| R13 | Once the How it works page exists, the welcome page links to it as the place to see how the system fits together.                                                                                                                                              | Should   |

### Non-goals

- **Tracking where a demo visitor goes** (which pages, which clicks, how long
  each takes). The owner wants this, and it is its own PRD: event capture,
  retention and a way to view it are a separate problem from introducing the
  project. R11 is the one figure this page needs to judge itself.
- **Editing the welcome copy in the app.** The copy changes rarely and lives
  with the code. Unlike Tutorials, it has no editor this pass.
- **A welcome for admins or agents.** They are invited by a person who already
  explained the desk to them.
- **A guided, step-by-step tour across pages.** Each page's Tutorial already
  explains that page. The welcome points to where to go and leaves the rest to
  them.
- **Translations.** The app is English-only.

## Constraints

- **A demo session is an anonymous agent** (ADR-0022), and every new demo
  session starts as a first-time user (demo-session PRD, R12). "Once per
  session" (R8) is therefore once per visit.
- **Suggested steps must stay inside what a demo session can do** (demo-session
  PRD, R3, R5, R15). No step may lead to Users or Outbox, or ask the visitor to
  change something they cannot.
- **The welcome page reads no ticket data that a reset could break.** A
  suggested step that points at a particular seeded ticket must still resolve
  after the nightly reset.

## Risks

| Risk                                                         | Impact                                              | Mitigation                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| A suggested step's target is renamed, moved or reseeded away | A visitor clicks a dead link on their first screen  | R4 checked by a test that every step resolves, including against the seed    |
| The page grows into a wall of text                           | The visitor skims past it, which is the problem now | R2–R5 cap each section; review the copy against "readable in under a minute" |
| The bio goes stale (role, links)                             | The visitor sees an outdated introduction           | Accepted: the copy is reviewed like any doc                                  |

## Open questions

- [ ] The owner's CV link and contact address for R3. Needs the owner before
      the slice that builds R3.
- [x] **Decided:** the suggested-step share has no target; the owner watches it
      to see where visitors go.
- [x] **Decided:** the agent drafts the bio and the owner edits it before
      merge.
- [x] **Decided:** R3 links to LinkedIn, GitHub, a CV and email.
- [x] **Decided:** the source repository is public, so R5's link works for a
      stranger.
- [x] **Decided:** the agent proposes the 3–5 suggested steps from the seed
      during planning, and the owner picks (R4).
- [x] **Decided:** a full page, not a dialog or a Dashboard panel (R1).
- [x] **Decided:** demo sessions only (R10).
- [x] **Decided:** the Dashboard Tutorial waits until the visitor reaches the
      Dashboard (R9).
- [ ] **Follow-up PRD:** demo visitor journey tracking (pages, clicks, time on
      each).
