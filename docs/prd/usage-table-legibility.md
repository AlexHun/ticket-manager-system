# PRD: Usage page — a spend table you can read

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-09-19

## Problem

The Usage page answers its two headline questions with charts, and then hands
you a table of **98 rows across 9 columns** to answer everything else. At a
typical window the table is wider than the space it has — the sidebar takes
~256px, the columns want ~1200px, and `Cache read` sits off-screen behind a
horizontal scroll. It ranks exactly one way, because the server sorts it once by
output tokens descending and nothing on the page can re-rank it. So the ordinary
follow-up questions — _which issues came in over their forecast?_, _what did
#251 cost?_, _which work took the most sittings?_ — are answered by scrolling 98
rows with your eye, sideways as well as down. The charts made the page's summary
legible and left its evidence unreadable.

## Users

The developer working in this repository — not `admin`, not `agent`. Same user
and same constraints as [dev-tools-usage-page.md](dev-tools-usage-page.md): the
page lives under `/__dev`, outside `ProtectedRoute` and outside `AppShell`, and
must keep opening when the API and Postgres are down. The job has narrowed since
that PRD: deciding whether the bands still fit is now the charts' work, and the
table's remaining job is **finding one issue, or one class of issue, among a
hundred**.

## Success metrics

| Metric                                                               | Today                               | Target                                              |
| -------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------- |
| **Columns readable without horizontal scrolling** at a 1280px window | 8 of 9 — `Cache read` is off-screen | 4 of 4, with the other 3 opt-in                     |
| Ways to rank the 98 rows                                             | 1 — the server's order, fixed       | 4 sortable columns, both directions                 |
| Actions to isolate every issue that came in over forecast            | scan 98 rows by eye                 | 1                                                   |
| _Guardrail:_ the forecast-accuracy figure                            | 1/8 on target (13%)                 | reads identically whatever the table is filtered to |

The guardrail is the one that matters most. The accuracy figure describes the
scan, not the view, and it is the number somebody might quote — a filter that
moved it would turn a claim about the repository into a claim about a search box.

## Scope

### In this pass

| #   | Requirement                                                                                                                                                        | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| R1  | The table shows four columns by default — issue, title, output tokens, and the forecast comparison — all readable without horizontal scrolling at a 1280px window. | Must     |
| R2  | Turns, sessions and cache-read are hidden by default and restored to the table by one control.                                                                     | Must     |
| R3  | The forecast comparison reads as a single cell carrying the band forecast, the band landed in, and the verdict.                                                    | Must     |
| R4  | That cell still distinguishes "`gh` could not supply this" from "no work recorded yet", and renders neither as a zero, a default band, or a verdict.               | Must     |
| R5  | A developer can sort the table by issue, output tokens, turns, sessions or cache-read, in either direction.                                                        | Must     |
| R6  | An issue with no recorded spend never ranks among issues that have some, whatever column or direction is sorted.                                                   | Must     |
| R7  | A developer can narrow the table by typing an issue number or words from a title.                                                                                  | Must     |
| R8  | A developer can narrow the table to one forecast band, to one verdict, and to started or unstarted issues.                                                         | Must     |
| R9  | Whenever the table is narrowed, the page states how many rows are shown out of how many exist.                                                                     | Must     |
| R10 | Narrowing or sorting the table changes nothing about the two charts, the unattributed total, or the gathered-at line.                                              | Must     |
| R11 | Sort order and every filter survive a re-scan.                                                                                                                     | Must     |
| R12 | The filter controls appear only once a scan has been read, like every other part of the page.                                                                      | Should   |

### Non-goals

- **A date filter or calendar.** Considered and declined outright. A row is an
  issue's lifetime total across every branch and session that touched it, so a
  date window either filters rows on "last turn in range" — showing an issue's
  full 300k for a month in which it spent 10k — or re-sums inside the window,
  which makes every figure a partial and destroys the bucket and the verdict,
  since a band is denominated against what the whole issue cost.
- **A spend-over-time chart.** The honest form of the question underneath the
  calendar, and genuinely worth building — but it needs the scan to start
  reading each transcript line's timestamp, which is a change to the wire and
  to `apps/web/dev/usage.ts`. Its own PRD, so this one needs no backend change
  at all.
