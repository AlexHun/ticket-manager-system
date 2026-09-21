import { describe, expect, test } from "vitest";
import {
  ANY_FACET,
  USAGE_FACETS,
  USAGE_FACET_KEYS,
  USAGE_STARTED,
  VERDICT,
  type IssueUsage,
  type UsageFacets,
} from "./protocol";
import { DEFAULT_USAGE_FACETS, matchesFacets } from "./usage-facets";

/**
 * What the three selects above the table actually ask of a row.
 *
 * Tested here rather than through the page for the reason `usage-sort.test.ts`
 * is: what a facet says is a predicate over every row, and a component test can
 * only ask it about the three or four rows it happened to render. The rule that
 * earns a unit test is the same one the rest of this feature is built on — an
 * absence is not a quantity. `started` asks whether `spend` is present and
 * nothing else, so a row that really recorded zero output tokens is *started*,
 * while an issue nobody has touched is not, and neither is read off the figure.
 */

/** A row with work recorded against it — the ordinary case every test varies. */
function makeIssue(over: Partial<IssueUsage> = {}): IssueUsage {
  return {
    issue: 1,
    spend: { out: 20_000, turns: 2, sessions: 1, cacheRead: 400_000 },
    title: "An issue",
    url: "https://example.test/1",
    forecast: "S",
    bucket: "S",
    verdict: VERDICT.onTarget,
    ...over,
  };
}

/** An open issue nobody has started: a band, and no figures at all. */
const unstarted = makeIssue({ spend: null, bucket: null, verdict: null });

/** A row `gh` could say nothing about: figures, and no band to score them
 *  against. */
const unforecast = makeIssue({ forecast: null, verdict: null });

const facets = (over: Partial<UsageFacets> = {}): UsageFacets => ({
  ...DEFAULT_USAGE_FACETS,
  ...over,
});

describe("matchesFacets", () => {
  /**
   * The resting state matches everything, which is `matchesQuery`'s rule
   * arriving at the other control on the same bar: callers filter
   * unconditionally rather than branching on "is the developer narrowing", and
   * a view can no longer forget the branch and drop its whole list.
   */
  test("matches every row while every facet is at any", () => {
    for (const row of [makeIssue(), unstarted, unforecast]) {
      expect(matchesFacets(row, DEFAULT_USAGE_FACETS)).toBe(true);
    }
  });

  test("narrows to one forecast band", () => {
    expect(
      matchesFacets(makeIssue({ forecast: "S" }), facets({ forecast: "S" })),
    ).toBe(true);
    expect(
      matchesFacets(makeIssue({ forecast: "M" }), facets({ forecast: "S" })),
    ).toBe(false);
  });

  /**
   * A row `gh` could supply no band for is *not* in any band's results. The
   * alternative is the lie the whole page is built to refuse: an unknown
   * forecast filed under a band the page chose for it.
   */
  test("leaves a row with no forecast out of every band", () => {
    for (const band of USAGE_FACETS.forecast.options) {
      expect(matchesFacets(unforecast, facets({ forecast: band.value }))).toBe(
        false,
      );
    }
  });

  test("narrows to one verdict", () => {
    const over = makeIssue({
      forecast: "S",
      bucket: "M",
      verdict: VERDICT.over,
    });

    expect(matchesFacets(over, facets({ verdict: VERDICT.over }))).toBe(true);
    expect(matchesFacets(over, facets({ verdict: VERDICT.onTarget }))).toBe(
      false,
    );
  });

  /** The two rows that carry no verdict — nothing forecast, or nothing spent —
   *  are out of all three, for the reason the accuracy figure never scores
   *  them: there is no verdict to be equal to. */
  test("leaves an unscored row out of every verdict", () => {
    for (const verdict of USAGE_FACETS.verdict.options) {
      expect(matchesFacets(unstarted, facets({ verdict: verdict.value }))).toBe(
        false,
      );
      expect(
        matchesFacets(unforecast, facets({ verdict: verdict.value })),
      ).toBe(false);
    }
  });

  test("narrows to started, and to unstarted", () => {
    const started = makeIssue();

    expect(
      matchesFacets(started, facets({ started: USAGE_STARTED.started })),
    ).toBe(true);
    expect(
      matchesFacets(started, facets({ started: USAGE_STARTED.unstarted })),
    ).toBe(false);
    expect(
      matchesFacets(unstarted, facets({ started: USAGE_STARTED.unstarted })),
    ).toBe(true);
    expect(
      matchesFacets(unstarted, facets({ started: USAGE_STARTED.started })),
    ).toBe(false);
  });

  /**
   * The whole reason this facet asks about `spend` rather than about `out`.
   *
   * A row that recorded zero output tokens is a measurement: somebody worked on
   * the issue and the transcripts say what it cost. Read off the figure, it
   * would be filed as unstarted — the same substitution `bucketFor(0) === "S"`
   * makes everywhere else on this page, arriving at a filter.
   */
  test("calls a row that recorded zero output tokens started", () => {
    const zero = makeIssue({
      spend: { out: 0, turns: 1, sessions: 1, cacheRead: 0 },
      bucket: "S",
      verdict: VERDICT.onTarget,
    });

    expect(
      matchesFacets(zero, facets({ started: USAGE_STARTED.started })),
    ).toBe(true);
    expect(
      matchesFacets(zero, facets({ started: USAGE_STARTED.unstarted })),
    ).toBe(false);
  });

  /**
   * The facets compose with each other, which is what makes the empty state
   * reachable from the bar alone: two answers that are each true of some row
   * and of no row together.
   */
  test("requires every facet a developer has set, not any of them", () => {
    const row = makeIssue({
      forecast: "S",
      bucket: "S",
      verdict: VERDICT.onTarget,
    });

    expect(
      matchesFacets(row, facets({ forecast: "S", verdict: VERDICT.onTarget })),
    ).toBe(true);
    expect(
      matchesFacets(row, facets({ forecast: "S", verdict: VERDICT.over })),
    ).toBe(false);
    expect(
      matchesFacets(row, facets({ forecast: "M", verdict: VERDICT.onTarget })),
    ).toBe(false);
  });

  /**
   * Every facet the state carries reaches the bar, and every one on the bar
   * offers something to narrow with.
   *
   * `UsageFilters` walks `USAGE_FACET_KEYS` — a list, because a record's key
   * order means nothing — so a facet added to `UsageFacets` and left out of it
   * would compile, would be matched on, and would have no control anywhere to
   * set it. That is the same sweep `usage-sort.test.ts` makes over
   * `USAGE_SORT_KEYS` for the sortable columns.
   */
  test("puts every facet the state carries on the bar, with rows to pick", () => {
    expect([...USAGE_FACET_KEYS].sort()).toEqual(
      Object.keys(DEFAULT_USAGE_FACETS).sort(),
    );
    for (const key of USAGE_FACET_KEYS) {
      expect(USAGE_FACETS[key].options.length).toBeGreaterThan(0);
      expect(USAGE_FACETS[key].label).not.toBe("");
      expect(USAGE_FACETS[key].any).not.toBe("");
      expect(DEFAULT_USAGE_FACETS[key]).toBe(ANY_FACET);
    }
  });

  /** The "any" token is what a facet's clearing row carries, and it has to be
   *  something Radix will accept as a `SelectItem` value. */
  test("treats the any token as no constraint at all", () => {
    expect(ANY_FACET).not.toBe("");
    expect(matchesFacets(unstarted, facets({ forecast: ANY_FACET }))).toBe(
      true,
    );
  });
});
