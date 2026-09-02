# PRD: Route-level data prefetching

**Status:** Draft · **Author:** Aleksei Hunich · **Date:** 2026-09-01

## Problem

On `/`, `/tickets`, and `/tickets/:id`, data fetching starts only after the
route's code-split chunk has downloaded and the component has mounted: the
`useQuery` calls inside `DashboardPage`, `TicketsPage`, and `TicketDetailPage`
fire on mount, not on navigation. That's two sequential round trips —
chunk download, then data fetch — before any real content appears, each with
its own loading state (`RouteFallback`, then a query spinner). An agent or
admin clicking into a ticket watches a blank shell, then a spinner, then the
ticket. Note: this is not a `useEffect`-fetching problem — this codebase
already fetches exclusively through react-query per
`docs/standards/frontend.md` — it's a *timing* problem: the fetch is
triggered by mount, not by navigation.

## Users

Both `admin` and `agent` — Dashboard, Tickets, and TicketDetail sit inside
`ProtectedRoute` but outside `AdminRoute`, so every signed-in person lands on
these three routes on nearly every visit. The job: get from "clicked a link"
to "looking at real data" without watching two loading states resolve in
sequence.

## Success metrics

| Metric | Today | Target |
| ------ | ----- | ------ |
| Time from route navigation to data-populated render, on Dashboard/Tickets/TicketDetail | unknown — no baseline captured | TBD — needs a baseline measurement (Sentry performance, already wired via `@/lib/sentry`) before a number can be set |

Guardrail: number of distinct loading states shown per navigation must not
increase on any route touched by this change.

## Scope

### In this pass

| # | Requirement | Priority |
| - | ----------- | -------- |
| R1 | Navigating to `/`, `/tickets`, or `/tickets/:id` starts that route's primary data fetch no later than when its code chunk begins downloading — not after the component mounts. | Must |
| R2 | react-query remains the fetch/cache/mutation layer for these three routes: queries still use `useQuery`/`useSuspenseQuery` with the existing query keys (e.g. `ticketKeys.detail`), so existing invalidation call sites keep working unchanged. | Must |
| R3 | A user navigating to any of the three routes sees at most one loading state before content appears, never a chunk-loading fallback followed by a separate data spinner. | Must |
| R4 | After the change, an unauthenticated visitor or a wrong-role visitor hitting these routes is still redirected exactly as `ProtectedRoute`/`AdminRoute` do today — no protected data is fetched or shown before the auth check runs. | Must |
| R5 | A before/after timing measurement (navigation to data-populated render) is captured for all three routes and recorded, to convert the TBD target above into a real number. | Should |

### Non-goals

- Migrating Users, Knowledge, Outbox, Pipeline, Activity, or Tutorials to the
  same pattern this pass — those weren't named as the worst offenders; a
  follow-up PRD can extend this once the pattern is proven.
- Replacing react-query with loader-native fetching (`useLoaderData` reading
  a loader's own `fetch` call) — `docs/standards/frontend.md` mandates
  react-query for every server call, and this PRD doesn't reopen that.
- Server-side rendering — the app stays client-rendered; this only moves
  *when* a client-side fetch starts, not where HTML is generated.
- Rewriting the URL/input-sync `useEffect` in `TicketsPage` or the
  polling/simulator `useEffect`s in `PipelinePage` — those are state-sync
  side effects, not fetch-timing, and are unaffected by this change.

## Constraints

- `docs/standards/frontend.md`: all server calls go through axios + the
  shared `@/lib/api` instance, wrapped in react-query. Any route-level
  prefetch must call into the query client (e.g. `ensureQueryData`), not
  fetch directly.
- Routing today is declarative — `<BrowserRouter>`/`<Routes>` in
  `main.tsx`/`App.tsx` — with `ProtectedRoute` and `AdminRoute` as wrapper
  components, not loader-based guards. `react-router-dom` `7.18.2` is
  already installed and supports the data-router APIs this needs.
- No ADR currently governs routing architecture. This would be the first
  such decision and is worth capturing in an ADR once implemented.

## Risks

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Adopting a data router (`createBrowserRouter`/`RouterProvider`) is an app-wide change to `App.tsx`'s route tree, even though only 3 routes get real prefetching — every other route (login, admin pages, `/__dev`) has to move to the new router too. | Larger blast radius than the 3 in-scope pages; regressions could show up on untouched routes. | Land the router-mode migration as a behavior-neutral step first (all other routes get no-op loaders), verified by the existing E2E suite, before adding real prefetching to the 3 target routes. |
| `ProtectedRoute`/`AdminRoute` gate access by rendering a wrapper component that reads session state; a data router's loaders run *before* any component renders, which is a different point in the lifecycle. | A loader that fetches protected data before the session check runs could leak a flash of data or race the redirect. | Keep `ProtectedRoute`/`AdminRoute` exactly as the authorization gate; loaders own prefetching only, never authorization. |
| No baseline measurement exists — the waterfall described here is inferred from reading the code, not from measured user impact. | Could ship a nontrivial routing migration for a gap that's imperceptible on real network conditions. | R5's baseline gates the rest: if the measured gap is negligible, close this out instead of forcing the migration. |

## Open questions

- [ ] **Assumed:** "worst offenders" = Dashboard, TicketsPage, TicketDetailPage
      (highest-traffic, heaviest-query routes) — confirm this is the intended
      set before implementation starts.
- [ ] Success metric target is TBD — needs a baseline measurement (R5) before
      a number can be set. Confirm who captures that baseline and by when.
- [ ] Should this land with a new ADR documenting "routing uses React
      Router's data router with react-query-backed loaders" as the
      project's convention going forward? Not decided here — flagging
      because `docs/standards/frontend.md` doesn't currently mention
      routing mode at all.
- [ ] **Assumed:** server-side rendering stays out of scope, despite the
      source article's closing argument that loaders "align better with
      SSR" — confirm this remains a client-rendered SPA.
