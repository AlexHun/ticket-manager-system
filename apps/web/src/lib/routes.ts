/**
 * Every client route in one record: its path, and — for the three routes the
 * prefetching epic instrumented — the timing key their performance entries are
 * named after.
 *
 * The two used to be declared apart, and that is the drift this exists to make
 * impossible (issue #151). `@/lib/route-timing` kept its own copy of the three
 * instrumented patterns so it could map a pathname back to a key; the router
 * and the sidebar each spelled the same paths out again. Renaming a path in one
 * of them left the others matching a route that no longer existed — which for
 * the timing module meant the render mark quietly no-opped and the measure
 * simply stopped being emitted. No build error, no failing test, nothing in the
 * log: the instrumentation's failure mode is *absence*, which is the one thing
 * an assertion on a recorded number cannot notice.
 *
 * So paths are read from here, never retyped. `RoutePath` below is the union of
 * the paths in this record, and `NavItem["to"]` is typed as it, so a literal
 * that no longer names a route stops being assignable the moment the record
 * changes.
 *
 * Deliberately import-free — no `@/…` alias, no React, no router. That is what
 * lets `tests/e2e/route-timing.spec.ts` reach into it the same way
 * `dashboard-layout.spec.ts` reaches into `dashboard-panels.ts`, so the E2E
 * asserts on the names this record produces rather than restating them.
 */

interface RouteDefinition {
  readonly path: string;
  /**
   * Present only on the routes `@/lib/route-timing` brackets. Absent means the
   * route emits no marks — and because the record is read with `as const
   * satisfies`, reading `.timingKey` off one of those is a type error rather
   * than an `undefined` that flows on into a mark name.
   */
  readonly timingKey?: string;
}

export const ROUTE = {
  login: { path: "/login" },
  forgotPassword: { path: "/forgot-password" },
  resetPassword: { path: "/reset-password" },

  dashboard: { path: "/", timingKey: "dashboard" },
  tickets: { path: "/tickets", timingKey: "tickets" },
  ticketDetail: { path: "/tickets/:id", timingKey: "ticket-detail" },

  users: { path: "/users" },
  knowledge: { path: "/knowledge" },
  outbox: { path: "/outbox" },
  pipeline: { path: "/pipeline" },
  activity: { path: "/activity" },
  tutorials: { path: "/tutorials" },

  /**
   * The dev tools. They exist only while `vite dev` runs, but their paths
   * belong in the same record as everything else — `DEV_NAV_ITEMS` is a
   * `NavItem[]` like any other, and `import.meta.env.DEV` is what keeps them
   * out of a production build, not their absence from here.
   */
  devMap: { path: "/__dev/map" },
  devTests: { path: "/__dev/tests" },
  dev: { path: "/__dev/*" },

  /** The 404, which matches whatever nothing above did. */
  notFound: { path: "*" },
} as const satisfies Record<string, RouteDefinition>;

export type RouteName = keyof typeof ROUTE;

/** Every path this app routes, as a union of literals. */
export type RoutePath = (typeof ROUTE)[RouteName]["path"];

type TimedRoute = Extract<(typeof ROUTE)[RouteName], { timingKey: string }>;

/** The keys `@/lib/route-timing` names its marks and measures after. */
export type RouteTimingKey = TimedRoute["timingKey"];

/**
 * The instrumented routes, path and key together, in the shape the timing
 * module matches a pathname against.
 *
 * Derived rather than listed, so a route that gains or loses a `timingKey`
 * needs no second edit here. Order does not matter: every pattern is matched
 * exactly (see `routeTimingKey`), so `/tickets` and `/tickets/:id` cannot both
 * answer for the same pathname whichever is tried first.
 */
export const TIMED_ROUTES: readonly TimedRoute[] = Object.values(ROUTE).filter(
  (route): route is TimedRoute => "timingKey" in route,
);

/**
 * The detail page for one ticket, e.g. `/tickets/12`.
 *
 * Filled in from the route's own pattern rather than reassembled from a second
 * template, so the eight call sites that link to a ticket cannot outlive a
 * change to it. `generatePath` from React Router does this properly, and is
 * what to reach for if a route ever grows a second parameter — but importing it
 * would cost this module the property that lets the E2E read it.
 */
export function ticketDetailPath(id: number | string): string {
  return ROUTE.ticketDetail.path.replace(":id", String(id));
}
