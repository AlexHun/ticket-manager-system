# Plan: The Great Forge Desk rebrand

**PRD:** [docs/prd/forge-desk-rebrand.md](../prd/forge-desk-rebrand.md) · **Status:** Draft · **Date:** 2026-09-27

## Layers crossed

Web only. No route, schema, table or job changes; the API is untouched.

```
static shell (apps/web/index.html <title>, apps/web/public/favicon.svg)
  → self-hosted font asset (new: @fontsource-variable/big-shoulders-display, under font-src 'self')
    → theme tokens (apps/web/src/index.css :root / .dark, @theme inline)
      → shared components (layout/Logo.tsx, layout/AppSidebar.tsx, PageHeader, lib/use-document-title.ts)
        → pages (LoginPage, ForgotPasswordPage, ResetPasswordPage, UsersPage)
          → new: login scene (lockup, strike, ember canvas), loaded by /login only
```

The prototype on `prototype/forge-rebrand` (`53b4795`..`263b8f1`) is the visual
reference for every slice: the lockup, the mark, palette A and the scene. It is
throwaway, so it is not cherry-picked. Its `import.meta.env.DEV` switcher, the
axis store, the `data-forge-*` attributes and the unchosen candidates (H2,
Marcellus SC, Rokkitt, Archivo, palettes B and C) do not come across.
Each slice rebuilds its part to `frontend.md`'s standards instead.

## Slice 1 — the name and its face

**Retires:** whether a self-hosted display face loads under the production CSP
and the lockup fits the sidebar in both states without moving the nav.
**Covers:** R1, R2, R3, R4, R5, R6, R19

- A visitor sees "The Great Forge Desk" on the login, forgot-password and
  reset-password pages. The tab reads `<page> · Forge Desk` and the favicon is
  the bronze hallmark. After sign-in the sidebar shows the lockup, or an "F" when
  collapsed, and every page title is in Big Shoulders Display.

**Hardcoded for now:**

- The existing green-teal palette stays. The lockup's lit-iron finish uses
  literal colours rather than tokens.
- The login page keeps its current card layout, with only the name changed.

**E2E:** `tests/e2e/brand.spec.ts`:

- The login, forgot-password and reset-password pages contain no "Ticket
  Manager" text.
- After sign-in, `document.title` is `Tickets · Forge Desk`.
- The sidebar link is named "The Great Forge Desk".
- The header's height is the same before and after collapsing the sidebar, and
  the first nav item's top does not move.
- The page title's computed `font-family` leads with Big Shoulders, and
  `document.fonts.check` confirms the face loaded.
- The icon link serves an SVG.

## Slice 2 — Cold iron and what colour means

**Retires:** the blast radius of re-pointing every token. Every screen,
shadcn component and chart reads them, and a derived token redeclared in the
wrong scope silently keeps the old value.
**Covers:** R7, R8, R9, R10, R11
**Un-hardcodes:** slice 1's palette, and the lockup's literal colours become
tokens.

- The whole app is Cold iron.
  - Primary buttons, links, focus rings, active nav icons, the unread count and
    the "New" badge are temper blue.
  - Resolved and closed states are verdigris.
  - Bronze appears only on decorative edges.
  - The ember age ramp is byte-identical.
- `frontend.md`'s `AiShine` bullet describes `--primary` as a deep green, so it
  is updated in the same change.

**E2E:** `tests/e2e/brand.spec.ts` extended:

- On `/tickets`, the unread badge and a primary button share one hue family,
  and that family is neither bronze nor ember.
- A resolved status badge is verdigris.
- The ember ramp's four computed colours equal their pre-change values, held as
  literals.
- No AA contrast violation on `/`, `/tickets`, a ticket detail and `/login`.
  How that is measured is the spike below.

## Slice 3 — the login lockup, still

**Retires:** the new login layout at every width, with the form never waiting
on the scene.
**Covers:** R12, R15, R16, R17
**Un-hardcodes:** slice 1's card layout on `/login`.

- `/login` is the large THE GREAT / FORGE / DESK lockup beside the sign-in form,
  in its cooled iron state. At phone width it is a banner above the form.
- With reduced motion requested, this is the final state, not a fallback.

**E2E:** `tests/e2e/login-scene.spec.ts`:

- At 1280px the lockup and form are side by side. At 390px the lockup sits
  above the form and `scrollWidth === clientWidth`.
- The email field takes typed input immediately after `goto`, with no wait.
- The existing `auth.spec.ts` sign-in flows pass unedited.

## Slice 4 — the strike and the embers

**Retires:** cost on real hardware (ember cap, hidden-tab pause) and keeping the
effect's code out of every other page.
**Covers:** R13, R14, R18
**Un-hardcodes:** slice 3's still scene gains motion when motion is allowed.

- Every load of `/login` plays one strike: a flash, sparks off the word's width,
  then cooling white-hot → orange → cherry → iron within 4 s. Embers rise behind
  it, never more than 60, paused while the tab is hidden. Signing in plays
  nothing.

**E2E:** `tests/e2e/login-scene.spec.ts` extended:

- The scene reaches its cooled state within 5 s of load, and a reload strikes
  again.
- The live ember count, exposed as a data attribute, never exceeds 60 across a
  3 s sample, and it stops changing once `visibilitychange` reports hidden.
- The email field takes typed input while the strike is still playing.
- With `reducedMotion: "reduce"`, no ember canvas mounts and the lockup is in
  its cooled state at first paint.
- A signed-in load of `/tickets` requests no script from the login scene's
  chunk.

## Requirement coverage

| Req | Slice | Note                                                         |
| --- | ----- | ------------------------------------------------------------ |
| R1  | 1     |                                                              |
| R2  | 1     |                                                              |
| R3  | 1     |                                                              |
| R4  | 1     |                                                              |
| R5  | 1     |                                                              |
| R6  | 1     |                                                              |
| R7  | 2     |                                                              |
| R8  | 2     | Active nav icons use `--sidebar-primary` today; it moves too |
| R9  | 2     |                                                              |
| R10 | 2     |                                                              |
| R11 | 2     |                                                              |
| R12 | 3     |                                                              |
| R13 | 4     |                                                              |
| R14 | 4     |                                                              |
| R15 | 3, 4  | Slice 3 is the reduced-motion state; slice 4 keeps it still  |
| R16 | 3     | Slice 4's E2E re-asserts it with motion on                   |
| R17 | 3     |                                                              |
| R18 | 4     | Should                                                       |
| R19 | 1     | Should                                                       |

## Spikes

- **How the AA guardrail is measured.** The repo has no accessibility tooling
  today. The choice is `@axe-core/playwright` (a new dev dependency) or a small
  contrast helper over computed colours. Either way, pick it before slice 2's
  spec is written. Timebox: 1h. Blocks slice 2.

## Deferred

- Renaming packages, Railway services, the repo and ADRs (PRD non-goal).
- A light theme (PRD non-goal).
- Any motion outside `/login` (PRD non-goal).
- Branding outbound email; staff mail keeps "support desk" (PRD non-goal, open
  question).
- A strike on sign-in, sound, and cursor-driven sparks (PRD non-goal).
