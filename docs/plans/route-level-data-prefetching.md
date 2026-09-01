# Plan: Route-level data prefetching

**PRD:** [docs/prd/route-level-data-prefetching.md](../prd/route-level-data-prefetching.md) · **Status:** Draft · **Date:** 2026-09-01

## Layers crossed

```
web (App.tsx routing config; ProtectedRoute / AdminRoute; DashboardPage,
     TicketsPage, TicketDetailPage query hooks; main.tsx's QueryClient)
  → @tanstack/react-query cache (queryClient.ensureQueryData, existing
    query keys in ticket-queries.ts / dashboard-layout-queries.ts)
    → apps/api routes — GET /api/tickets/:id, /api/tickets,
      /api/tickets/stats, /api/tickets/effectiveness,
      /api/dashboard-layout — unchanged, called with the same params
```

Everything below the API is untouched: no `@ticket/core` schema, no
`apps/api/src` domain module, no Prisma model, no queue. This is a
frontend-only change to *when* an existing fetch is triggered, not what it
fetches. `packages/shared`'s `USER_ROLE`, `ticketKeys`, and the response
types are read, never edited.

## Slice 1 — Data router, zero behavior change

**Retires:** whether `react-router-dom@7.18.2`'s data router
(`createBrowserRouter`/`RouterProvider`) can host this app's exact route
tree — `ProtectedRoute`/`AdminRoute` as parent layout routes, `AppShell`
nested inside them, every page still `React.lazy`-loaded, the `/__dev/*`
dev-only splat, the catch-all 404 — with **no** loader anywhere yet, before
any prefetching is added. This is the foundation every later slice depends
on and the mitigation for the PRD's first Risk (app-wide blast radius from
the router-mode switch).
**Covers:** R4 (proves the auth-guard behavior survives the routing-mode
change, before any loader exists to complicate it)

`main.tsx` swaps `<BrowserRouter><App /></BrowserRouter>` for
`<RouterProvider router={router} />`; `App.tsx`'s JSX route tree becomes an
equivalent route-object tree passed to `createBrowserRouter`, preserving
the same nesting (`ProtectedRoute` and `AdminRoute` as parentless layout
routes with `children`, `AppShell` nested under `ProtectedRoute`).

- A user can sign in, visit every existing route (including `/users`,
  `/knowledge` as admin and as agent, `/__dev/*` in dev), sign out, and hit
  an unknown URL — every outcome (render, redirect, 404) is identical to
  today. Only the router implementation underneath changed.

**Hardcoded for now:** no route defines a `loader`; every page still fetches
its data from `useQuery` on mount, exactly as today.

**E2E:** the existing suite is the regression gate for this slice —
`auth.spec.ts`'s sign-in/sign-out and redirect assertions, `tickets.spec.ts`,
`dashboard-layout.spec.ts`, and `user-management.spec.ts` must all pass
unmodified against the new router. No new spec; a slice that changes only
the routing *implementation* is proven by every existing path still
working, not by a new assertion.

## Slice 2 — TicketDetailPage loader

**Retires:** whether a route `loader` calling
`queryClient.ensureQueryData({ queryKey: ticketKeys.detail(id), queryFn })`
lets the mounted `useTicketQuery` (same key) read an already-primed cache
with no second fetch and no second loading state — and that
`ProtectedRoute`'s session check still runs and still wins before the
loader's data reaches the screen. The narrowest real case: one query, one
route param, no filters.
**Covers:** R1, R2, R3 (first real instance) · re-verifies R4 on this route
**Un-hardcodes:** slice 1's "no route has a loader yet" for `/tickets/:id`

- Clicking a ticket row starts `GET /api/tickets/:id` the moment navigation
  begins — the same tick `TicketDetailPage`'s code chunk starts downloading
  — not after the component mounts. The user sees exactly one loading
  state (`RouteFallback`, or the chunk's own suspense fallback) and then the
  populated ticket — never fallback-then-spinner.
- `useTicketActivityQuery` and the unread-invalidation `useEffect`
  (`TicketDetailPage.tsx:73-77`) are untouched — only the ticket-detail
  query's *trigger point* moves; its key, retry policy, and every mutation
  that invalidates it stay exactly as written.

**E2E:** extend `tests/e2e/tickets.spec.ts` (or add
`ticket-detail-loading.spec.ts`) — navigate from the list into a ticket and
assert the loading indicator never appears twice in sequence (poll for the
`Loader2`/`aria-busy` element count, or assert the `/api/tickets/:id`
request is already in flight before the component's own pending branch
would have started it). Existing detail-page assertions (field selects,
activity trail, reply composer) must stay green unmodified.

## Slice 3 — TicketsPage loader

**Retires:** whether a loader can read the same filter/sort/page params
from the route's URL (via the loader's `request.url`) that the mounted
component derives from `useSearchParams`, produce the identical
`ticketKeys.list(params)` key, and not race or double-fetch against the
component's own `setSearchParams`-driven refetching on every filter change.
Harder than slice 2: the query is parameterized and the *component*, not
just the route, can change it in place.
**Covers:** R1, R2, R3
**Un-hardcodes:** `/tickets` now also prefetches; only `/` is left
mount-fetching after this slice.

