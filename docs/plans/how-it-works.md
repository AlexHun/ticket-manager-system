# Plan: How it works — architecture and ticket lifecycle as graphs

**PRD:** [docs/prd/how-it-works.md](../prd/how-it-works.md) · **Status:** Draft · **Date:** 2026-10-08

## Layers crossed

```
web  ROUTE.howItWorks in apps/web/src/lib/routes.ts
     → NAV_ITEMS in apps/web/src/components/layout/nav-items.ts (no `screen`: every signed-in user)
     → App.tsx: a lazy route inside the shell, outside AdminScreenRoute
       → new: apps/web/src/pages/HowItWorksPage.tsx (shadcn Tabs: Architecture | Ticket lifecycle)
         → new: apps/web/src/components/graph/ — one d3-zoom SVG canvas both views share
           → new: apps/web/src/lib/how-it-works/ — the graph data, plus pure layout over it
```

There's no API, database or queue layer. R12 says the page reads no ticket
data, so the "far side" a tracer has to reach is the browser's own: the
data module, the layout function, d3's zoom on a React-rendered SVG, and a lazy
chunk that keeps d3 out of the entry bundle. Those are the unknowns slice 1
proves.

Three rules from the standards shape every slice:

- **The data module is import-free apart from `@ticket/shared`**, as
  `routes.ts` is (`frontend.md`). That lets the E2E specs import it and assert
  against the same node titles and step names the page draws, rather than
  retyping them. The lifecycle data takes its Status values from
  `TICKET_STATUS`.
- **Coordinates are a pure function of the data**: lane and column in, x and y
  out, and nothing is simulated (R9, and how `DependencyGraph.tsx` already
  works). The layout is unit-tested without a renderer.
- **React renders the SVG; d3 only owns the zoom transform and the
  transitions.** `zoom()` goes on the `<svg>`, and `event.transform` is applied to one
  `<g>`. Moving the view to a step goes through `zoom.translateTo` inside a
  transition (checked in context7, d3js.org/d3-zoom). We add only the modules we use
  (`d3-selection`, `d3-zoom`, `d3-transition`, `d3-shape` for edge paths, plus their
  `@types`), and `tech-stack.md` gets a line naming them.

Motion goes through `useReducedMotion`. With reduced motion, a step jumps
instead of gliding. Controls are shadcn only (Tabs, Button, Toggle). Hues are
picked by meaning, from the `:root` map in `index.css`.

## Slice 1 — Runtime boxes on a zoomable canvas

**Retires:** d3-zoom on a React-owned SVG inside a lazy route; the import-free
data module read by both the page and Playwright; the nav item with no role
gate.
**Covers:** R1, R2, R9 (for this view), R11 (the list half), R12, R13

- Any signed-in user, including an agent, opens "How it works" from the sidebar,
  where it sits after Tutorials and wears the "New" badge until first followed
  (a `NEW_FEATURE_KEY` entry with its `NEW_FEATURE_VERSIONS` start, per
  `frontend.md`), and sees the Architecture tab: the runtime boxes, the Railway frame, the
  shared packages note and the labelled connections from R2, all of which pan
  and zoom. Selecting a box opens the side panel with its explanation.
  Underneath the SVG, a visually hidden ordered list carries the same boxes and
  text.

**Hardcoded for now:** the Ticket lifecycle tab says "coming next"; boxes don't
drill down; the panel shows only the explanation (no code paths, no links); zoom
is mouse and touch only (no buttons).

**E2E:** `tests/e2e/how-it-works.spec.ts`. With tickets reset to empty, an
**agent** signs in, sees the "New" badge on the nav item, and follows it; after
a reload the badge is gone. Every runtime box title imported
from the data module is visible, along with every connection label. Selecting
"API" puts its explanation in the panel. A scroll-zoom changes the `<g>`
transform, and the box positions measured after a reload equal those before.
A component test asserts the hidden list matches the data.

## Slice 2 — Lifecycle swimlanes, drawn whole

**Retires:** the lane layout with two branches and a Status tag on each step,
the shape the PRD's own picture rests on.
**Covers:** R6, R8, R9 (for this view)
**Un-hardcodes:** the "coming next" lifecycle tab

- The Ticket lifecycle tab draws the steps from R6 in Customer, Assistant and
  Agent lanes. Each step is tagged with its Status, using one colour per Status
  that is also used in the strip along the top. Both branches are drawn as forks
  (resolved vs Decline → Handoff; Reopen vs reply joins the thread), and the
  three notes from R8 sit beside the steps they qualify. Selecting a step opens
  its explanation.

