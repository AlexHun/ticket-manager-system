import { describe, expect, it } from "vitest";
import { isDimmed } from "./DependencyGraph";
import { countLabel, matchesQuery } from "./module-match";

/**
 * The map's search rules, tested where they are decidable without a DOM.
 *
 * Both functions under test are here because each one is a bug that shipped: the
 * search reached two tabs of four because the match was written per view, and the
 * graph stopped responding to it entirely after the first click because focus and
 * search were an either/or. Neither needs a render to pin down, and a test that
 * needs one would not have been written.
 */

describe("matchesQuery", () => {
  it("matches everything on an empty query, so callers never branch", () => {
    expect(matchesQuery("", "apps/web/src/pages/TicketsPage.tsx")).toBe(true);
    expect(matchesQuery("", null, undefined)).toBe(true);
  });

  it("matches a substring of the path or the filename", () => {
    const id = "apps/web/src/pages/TicketsPage.tsx";
    expect(matchesQuery("ticketspage", id)).toBe(true);
    expect(matchesQuery("src/pages", id)).toBe(true);
    expect(matchesQuery("dashboard", id)).toBe(false);
  });

  it("lowercases the haystack — the query arrives already lowercased", () => {
    expect(matchesQuery("ticketspage", "apps/web/src/pages/TicketsPage.tsx")).toBe(true);
  });

  it("is a hit when any one field matches, and skips absent ones", () => {
    expect(matchesQuery("tickets", null, "GET", "/api/tickets")).toBe(true);
    expect(matchesQuery("tickets", null, undefined)).toBe(false);
  });
});

describe("countLabel", () => {
  it("shows the bare total when nothing is filtered out", () => {
    expect(countLabel(12, 12)).toBe("12");
  });

  it("shows both numbers once a search narrows the list", () => {
    expect(countLabel(3, 12)).toBe("3 of 12");
    expect(countLabel(0, 12)).toBe("0 of 12");
  });
});

describe("isDimmed", () => {
  const neighbours = new Set(["a", "b"]);

  it("lights everything when nothing is focused and nothing is searched", () => {
    expect(isDimmed("a", true, null)).toBe(false);
  });

  it("dims a non-match when nothing is focused", () => {
    expect(isDimmed("z", false, null)).toBe(true);
  });

  it("dims a non-neighbour when nothing is searched", () => {
    expect(isDimmed("z", true, neighbours)).toBe(true);
    expect(isDimmed("b", true, neighbours)).toBe(false);
  });

  // The regression. A selection used to make the search stop applying, and since
  // clicking a row in any of the four views sets the selection, that was the
  // normal state of the page rather than an edge case.
  it("keeps dimming a non-match while a node is selected", () => {
    expect(isDimmed("a", false, neighbours)).toBe(true);
  });

  it("lights only what clears both gates", () => {
    expect(isDimmed("a", true, neighbours)).toBe(false);
  });
});
