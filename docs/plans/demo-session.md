# Plan: One-click demo session

**PRD:** [docs/prd/demo-session.md](../prd/demo-session.md) · **Status:** Draft · **Date:** 2026-09-25

## Layers crossed

```
web (LoginPage button; AppSidebar nav + AdminRoute let a demo through; new: DemoBanner in AppShell)
  → auth (auth.ts: new: Better Auth `anonymous` plugin beside `admin` + `emailAndPassword`)
    → api (middleware/auth.ts: new: a demo-aware guard beside requireAuth / requireAdmin)
      → @ticket/core (new: schemas/demo.ts — the status and limit-reached shapes)
        → apps/api/src (new: demo/ — mode flag, spend ledger, ticket reset moved out of prisma/seed-tickets.ts)
          → db (User.isAnonymous; new: a per-UTC-day demo spend row; a demo-session tally for R14)
            → pg-boss (new: DEMO_RESET_SWEEP via registerSweep) · outbox (jobs/send-email.ts)
```

Four facts from the code shape every slice. They were checked against the installed
source rather than assumed:

- **`/sign-in/anonymous` ignores `disableSignUp`** (read in `better-auth@1.6.13`'s
  `dist/plugins/anonymous/index.mjs`). It creates a user on every call. Loading the
  plugin therefore opens a public user-creation endpoint, and the demo-mode flag has
  to refuse it. Leaving demo mode off in the config is not enough.
