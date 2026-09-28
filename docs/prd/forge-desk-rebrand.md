# PRD: The Great Forge Desk rebrand

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-09-27

## Problem

The product is a showcase shown to HR and clients, and it looks like every other
shadcn starter: a generic "Ticket Manager" name, a stock icon, a plain card on
the login page. Nothing a visitor sees in the first ten seconds says this was
designed by someone, and the login page is the first ten seconds. The name also
describes the category, not the product, so it is forgettable next to other demos.

## Users

**A demo visitor** (HR, a hiring manager, a client) meets the login page and the
first screens after it. They should remember the product by name and look.

**`admin` and `agent`** work in the app all day. For them the rebrand must not cost
anything: same layout, same meanings for colour, nothing moving outside the login
page, and no loss of legibility or contrast.

## Success metrics

| Metric                                                           | Today   | Target                |
| ---------------------------------------------------------------- | ------- | --------------------- |
| Places the running app shows "Ticket Manager"                    | 10      | 0                     |
| Visitors who can name the product after a demo                   | unknown | TBD — needs the owner |
| _Guardrail:_ text/control pairs below WCAG AA on changed screens | 1       | 0                     |

The guardrail's baseline is `tests/e2e/contrast.spec.ts` (#340), measured
2026-09-28 with axe-core's `color-contrast` rule on `/login`, `/`, `/tickets`
and a ticket detail. Its one violation is the ticket detail's customer email
link, `text-primary` at 2.28:1 against the 4.5:1 AA asks for; the spec
tolerates it by name until the palette slice. Axe cannot judge the sidebar
lockup's gradient-clipped text or the dashboard chart's SVG tick labels, so
neither is in the count; both need checking by eye when their colours change.

## Scope

### In this pass

| #   | Requirement                                                                                                                                                                                                               | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | Every place the app names itself says "The Great Forge Desk": the login, forgot-password and reset-password pages, the Users page description and the login page's connection error. No visible "Ticket Manager" remains. | Must     |
| R2  | The browser tab reads `<page> · Forge Desk` on every route and "Forge Desk" before the app has loaded.                                                                                                                    | Must     |
| R3  | The favicon is the bronze hallmark (a punched octagon with an anvil and a hot bar) and stays recognisable at 16px.                                                                                                        | Must     |
| R4  | After sign-in, the sidebar header shows the lockup THE GREAT / FORGE / DESK with no icon, and links to the dashboard with the accessible name "The Great Forge Desk".                                                     | Must     |
| R5  | With the sidebar collapsed, the header shows a single "F" in the lockup's style. The header is the same height in both states, so nothing below it moves when the sidebar toggles.                                        | Must     |
| R6  | Page titles use the lockup's display face (Big Shoulders Display).                                                                                                                                                        | Must     |
| R7  | App-wide surfaces use the "Cold iron" palette: near-black iron with a faint blue cast.                                                                                                                                    | Must     |
| R8  | Everything clickable or selectable (primary buttons, links, focus rings, active nav items, the charts' primary series) is temper blue.                                                                                    | Must     |
| R9  | Bronze appears only on decorative edges and rules, never on anything clickable, a count or a status.                                                                                                                      | Must     |
| R10 | The sidebar's unread-assignment count and "New" badge are temper blue.                                                                                                                                                    | Must     |
| R11 | Settled and calm states (resolved, closed, healthy) are verdigris; the ember ramp for ticket age is unchanged, so warm still means somebody is waiting.                                                                   | Must     |
| R12 | The login page is the large lockup beside the sign-in form, with no anvil, forge or other illustration.                                                                                                                   | Must     |
| R13 | Every load of `/login` plays one strike: a flash behind the word, sparks thrown off its full width, then the word cools white-hot → orange → cherry → iron within 4 seconds. Signing in plays nothing.                    | Must     |
| R14 | Embers rise behind the lockup continuously: never more than 60 on screen, paused while the tab is hidden, and not reacting to the cursor.                                                                                 | Must     |
| R15 | With reduced motion requested, the login page shows the cooled lockup and nothing moves.                                                                                                                                  | Must     |
| R16 | The sign-in form accepts typing and focus as soon as the page appears; the strike never delays or blocks it.                                                                                                              | Must     |
| R17 | At 390px wide, the lockup sits as a banner above the form and the page has no horizontal scroll.                                                                                                                          | Must     |
| R18 | Pages other than `/login` download nothing used only by the login effect.                                                                                                                                                 | Should   |
| R19 | The README's headline names the product "The Great Forge Desk".                                                                                                                                                           | Should   |

### Non-goals

- **Renaming anything a visitor never sees**: the `@ticket/*` packages, Railway
  services, the repository and its URL, ADRs, `CLAUDE.md`, `project-scope.md`.
- **A light theme.** The app stays dark only.
- **Effects outside `/login`.** No embers, glow or animation in the signed-in app;
  the rework there is colour, type and the sidebar brand only.
- **Anything drawn from Warcraft, Blizzard or any other game**: no borrowed
  art, names or ornament. The forge is a real blacksmith's forge.
- **Branding outbound email.** Invitation and reset-password mail keep saying
  "support desk"; customer replies are untouched.
- **A strike on successful sign-in, sound, or cursor-driven sparks.** All three were
  considered and dropped during the prototype.

## Constraints

- **Fonts are self-hosted.** The web CSP holds `font-src 'self'`, so no font host
  can be added.
- **Controls stay shadcn/ui** (`docs/standards/frontend.md`); the rework changes
  tokens and type, not the component set.
- **Reduced motion is honoured**, as everywhere else in the app.
- **Reference prototype**: branch `prototype/forge-rebrand` (commits
  `53b4795`..`263b8f1`). It holds the chosen lockup, mark, palette and login scene,
  and is throwaway: it is not merged.

## Risks

| Risk                                                                      | Impact                                    | Mitigation                                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| Bronze read as "warm", colliding with the ember ramp's "somebody waiting" | Agents misread urgency                    | Bronze stays decorative only (R9); counts and badges move to blue (R10)     |
| Embers and the strike cost CPU on a low-end laptop                        | A visitor's first impression is a stutter | 60-ember cap and pause when hidden (R14); reduced motion stops it all (R15) |
| A condensed uppercase face makes long page titles harder to read          | Agents scan titles slower                 | Titles only (R6); body text keeps its current face                          |
| Tests and screenshots assert the old name and copy                        | CI goes red, or docs show the old brand   | Update them in the same change as the copy                                  |
| New surfaces lower contrast somewhere                                     | Text or controls fall below AA            | Guardrail metric: measure every changed screen                              |

## Open questions

- [ ] Target for "visitors who can name the product". Needs the owner.
- [x] **Decided:** palette A "Cold iron"; Big Shoulders Display for the lockup
      and page titles; the bronze hallmark (H1) as the favicon.
- [ ] **Assumed:** invitation and reset-password email keep the generic "support
      desk" wording (see Non-goals). Confirm with the owner.
- [x] **Decided:** "Forge Desk" is the short form, used where space is tight
      (the browser tab, R2); the lockup and every sentence use "The Great Forge
      Desk".
