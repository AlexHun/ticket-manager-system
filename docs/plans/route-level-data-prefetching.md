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

**Confirmed via context7** (`/remix-run/react-router`, matches installed
`7.18.2`'s data-router API — see `decisions/0002-lazy-route-modules.md` and
`docs/start/data/route-object.md`): a route's `lazy` property only fills in
properties the route object doesn't already define statically, and React
Router explicitly runs a **statically-defined `loader` in parallel with a
`lazy`-loaded `Component`** — this is documented as the intended way to hit
an API early without paying for the component's bundle first. So each
in-scope route keeps `lazy: () => import("./XPage").then(m => ({ Component:
m.XPage }))` for the component (same code-splitting boundary as today's
`React.lazy`) and gains a small, statically-imported `loader` module
alongside it — e.g. `apps/web/src/pages/TicketDetailPage.loader.ts` —
containing only the `ensureQueryData` call, no heavy imports. That loader
module needs the `QueryClient` instance created in `main.tsx`; extracting
it to its own module (e.g. `apps/web/src/lib/query-client.ts`) so both
`main.tsx` and the per-page loader modules can import it is part of slice 1.

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
routes with `children`, `AppShell` nested under `ProtectedRoute`). Every
page keeps its current code-splitting boundary via `lazy: () =>
import("./XPage").then(m => ({ Component: m.XPage }))` — the direct
route-object equivalent of today's `React.lazy(...)`. The shared
`QueryClient` moves out of `main.tsx` into its own module so later slices'
loader files can import it without importing the whole app.

- A user can sign in, visit every existing route (including `/users`,
  `/knowledge` as admin and as agent, `/__dev/*` in dev), sign out, and hit
  an unknown URL — every outcome (render, redirect, 404) is identical to
  today. Only the router implementation underneath changed.

**Hardcoded for now:** no route defines a static `loader`; every page still
fetches its data from `useQuery` on mount, exactly as today. (A route with
no static `loader` has nothing to parallelize against yet — that arrives in
slice 2.)

**E2E:** the existing suite is the regression gate for this slice —
`auth.spec.ts`'s sign-in/sign-out and redirect assertions, `tickets.spec.ts`,
`dashboard-layout.spec.ts`, and `user-management.spec.ts` must all pass
unmodified against the new router. No new spec; a slice that changes only
the routing *implementation* is proven by every existing path still
working, not by a new assertion.

## Slice 2 — TicketDetailPage loader

**Retires:** whether a small, statically-defined `loader` — living outside
the `lazy`-loaded page module, so React Router runs it in parallel with the
component chunk rather than after it resolves — calling
`queryClient.ensureQueryData({ queryKey: ticketKeys.detail(id), queryFn })`
lets the mounted `useTicketQuery` (same key) read an already-primed cache
with no second fetch and no second loading state. Also confirms
`ProtectedRoute`'s session check still runs and still wins before the
loader's data reaches the screen. The narrowest real case: one query, one
route param, no filters.
**Covers:** R1, R2, R3 (first real instance) · re-verifies R4 on this route
**Un-hardcodes:** slice 1's "no route has a static loader yet" for
`/tickets/:id`

- Clicking a ticket row starts `GET /api/tickets/:id` the moment navigation
  begins, running alongside — not after — `TicketDetailPage`'s code chunk
  download (the parallelization React Router documents for a static
  `loader` beside a `lazy` `Component`). The user sees exactly one loading
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
`ticketKeys.list(params)` key, and coexist with the component's own
`setSearchParams`-driven refetching on every filter change without a
duplicate network call. Harder than slice 2: the query is parameterized and
the *component*, not just the route, can change it in place.

Confirmed via context7: a search-string change makes React Router's default
`shouldRevalidate` return `true` (`currentUrl.search !== nextUrl.search`),
so **the loader re-runs on every `setSearchParams` navigation**, not just on
first entry to `/tickets` — this is the opposite of what the PRD's plan
draft assumed. That's fine, not a bug to work around: `ensureQueryData` and
the component's `useQuery` for the same key share react-query's per-hash
in-flight request, so the loader firing alongside the component's own
refetch costs one network call, not two. What this slice actually proves is
that de-dupe, not that the loader stays quiet after the first load.
**Covers:** R1, R2, R3
**Un-hardcodes:** `/tickets` now also prefetches; only `/` is left
mount-fetching after this slice.

- Landing on `/tickets` — with or without an existing query string — and
  changing a filter, sort, or page afterwards all start the list fetch at
  navigation time via the loader; the component's `useQuery` for the same
  key attaches to that same in-flight request rather than issuing a second
  one.

**E2E:** extend `tickets.spec.ts` with the same single-loading-state
assertion as slice 2, applied both to landing on `/tickets` (plain and with
a filter already in the URL, e.g. a bookmarked link) and to changing a
filter after landing — the latter asserts exactly one `/api/tickets`
request fires per filter change, proving the loader and the component's
refetch de-duped rather than doubled up. Every existing sort/filter/
pagination test must stay green unmodified.

**Measured while building it** (carries into slice 4, which reads
`useSearchParams` the same way):

- The two paths de-dupe for *different* reasons. A select, sort or page
  change is written to the URL first, so the awaited loader gets there
  first and the component's later observer finds a fresh entry (the
  client's `staleTime: 30_000` is what stops it refetching on mount) — one
  request, no overlap. Only the debounced search leads the URL, and that is
  the path where the component's fetch and the loader's `ensureQueryData`
  genuinely share one in-flight request.
- An awaited loader means `setSearchParams` no longer lands in a microtask:
  the router holds the navigation for the whole fetch, and the URL keeps
  reading the *old* params until it resolves. Any state derived from
  "did the URL change?" has to tell that pending window apart from a real
  URL move — `TicketsPage`'s search box did not, and reverted what was
  typed inside it. Fixed there with a second ref (the last URL value
  actually seen) and locked in by an E2E case.

## Slice 4 — DashboardPage loader

**Retires:** whether a loader can kick off several independent
`ensureQueryData` calls in parallel (stats, effectiveness, dashboard
layout) and have all three consuming hooks read primed cache at once,
matching the parallelism the three `useQuery` calls already have on mount
today — i.e., that moving the trigger point doesn't accidentally serialize
what's currently concurrent. `DashboardPage` reads its range/scope from
`useSearchParams` the same way `TicketsPage` reads filters, so slice 3's
de-dupe finding applies here too: a range change re-runs the loader, and
the component's own `useQuery` calls share that in-flight request.
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
