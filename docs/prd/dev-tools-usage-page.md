# PRD: Dev-tools Usage page

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-09-11

## Problem

The forecast bands this repo estimates work with — `forecast/S|M|L`, denominated
in output tokens — were fixed off one measurement of its own history (p25 55k,
median 90k, p75 154k) and nothing has re-checked them since. Re-measuring today
means running `bun run tokens` and reading an 86-row padded text table in a
terminal: the numbers exist for as long as the scrollback does, there is no way
to see the distribution's shape, and the accuracy figure the script can print is
the last line of output rather than the thing you look at. So the bands drift
uncontested — a re-run just now puts the same percentiles at 59k / 92k / 155k —
and an estimate nobody marks against reality is a guess with a label on it.

## Users

The developer working in this repository — not `admin`, not `agent`. The page
lives under `/__dev`, which sits outside `ProtectedRoute` and outside `AppShell`
by construction: the dev tools describe the source tree and the local machine,
and `DevRoutes.tsx` puts them outside the role system so they still open when the
API and Postgres are down. This page is dev tooling, not product surface, and
the job is: decide whether an issue's forecast was right, and whether the bands
themselves still fit.

## Success metrics

| Metric                                                                     | Today                                                 | Target                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------- |
| **Forecast accuracy** — closed issues whose band matched the actual bucket | **undefined** — 0 of 86 issues carry a forecast label | TBD — needs a coverage base first |
| Forecast coverage — issues carrying a `forecast/S\|M\|L` label             | 0 of 86                                               | every issue cut from now on       |
| Unattributed turn share                                                    | 7,905 turns ran on `main` and belong to no issue      | not a target; watched only        |

The primary metric is **blocked by the second**: accuracy over a handful of
labelled issues is a coin toss reported as a percentage. Coverage is the gate,
and it is why R11 exists. The third row is a guardrail in the honest sense — it
is what the page cannot see, reported so the totals are never read as complete.

## Scope

### In this pass

| #   | Requirement                                                                                                                                                               | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | A developer can open a Usage page from the dev tools and see every issue with recorded token spend, without the API or the database running.                              | Must     |
| R2  | Every issue on the page links to that issue on `AlexHun/ticket-manager-system`.                                                                                           | Must     |
| R3  | Each issue shows its forecast band, its actual output tokens, the bucket those tokens fall in, and a verdict of on target / over / under — or no verdict when unlabelled. | Must     |
| R4  | An open issue with no recorded spend appears on the page with its forecast and no actual, rather than being absent.                                                       | Must     |
| R5  | The page gathers nothing until the developer asks it to, and states when the figures on screen were gathered.                                                             | Must     |
| R6  | The page shows forecast accuracy, and the distribution of actual output tokens against its p25 / median / p75, as charts rather than as numbers to be read off a table.   | Must     |
| R7  | Work that ran on `main` is reported as its own total, in both turns and tokens, and is never counted toward any issue.                                                    | Must     |
| R8  | The page and `bun run tokens` never report different figures for the same issue.                                                                                          | Must     |
| R9  | A GitHub work item is called an _issue_ everywhere this feature reads, writes or displays; _ticket_ keeps the meaning `CONTEXT.md` gives it.                              | Must     |
| R10 | With `gh` unavailable, the page still reports actuals and says the forecast is unknown, rather than failing.                                                              | Should   |
| R11 | Every issue cut from now on carries a `forecast/S\|M\|L` label, so the accuracy metric has a base to be computed over.                                                    | Should   |

### Non-goals

- **A dollar figure.** Output tokens are the unit the forecast bands are already
  denominated in, and a USD column would need a third price list beside the one
  in `provider.ts` that is documented as going stale.
- **A production or admin-facing page.** Considered and declined: the
  transcripts this reads live on one developer's machine, so a deployed page
  would render empty forever. Reaching production means pushing a snapshot, and
  that is a different feature with a different shape.
- **History across runs.** The page reports what is on disk now. Nothing is
  persisted, so there is no trend line and no comparison against a past reading.
- **Per-session drill-down.** A session count per issue is enough to see when
  work was split; which session spent what is not a question this answers.
- **Spend from other machines or other people.** Out of reach by construction.

## Constraints

- `/__dev` reaches neither the API nor Postgres — `DevRoutes.tsx` states the
  reason, and the whole point of the section is that it opens when they are down.
  This feature must not be the one that ends that.
- The dev-tools backend exists only under `vite dev` (`apply: "serve"`), so
  nothing here may produce a production artefact.
- `CONTEXT.md` defines **Ticket** as one customer's request and names _issue_ as
  a word to avoid for it. R9 is that constraint pointed the other way, and it
  applies to `scripts/ticket-tokens.mjs` and `SCRIPTS.md`, which use _ticket_ for
  a GitHub issue throughout today.
- Forecast bands are measured in **output tokens**, not total: output runs at a
  near-constant ~745 tokens per turn, while cache-read scales superlinearly with
  session length and measures session hygiene rather than the size of the work.

## Risks

| Risk                                                                       | Impact                                                                          | Mitigation                                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Nobody applies forecast labels, so the accuracy chart stays empty          | The page's primary reason to exist never materialises                           | R11; the coverage figure is on the page itself, so the gap is visible rather than assumed away |
| Reading every local transcript is slow enough to feel broken               | The page reads as hung; developer stops opening it                              | R5 — nothing is gathered until asked, and the result says when it last ran                     |
| Figures drift between the page and the CLI                                 | Two numbers for one question; neither can be trusted                            | R8, which is a statement about there being one implementation of the join                      |
| The bands are re-measured, moved, and old verdicts silently change meaning | An issue that was "on target" becomes "over" with no record of why              | Out of scope this pass — flagged in Open questions, since nothing here persists a verdict      |
| _Ticket_ keeps meaning two things because the rename is partial            | The page reads as being about customer tickets, which is the one thing it isn't | R9 names the files; it is a one-file pass and this is the cheapest moment it will ever be      |

## Open questions

- [ ] `forecast/XL` does not exist as a repository label, but the script has an
      XL bucket that any issue over 250k output tokens falls into. Is XL a label
      to create, or is falling into it deliberately unforecastable? — _affects R3_
- [ ] Who applies forecast labels to the 86 issues already closed, if anyone?
      Retro-labelling would give the accuracy metric a base immediately, but the
      estimate would be made knowing the answer. — _blocks the metric target_
- [ ] **Assumed:** cache-read tokens are shown per issue but excluded from the
      forecast comparison, per the script's own reasoning. Confirm that is what
      the column is for, and not a second thing to estimate against.
- [ ] **Assumed:** the page is reached from the dev-tools nav alongside Map and
      Tests, and needs no entry point from the product app.
- [ ] **Assumed:** "the figures were gathered at X" is a timestamp only. Whether
      a stale reading should warn after some age is unanswered.