**E2E:** extends the spec. Every step from the lifecycle data is visible in the
lane the data names (checked by bounding box against the lane's band). Each
step shows the Status the data gives it, and the three notes are present.
`lifecycle-layout.test.ts` holds the lane-and-column → x/y function: no two
steps overlap, and a branch's two arms share a column.

## Slice 3 — Step through the lifecycle

**Retires:** keeping React's current step and d3's animated view in step with
each other, which is the one interaction nothing in this repo does yet.
**Covers:** R7, R11 (keyboard half, this view)
**Un-hardcodes:** the lifecycle as a static picture

- Next and Previous buttons, and the left and right arrow keys while the canvas
  has focus, move one step along the order the data defines. The current step
  and the edge into it are highlighted and everything else is dimmed. The view
  glides so the step is in frame, or jumps under reduced motion. The panel and
  the hidden list's `aria-current` follow. Clicking any step jumps there.
  Previous is disabled at the first step and Next at the last.

**E2E:** extends the spec. Pressing Next N times highlights the data's Nth step,
and the panel shows its title. ArrowLeft goes back one. Clicking the Close step
jumps to it. Each step's measured position before and after stepping is
unchanged; only the view moved (R9). The suite already emulates reduced motion
(`frontend.md`), so the jump path is the one tested. A component test covers
the end-stop disabling.

## Slice 4 — Drill into subsystems

**Retires:** whether level-two subsystems and their cross-box edges stay
readable on a fixed layout at 1280 px.
**Covers:** R3, R9 (when changing level), R11 (keyboard half, this view)
**Un-hardcodes:** the runtime boxes with no drill-down

- Selecting the API, the job workers or the browser app opens its subsystems
  (the lists in R3, with housekeeping as one node), each joined to what it
  talks to in the other boxes. Back returns to the runtime view, the same box
  stays selected, and Escape does the same. Every node is reachable with Tab and
  opened with Enter.

**E2E:** extends the spec. Drill into API, and every subsystem title from the
data is visible and no node's title is a file path. Back shows the runtime boxes
at their earlier positions. Keyboard only: Tab to "Job workers", press Enter,
and its subsystems appear.

## Slice 5 — Into the code

**Retires:** keeping the drawn picture honest as the code moves, which is the
PRD's top risk.
**Covers:** R4, R5
**Un-hardcodes:** the explanation-only panel

- Every node and step lists "In the code" paths, and links to its app screen
  where one exists, through `ROUTE` and never a retyped path. A screen the
  viewer can't open (an agent and Pipeline) shows the name with no link
  rather than a link to the not-found page. `docs/standards/domain.md` gains
  one line saying the lifecycle drawn at How it works reads from the lifecycle
  data file, and that a change to a drawn step updates it.

**E2E:** extends the spec. An admin selects Classification and follows the
link to `/pipeline`. An agent sees the same step without the link. The path
check is `apps/web/dev/how-it-works-paths.test.ts` (in `dev/` rather than beside
the data, since it needs Node types that `tsconfig.app.json` does not carry):
every path in the data files exists from the repo root, and the test names the
node and the path that fails.

## Slice 6 — Small screens and zoom controls

**Retires:** whether two fixed-layout graphs are usable on a phone at all.
**Covers:** R10, R11 (zoom by keyboard)
**Un-hardcodes:** mouse-and-touch-only zoom; the side-by-side layout at every
width

- At 375 px wide the canvas fills the width, scrolls and zooms by touch, and the
  panel sits below it. Zoom in, zoom out and reset buttons work at every width
  and from the keyboard.

**E2E:** extends the spec at a 375×812 viewport. The panel's top is below the
canvas's bottom, the window doesn't scroll sideways, and pressing reset after
zooming in restores the `<g>` transform to identity.

## Requirement coverage

| Req | Slice      | Note                                                              |
| --- | ---------- | ----------------------------------------------------------------- |
| R1  | 1          |                                                                   |
| R2  | 1          |                                                                   |
| R3  | 4          |                                                                   |
| R4  | 5          |                                                                   |
| R5  | 5          |                                                                   |
| R6  | 2          |                                                                   |
| R7  | 3          |                                                                   |
| R8  | 2          |                                                                   |
| R9  | 1, 2, 3, 4 | Asserted in each view's spec, never left to a later slice         |
| R10 | 6          | Should                                                            |
| R11 | 1, 3, 4, 6 | The list ships in slice 1; keyboard arrives with each interaction |
| R12 | 1          | Slice 1's spec runs against an empty ticket table                 |
| R13 | 1          | Should; the owner confirmed it                                    |

## Deferred

- **The nav item's place after Tutorials** is still an open question in the PRD,
  assumed yes. Moving it later is a one-line reorder of `NAV_ITEMS`.
- **A Tutorial for the page.** This is a PRD non-goal. `frontend.md` mounts one on each
  of the nine main pages, and this page deliberately won't have one: the step
  controls do that job, and a tutorial key would be a Postgres enum migration
  for nothing.
- **Replaying a real ticket's Activity, a file-level graph, generating the
  graph from a scan, 3D, and changes to `/pipeline`.** All PRD non-goals.
