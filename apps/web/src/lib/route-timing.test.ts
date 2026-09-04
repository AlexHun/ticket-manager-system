import { beforeEach, describe, expect, it } from "vitest";
import {
  markNavigate,
  markRouteRendered,
  navigateMarkName,
  renderedMarkName,
  resetRouteTiming,
  routeTimingKey,
  timeToDataMeasureName,
} from "./route-timing";
import { ROUTE, TIMED_ROUTES } from "./routes";

/**
 * The timing module without a renderer.
 *
 * Every one of these used to be reachable only through `RouteTimingLayout` and
 * the three pages that call `useRouteRenderedMark`, which is why the bug in
 * issue #151 — a route pattern that no longer matched any pathname — had
 * nothing below E2E that could notice. `routeTimingKey` reads the paths from
 * `@/lib/routes` now, and the assertions below read them from the same record,
 * so a renamed route moves both sides together and these keep passing for the
 * right reason.
 */

const DASHBOARD = ROUTE.dashboard.timingKey;
const TICKETS = ROUTE.tickets.timingKey;
const TICKET_DETAIL = ROUTE.ticketDetail.timingKey;

beforeEach(() => {
  resetRouteTiming();
  performance.clearMarks();
  performance.clearMeasures();
});

describe("entry names", () => {
  it("names the pair and the span after the route's timing key", () => {
    expect(navigateMarkName(TICKETS)).toBe("tickets:navigate");
    expect(renderedMarkName(TICKETS)).toBe("tickets:rendered");
    expect(timeToDataMeasureName(TICKETS)).toBe("tickets:time-to-data");
  });

  it("gives every instrumented route three distinct names", () => {
    const names = TIMED_ROUTES.flatMap(({ timingKey }) => [
      navigateMarkName(timingKey),
      renderedMarkName(timingKey),
      timeToDataMeasureName(timingKey),
    ]);

    expect(new Set(names).size).toBe(names.length);
  });
});

describe("routeTimingKey", () => {
  it("maps each instrumented route's own path to its key", () => {
    expect(routeTimingKey(ROUTE.dashboard.path)).toBe(DASHBOARD);
    expect(routeTimingKey(ROUTE.tickets.path)).toBe(TICKETS);
  });

  // The reason `matchPath` is used rather than a `startsWith` comparison: an
  // inexact match would let the list answer for a detail pathname, and the two
  // routes' measures would be recorded against each other.
  it("tells the ticket list and a ticket apart", () => {
    expect(routeTimingKey("/tickets/3")).toBe(TICKET_DETAIL);
    expect(routeTimingKey("/tickets")).toBe(TICKETS);
  });

  it("does not treat the dashboard's `/` as a prefix of every route", () => {
    expect(routeTimingKey("/users")).toBeNull();
  });

  it("returns null for the routes that carry no timing key", () => {
    expect(routeTimingKey(ROUTE.knowledge.path)).toBeNull();
    expect(routeTimingKey(ROUTE.login.path)).toBeNull();
  });
});

describe("bracket bookkeeping", () => {
  it("measures from the navigate mark to the rendered one", () => {
    markNavigate(TICKETS);
    markRouteRendered(TICKETS);

    expect(performance.getEntriesByName(navigateMarkName(TICKETS), "mark")).toHaveLength(1);
    expect(performance.getEntriesByName(renderedMarkName(TICKETS), "mark")).toHaveLength(1);
    expect(
      performance.getEntriesByName(timeToDataMeasureName(TICKETS), "measure"),
    ).toHaveLength(1);
  });

  // What makes `useRouteRenderedMark` safe to run on every commit, and safe
  // under StrictMode's double-invoked mount effect.
  it("closes a bracket once, however many renders follow it", () => {
    markNavigate(TICKETS);
    markRouteRendered(TICKETS);
    markRouteRendered(TICKETS);
    markRouteRendered(TICKETS);

    expect(
      performance.getEntriesByName(timeToDataMeasureName(TICKETS), "measure"),
    ).toHaveLength(1);
  });

  // A navigation this module never saw the start of — the router resolved it
  // before React rendered the pending state. Better an absent measure than one
  // timed from a stranger's navigation.
  it("records nothing when no bracket is open", () => {
    markRouteRendered(TICKETS);

    expect(performance.getEntriesByName(renderedMarkName(TICKETS), "mark")).toHaveLength(0);
    expect(
      performance.getEntriesByName(timeToDataMeasureName(TICKETS), "measure"),
    ).toHaveLength(0);
  });

  it("keeps each route's bracket to itself", () => {
    markNavigate(TICKETS);
    markRouteRendered(DASHBOARD);

    expect(
      performance.getEntriesByName(timeToDataMeasureName(DASHBOARD), "measure"),
    ).toHaveLength(0);

    markRouteRendered(TICKETS);
    expect(
      performance.getEntriesByName(timeToDataMeasureName(TICKETS), "measure"),
    ).toHaveLength(1);
  });

  // The initial document load: `startTime: 0` is `performance.timeOrigin`, so
  // the entry chunk a cold visit waited for sits inside the span rather than in
  // front of it.
  it("can start a bracket at the document's navigation start", () => {
    markNavigate(TICKETS, 0);
    markRouteRendered(TICKETS);

    const [navigate] = performance.getEntriesByName(navigateMarkName(TICKETS), "mark");
    expect(navigate!.startTime).toBe(0);
  });

  // Re-entering a route with a bracket already open: `performance.measure`
  // resolves a mark name to its most recent entry, so the newer navigation's
  // start is the one that counts.
  it("measures a re-entered route from its latest navigate mark", () => {
    markNavigate(TICKETS, 0);
    markNavigate(TICKETS, 500);
    markRouteRendered(TICKETS);

    const [span] = performance.getEntriesByName(
      timeToDataMeasureName(TICKETS),
      "measure",
    );
    expect(span!.startTime).toBe(500);
  });
});