- Landing on `/tickets` — with or without an existing query string —
  starts the list fetch at navigation time. Changing a filter, sort, or
  page afterwards still goes through the existing `setSearchParams` →
  `useQuery` refetch path unchanged; the loader only owns the *first* load
  of a given URL.

**E2E:** extend `tickets.spec.ts` with the same single-loading-state
assertion as slice 2, applied to landing on `/tickets` (plain and with a
filter already in the URL, e.g. via a bookmarked link). Every existing
sort/filter/pagination test must stay green unmodified — that's what proves
the loader isn't fighting the component's own re-fetching.

## Slice 4 — DashboardPage loader

**Retires:** whether a loader can kick off several independent
`ensureQueryData` calls in parallel (stats, effectiveness, dashboard
layout) and have all three consuming hooks read primed cache at once,
matching the parallelism the three `useQuery` calls already have on mount
today — i.e., that moving the trigger point doesn't accidentally serialize
what's currently concurrent.
**Covers:** R1, R2, R3
**Un-hardcodes:** the last of the three in-scope routes now prefetches.

- Landing on `/` (the post-login default for every user) starts all three
  underlying requests at navigation time instead of after mount, with the
  same single-loading-state behavior as slices 2 and 3.

**E2E:** extend `dashboard-layout.spec.ts`'s existing default-render test
(or add alongside it) with the same single-loading-state assertion.
Reorder/resize/reset tests must stay green unmodified.

## Slice 5 — Baseline timing instrumentation

**Retires:** the PRD's third Risk — no baseline measurement exists yet, so
whether this migration is worth its cost is currently inferred from reading
code, not measured. Converts the TBD success-metric target into a real
number.
**Covers:** R5

- Each of the three routes brackets navigation-start to
  data-populated-render with a named `performance.mark`/`performance.measure`
  pair (e.g. `dashboard:navigate`, `dashboard:rendered`). A recording pass
  — run against slice-1 (pre-loader) and slice-4 (post-loader) states —
  captures before/after numbers for all three routes and those get written
  back into the PRD's success-metrics table.

**E2E:** a spec asserts the named `performance.measure` entries exist after
navigating to each of the three routes
(`page.evaluate(() => performance.getEntriesByName(...))`). This proves the
instrumentation is wired; the actual before/after numbers are a recording
step outside CI, not an assertion against a target — no target exists yet.

## Requirement coverage

| Req | Slice | Note |
| --- | ----- | ---- |
| R1 | 2, 3, 4 | fetch starts at navigation, one per route |
| R2 | 2, 3, 4 | react-query stays the cache/fetch layer throughout |
| R3 | 2, 3, 4 | single loading state, asserted per route |
| R4 | 1 | foundational proof; re-verified incidentally by 2-4's E2E runs |
| R5 | 5 | instrumentation + one manual recording pass |

Every `Must` (R1-R4) has a slice. R5 (`Should`) has one too, thinner by
design since its output is a number, not user-facing behavior.

## Spikes

- **Verify the React Router 7.18 data-router API surface via context7**
  before slice 1 starts: `createBrowserRouter`'s route-object shape for
  parentless layout routes (matching today's `<Route element={...}>`
  groups with no `path`), a `loader`'s exact signature and how it receives
  `params`/`request`, and how `RouterProvider` composes with the existing
  per-page `React.lazy()` + `Suspense` setup. **Unverified this session** —
  the `context7` MCP server failed to connect (`CONNECT_TIMEOUT`) while
  writing this plan. Timebox 1h once reachable; blocks slice 1.
- **Confirm whether `setSearchParams` re-runs a route's loader** in React
  Router 7's data router, or only a real `<Link>`/`navigate()` entry does.
  This determines whether slices 3 and 4's loaders fire redundantly on
  every filter/range change (harmless but wasteful) or only once per fresh
  navigation (the intended behavior) — also via context7, unverified this
  session. Timebox 30min; blocks slice 3.

## Deferred

- Users, Knowledge, Outbox, Pipeline, Activity, Tutorials routes — PRD
  non-goal; no loader added to any of them this pass.
- Loader-native fetching that bypasses react-query — PRD non-goal;
  `docs/standards/frontend.md`'s react-query mandate stands.
- Server-side rendering — PRD non-goal; this only changes when a
  client-side fetch starts.
- Writing the ADR the PRD's open questions raise ("routing uses a data
  router with react-query-backed loaders") — left to a follow-up via
  `/domain-modeling` once slice 4 has proven the pattern, per the PRD's
  open question.
- Recording slice 5's actual before/after numbers into the PRD's
  success-metrics table — a manual step once slice 5 lands, not itself a
  coded slice.
