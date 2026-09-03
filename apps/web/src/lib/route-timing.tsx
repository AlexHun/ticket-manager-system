import { useEffect, useRef } from "react";
import { Outlet, matchPath, useNavigation } from "react-router-dom";

/**
 * Navigation start → the first render that has the route's data, as a named
 * `performance.mark` pair and the `performance.measure` between them.
 *
 * Slice 5 of `docs/plans/route-level-data-prefetching.md`. The four slices
 * before it moved *when* three routes start fetching; this is what lets that be
 * measured rather than reasoned about — the PRD's success-metrics table still
 * reads TBD, and a recording pass over these measures is what fills it in.
 *
 * Deliberately **not** wired through the loaders, even though a loader is
 * exactly where a navigation to these three routes starts today. The number
 * this produces is only worth having beside a *before* number, and "before" is
 * the pre-loader state (slice 1), which has no loaders to mark from. Marking
 * from the router instead means this module drops onto that revision unchanged,
 * so the two runs measure the same span rather than two spans that merely share
 * a name.
 *
 * There is one navigation this cannot see, and it is the honest omission: a
 * navigation the router resolves before React can render the pending state
 * leaves no `navigate` mark, so it produces no measure. That is a visit with
 * nothing to wait for — a warm cache, a chunk already downloaded — which is
 * precisely the visit whose duration says nothing about where the fetch starts.
 */
export const ROUTE_TIMING = {
  dashboard: "dashboard",
  tickets: "tickets",
  ticketDetail: "ticket-detail",
} as const;

export type RouteTimingKey = (typeof ROUTE_TIMING)[keyof typeof ROUTE_TIMING];

/** e.g. `dashboard:navigate`. */
export const navigateMarkName = (key: RouteTimingKey) => `${key}:navigate`;
/** e.g. `dashboard:rendered`. */
export const renderedMarkName = (key: RouteTimingKey) => `${key}:rendered`;
/** e.g. `dashboard:time-to-data`, spanning the two marks above. */
export const timeToDataMeasureName = (key: RouteTimingKey) =>
  `${key}:time-to-data`;

/**
 * The three routes this epic moved a fetch on, and the only ones instrumented —
 * matched with React Router's own `matchPath` rather than a hand-rolled
 * comparison, so `/tickets` and `/tickets/3` cannot both answer to the same key
 * (`matchPath` is exact by default, which is what keeps them apart).
 */
const ROUTE_PATTERNS: ReadonlyArray<readonly [string, RouteTimingKey]> = [
  ["/", ROUTE_TIMING.dashboard],
  ["/tickets", ROUTE_TIMING.tickets],
  ["/tickets/:id", ROUTE_TIMING.ticketDetail],
];

function routeTimingKey(pathname: string): RouteTimingKey | null {
  for (const [pattern, key] of ROUTE_PATTERNS) {
    if (matchPath(pattern, pathname)) return key;
  }
  return null;
}

/**
 * Routes whose `navigate` mark is still waiting for the render that pairs with
 * it. Membership is the whole state machine: `markRouteRendered` consumes an
 * entry, so a route can only close one bracket per navigation no matter how
 * many times it is called.
 *
 * That is what makes the hook below safe to run on every commit, and safe under
 * StrictMode's double-invoked mount effect. Re-entering a route while an
 * earlier mark is still outstanding is harmless too: `performance.measure`
 * resolves a mark name to its *most recent* entry, so the newer navigation's
 * start is the one that counts.
 */
const awaitingRender = new Set<RouteTimingKey>();

function markNavigate(key: RouteTimingKey, startTime?: number): void {
  performance.mark(
    navigateMarkName(key),
    startTime === undefined ? undefined : { startTime },
  );
  awaitingRender.add(key);
}

/**
 * Closes the bracket: the route has data on screen.
 *
 * A no-op when nothing is outstanding, which covers the render that follows a
 * navigation this module never saw the start of (see the header) — better an
 * absent measure than one timed from a stranger's navigation.
 */
export function markRouteRendered(key: RouteTimingKey): void {
  if (!awaitingRender.delete(key)) return;
  performance.mark(renderedMarkName(key));
  performance.measure(
    timeToDataMeasureName(key),
    navigateMarkName(key),
    renderedMarkName(key),
  );
}

/**
 * Marks the route rendered on the first commit where `ready` is true.
 *
 * From an effect rather than during render, deliberately: an effect runs after
 * React has committed the DOM holding the data, which is the moment being
 * measured. And with **no dependency array**, also deliberately — a range or
 * filter change re-runs the route's loader without `ready` ever going false, so
 * a dependency on it would measure the first visit and silently nothing after.
 * The `awaitingRender` set is what keeps that from marking on every commit.
 */
export function useRouteRenderedMark(
  key: RouteTimingKey,
  ready: boolean,
): void {
  useEffect(() => {
    if (ready) markRouteRendered(key);
  });
}

/**
 * Module-scoped rather than a ref, so StrictMode's double-invoked render cannot
 * seed twice — and so this stays true across the remount StrictMode performs.
 */
let seededInitialNavigate = false;

/**
 * The initial document load, which is not a navigation the router announces:
 * `state.navigation` stays idle while the first load runs, so the layout below
 * would never see it start.
 *
 * `startTime: 0` is `performance.timeOrigin` — the browser's own navigation
 * start — which makes this the *most* honest bracket of the three, not the
 * least: a cold visit to `/tickets` really does begin when the address is
 * entered, and the entry chunk it waits for is part of the wait.
 */
function seedInitialNavigate(): void {
  if (seededInitialNavigate) return;
  seededInitialNavigate = true;
  const key = routeTimingKey(window.location.pathname);
  if (key) markNavigate(key, 0);
}

/**
 * A pass-through layout on the router's root route, whose only job is to be
 * mounted whenever a navigation begins.
 *
 * It has to sit *above* `ProtectedRoute`, not inside `AppShell` where the three
 * instrumented pages live. During a navigation React Router keeps the outgoing
 * screen rendered, so a probe under the shell could not see the one navigation
 * that matters most — `/login` → `/`, which every user makes on every sign-in
 * and which slice 4 named as the place its cost lands.
 */
export function RouteTimingLayout() {
  // Called during render, not from an effect, and the ordering is the reason:
  // a child's effects run before its parent's, so the page's rendered mark
  // would fire before an effect here could put the navigate mark down, and the
  // initial load would measure nothing at all. Idempotent, which is what makes
  // a call from render safe.
  seedInitialNavigate();

  const navigation = useNavigation();
  const pendingPath = navigation.location?.pathname ?? null;
  // Identity of the navigation in flight, so the effect fires once per
  // navigation rather than once per render of a navigation. The location key is
  // unique per navigation; the path and search ride along so that two
  // navigations are still told apart if it ever isn't.
  const pendingId = navigation.location
    ? `${navigation.location.key}|${navigation.location.pathname}${navigation.location.search}`
    : null;
  // Compared against the previous value rather than tracked with a first-run
  // boolean, so StrictMode's double-invoked mount effect reaches the same
  // answer twice.
  const seenId = useRef<string | null>(null);

  useEffect(() => {
    if (pendingId === null || pendingPath === null) {
      seenId.current = null;
      return;
    }
    if (seenId.current === pendingId) return;
    seenId.current = pendingId;

    const key = routeTimingKey(pendingPath);
    if (key) markNavigate(key);
  }, [pendingId, pendingPath]);

  return <Outlet />;
}
