import { matchPath } from "react-router-dom";
import { TIMED_ROUTES, type RouteTimingKey } from "./routes";

/**
 * Navigation start → the first render that has the route's data, as a named
 * `performance.mark` pair and the `performance.measure` between them.
 *
 * This half is the whole state machine and nothing else: the entry names, the
 * pathname→key lookup, and the set of brackets still waiting to be closed. It
 * holds no React, so it is unit-tested directly (`route-timing.test.ts`) rather
 * than through the layout that drives it — that lives next door in
 * `route-timing-layout.tsx`, and so does every reason a mark gets written.
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

export type { RouteTimingKey };

/** e.g. `dashboard:navigate`. */
export const navigateMarkName = (key: RouteTimingKey) => `${key}:navigate`;
/** e.g. `dashboard:rendered`. */
export const renderedMarkName = (key: RouteTimingKey) => `${key}:rendered`;
/** e.g. `dashboard:time-to-data`, spanning the two marks above. */
export const timeToDataMeasureName = (key: RouteTimingKey) =>
  `${key}:time-to-data`;

/**
 * Which instrumented route a pathname belongs to, or `null` for the rest of the
 * app.
 *
 * The patterns come from `@/lib/routes` — the one place a route's path is
 * written — and are matched with React Router's own `matchPath` rather than a
 * hand-rolled comparison, so `/tickets` and `/tickets/3` cannot both answer to
 * the same key (`matchPath` is exact by default, which is what keeps them
 * apart).
 */
export function routeTimingKey(pathname: string): RouteTimingKey | null {
  for (const route of TIMED_ROUTES) {
    if (matchPath(route.path, pathname)) return route.timingKey;
  }
  return null;
}

/**
 * Routes whose `navigate` mark is still waiting for the render that pairs with
 * it. Membership is the whole state machine: `markRouteRendered` consumes an
 * entry, so a route can only close one bracket per navigation no matter how
 * many times it is called.
 *
 * That is what makes the hook in `route-timing-layout.tsx` safe to run on every
 * commit, and safe under StrictMode's double-invoked mount effect. Re-entering
 * a route while an earlier mark is still outstanding is harmless too:
 * `performance.measure` resolves a mark name to its *most recent* entry, so the
 * newer navigation's start is the one that counts.
 */
const awaitingRender = new Set<RouteTimingKey>();

/** Opens the bracket. `startTime` is for the initial load — see `seedInitialNavigate`. */
export function markNavigate(key: RouteTimingKey, startTime?: number): void {
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
 * Test-only. The outstanding-bracket set is module state that outlives a single
 * `render()`, so a suite that opens a bracket and leaves it open would hand the
 * next test a route already awaiting its render.
 */
export function resetRouteTiming(): void {
  awaitingRender.clear();
}