- **The demo identity must never hold `USER_ROLE.admin`.** The `admin` plugin
  (`adminRoles: [admin]`) serves its own `/api/auth/admin/*` endpoints (set role,
  remove user, impersonate) to that role, and none of them passes through
  `requireAdmin`. The demo stays `agent` (the plugin's `defaultRole`). R3's admin
  screens come from this repo's own guard, keyed on `isAnonymous`.
- **Each click creates a fresh identity**, so each visitor has their own `User` row.
  That gives R12 for free: walkthrough progress, new-feature and changelog "seen"
  flags, and the dashboard layout are all stored per user.
- **`backend.md`'s pin note says the app loads `admin` and `emailAndPassword`
  only.** Adding `anonymous` changes that claim and the advisory reasoning behind
  it. See Spikes.

**Demo mode stays off on production until slices 1–7 have merged.** The flag
defaults off, so every earlier merge leaves `main` shippable.

## Slice 1 — Button, session, dashboard, agent view

**Retires:** whether a password-free session works on the pinned 1.6.13 through the
same-origin proxy, with `disableSignUp` still true for everything else and the
anonymous endpoint refused while demo mode is off.
**Covers:** R1, R2 (button and start refused when off), R4, R11, R12

- A visitor clicks "Use demo session" on `/login` and lands on the dashboard,
  signed in. The top bar names them "Demo visitor". They can reply to a ticket and
  change its status, category and assignee, and polish and summarise it. A second
  visitor gets their own identity, and the dashboard walkthrough appears for them
  even after the first visitor dismissed it.
- `DEMO_MODE_ENABLED` turns demo mode on only for the literal `"true"`, like
  `PIPELINE_SIMULATOR_ENABLED`. The API reports it to the page as a presence boolean.
- Demo identities are never offered as assignees (`ASSIGNABLE_USER`, as with the
  assistant) and never appear on the Users roster. So no real user is ever
  confused with a demo visitor (R11).
- The ADR is drafted here: the first way into production without a credential,
  and the trigger for turning it off.

**Hardcoded for now:** agent screens only · AI uncapped · no start limit · the
default 7-day session · no reset · no banner · outbox rows treated like anyone's

**E2E:** `tests/e2e/demo-session.spec.ts`:

- The button lands on the dashboard with "Demo visitor" shown.
- A status change sticks.
- A second browser context sees the walkthrough the first dismissed.
- `POST /api/auth/sign-in/anonymous` against the AI API server (demo mode off there)
  is refused. _Dropped in slice 3 (#321), which needs a demo session on the AI
  server; the refusal stays covered by `routes/users.test.ts`._
- The button's absence when demo mode is off is `LoginPage.test.tsx`'s job, because
  no web server fronts a demo-off API.

## Slice 2 — Admin screens without the admin role

**Retires:** whether one guard can open admin reads to a demo identity while
Better Auth's admin endpoints and every non-ticket write stay shut.
**Covers:** R3, R5, R15 · **Un-hardcodes:** agent screens only

- The demo sees Pipeline, Knowledge, Evals, Activity and Tutorials. Users and Outbox
  are absent from the nav, a typed URL to either gives the not-found page, and
  their API routes answer 403.
- Knowledge, automation (the pipeline switches and the handoff card), the eval
  schedule and "run now", and the tutorial editor render their save controls
  disabled, each with a note saying why.
- The guard allows `GET` on admin routes except `users` and `outbox`, refuses every
  other admin write, and leaves the `requireAuth` ticket routes alone. The pipeline
  simulator is a write and is refused (see Deferred).

**E2E:** extends `demo-session.spec.ts`:

- Nav shows the four screens and not the other two, and `/users` is not found.
- The Knowledge save control is disabled.
- With the demo's cookie, `POST /api/knowledge`, `GET /api/users` and
  `GET /api/auth/admin/list-users` all fail.
- A ticket reassignment still succeeds.

## Slice 3 — The $1 daily AI budget

**Retires:** whether spend can be charged per call from `usdFor` and checked before
the next call, shared by every demo session, without touching admins.
**Covers:** R8 · **Un-hardcodes:** AI uncapped

- After each demo polish or summarise, its `usdFor(usage)` is added to that UTC
  day's spend row.
- Before each call, a day at or over `DEMO_AI_DAILY_USD` (default `1.00`) answers
  "demo AI limit reached, resets at 00:00 UTC" and makes no call. The panel shows
  that message instead of an error.
- Concurrent in-flight calls can overshoot by at most their own cost. That is
  accepted as "once it reaches".

**E2E:** `tests/e2e/demo-ai-budget.spec.ts`, against the AI API server and the fake
OpenAI:

- With `DEMO_AI_DAILY_USD` set tiny in `.env.test.ai`, the first demo polish returns
  a rewrite and the second returns the limit message.
- An admin's polish on the same server still succeeds.
- The message's rendering is covered in a component test, the same limitation as
  slice 1.

## Slice 4 — Five demo starts per IP per hour

**Retires:** whether the limit keys on the real client behind Railway and Caddy, the
same address the `/sign-in/email` rule resolves (see `backend.md` on the 1.6.13
pin), and whether that is testable.
**Covers:** R9 · **Un-hardcodes:** no start limit

- The sixth start from one address within an hour shows "try again later" and
  creates no user.
- Better Auth's limiter runs only in production (`isProduction`). The rule needs a
  switch of its own, or a place in front of the handler, to be observable anywhere
  else.
- `DEMO_SESSIONS_PER_IP_PER_HOUR` defaults to `5`.

**E2E:** `tests/e2e/demo-rate-limit.spec.ts`, shaped by the spike below: five starts
succeed, the sixth shows the message, and the user count is unchanged.

## Slice 5 — The nightly reset

**Retires:** moving the reset out of a top-level-await script into a module that a
sweep can run, and doing that safely while a visitor is mid-session.
**Covers:** R6 · **Un-hardcodes:** no reset

- `db:seed:tickets`' reset moves into `apps/api/src/demo/`. The script becomes a
  thin caller, and a `DEMO_RESET_SWEEP` registered through `registerSweep` runs it
  at 00:00 UTC.
- Demo tickets go back to their seeded state, assigned only among non-demo users,
  so no seeded ticket belongs to a visitor.
- Demo identities whose sessions have ended are deleted along with their sessions.
  An identity with a live session is kept until the next night.
- Tickets that neither the seed nor a demo created are untouched: rows still match
  on subject plus customer email.

**E2E:** `tests/e2e/demo-reset.spec.ts`:

- A demo closes a seeded ticket.
- The spec calls the sweep's exported `run` through `tests/e2e/helpers`, the way
  `db.ts` already reaches the test database. It does not wait for cron, for
  `evals.spec.ts`'s reason.
- A fresh demo session sees the ticket's seeded status.
- An ingested ticket's status survives the reset.

## Slice 6 — Two hours, the off switch, the banner

**Retires:** whether an expired or switched-off demo session actually ends inside
the `cookieCache` window.
**Covers:** R7, R2 (open sessions end), R13 · **Un-hardcodes:** 7-day session, no banner

- A demo session's expiry is set to 2 hours after it started.
- While demo mode is off, the guard refuses any demo identity, so open sessions end
  within the 60-second `cookieCache` window.
- A banner across `AppShell` says this is a demo and resets nightly, with "Exit
  demo", which signs the visitor out to `/login`.

**E2E:** extends `demo-session.spec.ts`:

- The banner shows, and "Exit demo" returns to `/login` with the button still there.
- A helper backdates the session's expiry, and after the cache window the next
  navigation lands on `/login`.

## Slice 7 — Demo mail is never delivered

**Retires:** where a demo-authored outbox row is stopped so that no worker ever
hands it to `mail/transport.ts`, even with a provider bound.
**Covers:** R10 · **Un-hardcodes:** outbox rows treated like anyone's

- A reply from a demo identity still writes its `Message` and `OutboundEmail`, but
  the row is created terminal. It is never `queued` and never enqueued. The outbox
  retry refuses it, on the same principle as `RETRYABLE_STATUS`.

**E2E:** `tests/e2e/demo-outbox.spec.ts`:

- A demo replies.
- An admin opens `/outbox` and the row reads as not sent.
- The provider-bound half is an API unit test with a stubbed transport, since no
  E2E server binds one.

## Slice 8 — Demo usage figures for the admin

**Covers:** R14 (Should)

- A small tally per demo session (when it started, whether it opened a ticket) that
  outlives the identity slice 5 deletes.
- The admin sees sessions started this week and how many opened a ticket.

**E2E:** `tests/e2e/demo-session.spec.ts`: a demo opens a ticket, then an admin sees
the week's figures move by one and one.

## Requirement coverage

| Req | Slice | Note                                                 |
| --- | ----- | ---------------------------------------------------- |
| R1  | 1     |                                                      |
| R2  | 1, 6  | 1: button and start refused; 6: open sessions end    |
| R3  | 2     | via this repo's guard, never the `admin` role        |
| R4  | 1     | re-asserted in 2 after the guard changes             |
| R5  | 2     |                                                      |
| R6  | 5     | nothing a demo can create in this plan; see Deferred |
| R7  | 6     |                                                      |
| R8  | 3     | polish and summarise are the demo's only AI calls    |
| R9  | 4     |                                                      |
| R10 | 7     |                                                      |
| R11 | 1     |                                                      |
| R12 | 1     | free with a fresh identity per click                 |
| R13 | 6     | Should                                               |
| R14 | 8     | Should                                               |
| R15 | 2     | past runs only; the owner pauses the schedule        |

## Spikes

- **Advisories against the `anonymous` plugin at 1.6.13.** Run `bun audit`, read the
  advisories and update `backend.md`'s "loads `admin` and `emailAndPassword` only"
  reasoning. If one reaches the plugin, the fallback is a route in this repo that
  mints the session itself. Timebox 1h; blocks slice 1.
- **Per-IP limits under E2E.** Every spec comes from one address, so a limit of 5
  starves every other demo spec. Options: a dedicated server, a raised limit on the
  ordinary server, or a forwarded address the proxy trusts. Timebox 1h; blocks
  slice 4. _Resolved in #322: a forwarded address. No proxy fronts the E2E API,
  so a context's `X-Forwarded-For` is what `getIp` reads. Every demo start in the
  suite names a fresh one (`tests/e2e/helpers/client-address.ts`), so the limit
  runs at its real default on the ordinary server and starves nobody._
- **Does `cookieCache` keep a session alive past its expiry, or past the off
  switch?** Measure it. Don't assume either way. Timebox 1h; blocks slice 6.

## Deferred

- **The pipeline simulator for demo sessions.** It is refused in slice 2. The
  classification and auto-reply it triggers run in background jobs, outside R8's
  per-session accounting, and it feeds a stranger's text through `ingest.ts`. So
  R6's "tickets a demo created" clause has nothing to remove yet, and the reset
  stays scoped to the seed's rows. Allowing the simulator is its own PRD.
- **Retiring the hand-made demo login** from `DEPLOYMENT.md` §5 (PRD non-goal): a
  docs follow-up once demo mode is on.
- **Private data per visitor, CAPTCHA, a manual reset button, converting a demo
  into a real account:** PRD non-goals.
- **Pausing the eval schedule on production:** the owner does this on `/evals`. It
  is not code (R15).
