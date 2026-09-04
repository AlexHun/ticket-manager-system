import { useEffect, useRef } from "react";
import { Outlet, useNavigation } from "react-router-dom";
import {
  markNavigate,
  markRouteRendered,
  routeTimingKey,
  type RouteTimingKey,
} from "./route-timing";

/**
 * The React half of the route timing described in `./route-timing`: the layout
 * that watches navigations start, and the hook a page calls once its data is on
 * screen. Everything either of them does to a `performance` entry happens over
 * there, where it is unit-tested without a renderer.
 */

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
