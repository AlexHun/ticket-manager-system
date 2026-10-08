# PRD: How it works — architecture and ticket lifecycle as graphs

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-10-08

## Problem

Nothing in the app or the docs shows what the project looks like as a whole.
The dev-only Project map draws every file and roughly 330 imports, which answers
"what does this file import" and buries "what is this system made of". The
`/pipeline` rail draws only the unattended part of a ticket's life, as one
vertical line. Everything after the Handoff (people, Reopen, Close) appears
nowhere. Today a visitor, a new agent or a developer pieces it together from
`docs/standards/domain.md` and the code, and most of them never do.

## Users

**A demo visitor** wants to understand in a couple of minutes what the product is
built from and what happens to an email after it arrives.

**An agent** wants to know where the machine stops and their part starts: which
Status a ticket is in when it reaches them, and what a customer's reply does to
it.

**An admin, or a developer reading the repo**, wants a way into the code: which
subsystem does what, and which files are behind each step.

## Success metrics

| Metric                                                    | Today | Target                |
| --------------------------------------------------------- | ----- | --------------------- |
| Demo sessions that open How it works                      | 0     | TBD — needs the owner |
| _Guardrail:_ paths shown on the page that no longer exist | n/a   | 0, enforced by CI     |

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Priority |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | A "How it works" item in the sidebar, shown to every signed-in user (agent, admin, demo visitor), opens a page with two views: Architecture and Ticket lifecycle.                                                                                                                                                                                                                                                                                                                                                                                                                  | Must     |
| R2  | The Architecture view first shows the runtime boxes: customer mail, inbound mail provider, browser app, API with its job workers drawn inside it, Postgres, OpenAI, outbound mail provider and Sentry. Railway is drawn as a frame around the API and Postgres, and the shared packages as a note both apps depend on. Every connection is labelled with how the two sides talk (webhook, HTTP, live updates, SQL, job, model call, send).                                                                                                                                         | Must     |
| R3  | Selecting the API, the workers or the browser app opens its subsystems, using the lists settled in the 2026-10-08 grilling (Ingestion, Tickets & Activity, Knowledge base, Pipeline & Automation, Outbox, Auth & Users, Realtime, Evals & Schedule, Demo; the job workers with housekeeping as one node; the app's screens). Each subsystem is joined to the parts it talks to, and a Back control returns to the runtime view. No single file is ever a node.                                                                                                                     | Must     |
| R4  | Selecting any node or step opens a panel with a plain-language explanation in the words of `CONTEXT.md`, an "In the code" list of the repo paths behind it, and a link to the app screen where one exists (for example Classification → Pipeline).                                                                                                                                                                                                                                                                                                                                 | Must     |
| R5  | Every repo path the page shows exists. A test fails CI when one is moved or deleted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Must     |
| R6  | The Ticket lifecycle view draws these steps in three swimlanes (Customer, Assistant, Agent), each tagged with the Status the ticket has at that point: email sent → Ingestion (New) → Classification (New) → Claim (Processing) → either auto-reply sent and filed under the assistant (Resolved) or Decline and Handoff (Open) → agent replies, with Polish and Summary available (Open) → agent resolves (Resolved) → customer replies: either Reopen if the assistant had resolved it (Open), or the reply joins the thread if a person had (Resolved) → agent closes (Closed). | Must     |
| R7  | Next and Previous controls, and the arrow keys, walk the lifecycle steps in order. Each step highlights the step and the edge into it, and the panel follows. Clicking any step jumps to it.                                                                                                                                                                                                                                                                                                                                                                                       | Must     |
| R8  | The lifecycle view carries three notes: with no OpenAI key every ticket stays in New; an agent can move a ticket to any Status except Processing; an outage is not a Decline, and the ticket goes back to New for a retry.                                                                                                                                                                                                                                                                                                                                                         | Must     |
| R9  | No node changes position when stepping, switching views, filtering or reloading.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Must     |
| R10 | Both graphs can be panned and zoomed. At 375 px wide the graph scrolls sideways and the panel sits below it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Should   |
| R11 | A screen reader gets each graph as an ordered list carrying the same text as the panels, and every control works from the keyboard.                                                                                                                                                                                                                                                                                                                                                                                                                                                | Must     |
| R12 | The page's content is the same for every user and reads no ticket data: it renders the same with an empty database.                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Must     |

### Non-goals

- **Replaying a real ticket's Activity along the lifecycle.** A good follow-up,
  but it pulls in API work and edge cases with real data.
- **A file-level graph.** The dev Project map already has one.
- **Generating the architecture from a code scan.** The picture is a curated
  story. R5 keeps its paths honest, and the prose is reviewed like any doc.
- **Changing or replacing the `/pipeline` rail.** It keeps the live counts. This
  page explains, and does not measure.
- **A 3D view.** It looks impressive, but labels are harder to read and
  accessibility is harder.
- **A walkthrough (Tutorial) for the page itself.** The step controls do that
  job.

## Constraints

- **Wording follows `CONTEXT.md`.** This PRD adds **Ticket lifecycle** (the whole
  path, of which the Pipeline is the unattended part) and narrows **Reopen** to a
  ticket the assistant had resolved, which is what `apps/api/src/ingest.ts` does.
  "Workflow" stays an avoided word.
- **The lifecycle draws what the code does**, as `docs/standards/domain.md`
  describes it: classification leaves a ticket in New, and Processing lasts only
  while a reply is being composed.
- **Rendering with d3** was the owner's choice in the grilling session. It is
  recorded here so the plan doesn't argue it again. Everything else about the
  build is the plan's call.

## Risks

| Risk                                                               | Impact                                   | Mitigation                                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| The explanations drift from the code while every path still exists | Visitors learn something false           | Each feature PR that changes a drawn step updates its text. `coding-standards` will point at the data file from `domain.md`. |
| The graph library makes the main bundle heavier                    | Slower first load for every user         | The page loads on its own, and only the parts of the library it uses are pulled in                                           |
| Two levels plus swimlanes don't fit a phone screen                 | Visitors on mobile see a cramped picture | R10, plus R11's list as the readable fallback                                                                                |

## Open questions

- [ ] Target for "demo sessions that open How it works" — needs the owner
- [ ] **Assumed:** the nav item gets the "new" dot for the first release, like Activity did — confirm with the owner
- [ ] **Assumed:** the item sits in the main navigation after Tutorials, not in an admin-only group — confirm with the owner