- **Resizing, shrinking or collapsing the two charts.** Measured against the
  complaint; they occupy one 240px band and are not what is unreadable.
- **URL-shareable filter state.** The tickets list and dashboard put filters in
  the URL; this page must not. Its scan result does not survive a reload, so a
  restored filter would deserialize onto an empty page and describe rows that
  are not there.
- **Filtering or sorting on the server.** Nothing narrows the scan itself; the
  rows all arrive and the page chooses which to draw.
- **Renaming the `Verdict` constant** across the protocol, both charts and
  `bun run tokens`. Out of proportion to the collision it fixes — see
  Constraints.

## Constraints

- **`USAGE_COLUMNS` is a positional contract, not a list.** `UsagePage.test.tsx`
  and `tests/e2e/dev-usage.spec.ts` both index a row's cells by position and
  neither can import the page. Every requirement here that adds, removes or
  reorders a column rewrites assertions in both suites. This is why a column set
  that varies by viewport is a non-starter: it cannot be a positional contract
  at all.
- **No backend change.** Every field R1–R11 touches is already on the wire. If a
  requirement here starts needing `apps/web/dev/usage.ts`, it has drifted into
  the spend-over-time PRD.
- **UI controls are shadcn only** (`docs/standards/frontend.md`), and a
  scrollable table stays inside `TableFrame` with its `label` — the three
  attributes that make the scroller keyboard-operable are one decision (#111).
- **`/__dev` reaches neither the API nor Postgres**, and the dev-tools backend
  exists only under `vite dev`.
- **The filter bar must pick its reach deliberately.** `frontend.md` records
  this as an obligation, from the project map's bar, whose search reaches all
  four views while its selects reach two. R10 is this page's answer.
- **`Verdict` already means something else here.** `CONTEXT.md` defines it as
  where one eval repeat landed — resolved, declined, abandoned — and lists
  _score_ under "_Avoid_". The Usage page's under / on target / over is exactly
  a score. R3 removes the word from the UI as a side effect; the glossary should
  gain a line saying the two are unrelated.

## Risks

| Risk                                                                                                       | Impact                                                                                                                                      | Mitigation                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Collapsing four columns into one cell blurs the `Unknown` / `NotStarted` distinction                       | The page's central claim breaks: an unstarted issue reads as having beaten its forecast, and the accuracy figure and quartiles move with it | R4 states it as its own testable requirement rather than leaving it implied by R3                                                     |
| Sorting ascending by output tokens floats the unstarted issues to the top as the cheapest work in the repo | Same lie as above, in a new place — `bucketFor(0)` is `S`                                                                                   | R6; the sink is unconditional, in both directions                                                                                     |
| The positional column contract is rewritten twice — once for the spine, once for the detail toggle         | Assertions silently check a neighbouring cell; the suites stay green while testing the wrong thing                                          | Both column sets are fixed and enumerated; nothing derives a column set from viewport or filter state                                 |
| Forecast coverage is 8 of 98, so the verdict filter matches almost nothing                                 | R8 ships a control that looks broken                                                                                                        | Not mitigated in this pass — it is the coverage gap the original PRD's R11 is about, and the filter makes it _more_ visible, not less |
| Filters silently reach the charts                                                                          | The accuracy figure becomes a statement about the search box                                                                                | R10, and the guardrail metric above                                                                                                   |

## Open questions

- [ ] Does `USAGE_COLUMNS` become two lists (spine and detail) or one list with
      a flag? — _affects R1, R2 and both test suites_, decide in the plan
- [ ] With coverage at 8/98, is the verdict filter worth building now or worth
      deferring until issues actually carry `forecast/S|M|L` labels? —
      _affects R8_, needs the repo owner
- [ ] **Assumed:** 1280px is the window width the "no horizontal scroll" target
      is measured at. Confirm — the complaint came from a real monitor whose
      width I did not measure.
- [ ] **Assumed:** the default sort stays output tokens descending, matching the
      server's order, so the first render after a scan does not reshuffle.
- [ ] **Assumed:** the detail toggle restoring three columns is allowed to
      reintroduce horizontal scrolling, because it is opt-in and `TableFrame`
      already makes the scroller reachable by keyboard.
- [ ] **Assumed:** the search box matches issue number and title only — not the
      band or the verdict word, which R8's selects cover properly.
