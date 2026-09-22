import { describe, expect, test } from "vitest";
import {
  USAGE_DETAIL,
  USAGE_STARTED,
  VERDICT,
  type IssueUsage,
} from "./usage-protocol";
import { DEFAULT_USAGE_FACETS } from "./usage-facets";
import {
  DEFAULT_USAGE_SORT,
  USAGE_SORT_KEYS,
  type UsageSort,
} from "./usage-sort";
import {
  DEFAULT_USAGE_TABLE_VIEW,
  visibleRows,
  withDetail,
  type UsageTableView,
} from "./usage-view";

/**
 * What the Usage table's bar shows, asked without rendering anything (#287).
 *
 * The composition is the subject here, and it is the part nothing could reach
 * before this module existed. `usage-sort.test.ts` asks the comparator about an
 * ordering and `usage-facets.test.ts` asks a predicate about one row; what
 * neither can ask is whether the four controls narrow the *same* list, in the
 * order that keeps the ranking honest, and what the detail toggle does to a
 * sort it is about to take the header away from. That question used to need a
 * page, an axios stub and a button press — see `UsagePage.test.tsx`, which
 * still asks it that way until slice 6 moves those cases here.
 *
 * Every row below is made up on purpose. A filter is a claim about every row
 * the scan could produce, and the four the E2E fixture holds are not a sample
 * of anything.
 */

/** A row with work recorded against it — the ordinary case every row varies. */
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

/**
 * Four rows, chosen so every assertion below can fail.
 *
 * `#105` leads the default ranking and `#102` trails the started block, so a
 * narrowing that removed the leader is visibly still ranked rather than
 * accidentally in arrival order. `#101` and `#105` share a forecast band and
 * differ in verdict, which is what lets one facet narrow while another does
 * not. `#300` is an open issue nobody has started: it carries a band, no
 * figures at all, and sinks under every key in both directions.
 */
const OVER = makeIssue({
  issue: 105,
  spend: { out: 90_000, turns: 9, sessions: 2, cacheRead: 50_000 },
  title: "Over budget fixture",
  forecast: "S",
  bucket: "L",
  verdict: VERDICT.over,
});

const ON_TARGET = makeIssue({
  issue: 101,
  spend: { out: 20_000, turns: 2, sessions: 1, cacheRead: 400_000 },
  title: "Ranking the table from its headers",
});

const UNDER = makeIssue({
  issue: 102,
  spend: { out: 9_000, turns: 5, sessions: 3, cacheRead: 100_000 },
  title: "The filter bar's reach",
  forecast: "M",
  bucket: "S",
  verdict: VERDICT.under,
});

const UNSTARTED = makeIssue({
  issue: 300,
  spend: null,
  title: "Nobody has started the work on this one",
  forecast: "L",
  bucket: null,
  verdict: null,
});

/** Deliberately not in the default ranking: `visibleRows` is what puts them in
 *  one, so handing it a pre-sorted list would hide a missing `sortIssues`. */
const ISSUES = [ON_TARGET, UNSTARTED, OVER, UNDER];

const numbersOf = (rows: IssueUsage[]) => rows.map((row) => row.issue);

const view = (over: Partial<UsageTableView> = {}): UsageTableView => ({
  ...DEFAULT_USAGE_TABLE_VIEW,
  ...over,
});

const facets = (over: Partial<UsageTableView["facets"]> = {}) => ({
  ...DEFAULT_USAGE_FACETS,
  ...over,
});

describe("DEFAULT_USAGE_TABLE_VIEW", () => {
  /**
   * The state the table opens on, and comes back to after a re-scan. It is the
   * order the server sent (#286) with nothing narrowing it and the detail
   * columns away — asserted against the other modules' own defaults rather
   * than against literals, because a default restated here is a second copy of
   * a claim two other suites already hold.
   */
  test("opens on the server's ranking with nothing narrowed", () => {
    expect(DEFAULT_USAGE_TABLE_VIEW).toEqual({
      sort: DEFAULT_USAGE_SORT,
      detail: false,
      query: "",
      facets: DEFAULT_USAGE_FACETS,
    });
  });

  test("shows every row at rest", () => {
    expect(numbersOf(visibleRows(ISSUES, DEFAULT_USAGE_TABLE_VIEW))).toEqual([
      105, 101, 102, 300,
    ]);
  });
});

describe("visibleRows — the search term", () => {
  /**
   * The issue number is matched **as the row prints it**, so the `#101` a
   * developer copies out of the table or out of a commit message is a term
   * that matches. A bare `101` still is, since the hash is a prefix.
   */
  test("matches the issue number with or without the hash", () => {
    expect(numbersOf(visibleRows(ISSUES, view({ query: "#101" })))).toEqual([
      101,
    ]);
    expect(numbersOf(visibleRows(ISSUES, view({ query: "101" })))).toEqual([
      101,
    ]);
  });

  test("matches words from a title", () => {
    expect(
      numbersOf(visibleRows(ISSUES, view({ query: "filter bar" }))),
    ).toEqual([102]);
  });

  /**
   * The term arrives **raw**: `UsageTableView.query` is the search box's own
   * value, debounced on its way in but never normalised, because normalising it
   * up there would make the box show something other than what was typed. So
   * the trimming and the lowercasing are this module's job, and
   * `matchesQuery`'s "arrives trimmed and lowercased" contract is satisfied
   * here rather than by every caller.
   */
  test("trims and lowercases the term it is given", () => {
    expect(
      numbersOf(visibleRows(ISSUES, view({ query: "  OVER Budget  " }))),
    ).toEqual([105]);
  });

  /** An untouched box matches everything — `matchesQuery`'s rule, which is what
   *  lets this module filter unconditionally instead of branching on "is the
   *  developer narrowing". */
  test("matches every row while the box is empty or blank", () => {
    for (const query of ["", "   "]) {
      expect(numbersOf(visibleRows(ISSUES, view({ query })))).toHaveLength(
        ISSUES.length,
      );
    }
  });

  /** A row `gh` could say nothing about has no title to search, and is not a
   *  match rather than a crash. */
  test("survives a row with no title", () => {
    const untitled = makeIssue({ issue: 7, title: null, url: null });
    expect(
      numbersOf(visibleRows([...ISSUES, untitled], view({ query: "budget" }))),
    ).toEqual([105]);
  });
});

describe("visibleRows — the facets", () => {
  test("narrows to a forecast band", () => {
    expect(
      numbersOf(
        visibleRows(ISSUES, view({ facets: facets({ forecast: "S" }) })),
      ),
    ).toEqual([105, 101]);
  });

  test("narrows to a verdict", () => {
    expect(
      numbersOf(
        visibleRows(
          ISSUES,
          view({ facets: facets({ verdict: VERDICT.over }) }),
        ),
      ),
    ).toEqual([105]);
  });

  /** `started` asks whether spend is present, so the row with a band and no
   *  figures is the only one left — the page's central distinction, told in a
   *  filter rather than in a cell. */
  test("narrows to the issues nobody has started", () => {
    expect(
      numbersOf(
        visibleRows(
          ISSUES,
          view({ facets: facets({ started: USAGE_STARTED.unstarted }) }),
        ),
      ),
    ).toEqual([300]);
  });
});

describe("visibleRows — the four controls compose", () => {
  /**
   * The composition is what makes the shown-out-of-total count able to describe
   * all four controls at once, and it is the reason this is one `&&` rather
   * than two passes. A row that answers the box and fails a facet is out.
   */
  test("keeps only the rows every control agrees on", () => {
    expect(
      numbersOf(
        visibleRows(
          ISSUES,
          view({
            query: "the",
            facets: facets({ verdict: VERDICT.onTarget }),
          }),
        ),
      ),
    ).toEqual([101]);
  });

  /**
   * Two answers each true of some row and of no row together. The empty result
   * is the state the bar's own empty message exists for, and it is reachable
   * from the controls alone — a facet that derived its options from the rows on
   * screen could never produce it (#274).
   */
  test("returns nothing when the controls contradict each other", () => {
    expect(
      visibleRows(
        ISSUES,
        view({ query: "budget", facets: facets({ verdict: VERDICT.under }) }),
      ),
    ).toEqual([]);
  });
});

describe("visibleRows — filtered, then ranked", () => {
  /**
   * The order matters and this is where it is held: what is left after the
   * narrowing is ranked, rather than the ranking being narrowed. Dropping the
   * row that leads the table is what makes the two distinguishable — the
   * remainder here is not in arrival order, so a `visibleRows` that forgot to
   * sort would fail rather than coincide.
   */
  test("ranks what the controls left rather than leaving arrival order", () => {
    expect(
      numbersOf(
        visibleRows(
          ISSUES,
          view({
            sort: { key: "turns", descending: false },
            facets: facets({ started: USAGE_STARTED.started }),
          }),
        ),
      ),
    ).toEqual([101, 102, 105]);
  });

  /** The sink survives the narrowing: an empty actual is not a small one,
   *  whatever else is on the bar and whichever way the column points. */
  test("sinks an unstarted row through every key in both directions", () => {
    for (const key of USAGE_SORT_KEYS) {
      for (const descending of [true, false]) {
        const rows = visibleRows(
          ISSUES,
          view({ sort: { key, descending }, query: "the" }),
        );
        expect(numbersOf(rows).at(-1)).toBe(300);
      }
    }
  });

  /** The rows belong to the report the page is holding; a reading is not a
   *  working set. */
  test("leaves the list it was given untouched", () => {
    const before = numbersOf(ISSUES);
    visibleRows(ISSUES, view({ sort: { key: "out", descending: false } }));
    expect(numbersOf(ISSUES)).toEqual(before);
  });
});

describe("withDetail", () => {
  /**
   * The rule this module exists to make askable without a renderer: hiding the
   * detail columns while the table is ranked by one of them returns the sort to
   * the default. The alternative is rows in an order with no arrow, no
   * `aria-sort` and nothing on screen saying why.
   *
   * Looped over `USAGE_DETAIL` rather than written out three times, so a fourth
   * detail column arrives already covered — and cannot arrive at all unless it
   * is something the table can rank by, which is what the module's `satisfies`
   * holds.
   */
  test.each(USAGE_DETAIL)(
    "returns the sort to the default when %s's column is hidden",
    (key) => {
      const sorted = view({ detail: true, sort: { key, descending: false } });
      expect(withDetail(sorted, false)).toEqual({
        ...sorted,
        detail: false,
        sort: DEFAULT_USAGE_SORT,
      });
    },
  );

  /**
   * The spine's two sortable columns keep their header either way, so hiding
   * the detail three says nothing about them. A reset here would throw away a
   * ranking the developer can still see the arrow on.
   */
  test.each(
    USAGE_SORT_KEYS.filter((key) => !USAGE_DETAIL.some((name) => name === key)),
  )("keeps a sort on %s when the detail columns are hidden", (key) => {
    const sort: UsageSort = { key, descending: false };
    expect(withDetail(view({ detail: true, sort }), false).sort).toEqual(sort);
  });

  /** Showing the columns never resets anything — the reset is about a header
   *  going away, and this is the gesture that brings one back. */
  test("keeps a sort on a detail column when the columns are shown", () => {
    const sort: UsageSort = { key: "turns", descending: false };
    expect(withDetail(view({ sort }), true)).toEqual(
      view({ sort, detail: true }),
    );
  });

  /** The toggle is one of four controls on one bar, and it speaks for none of
   *  the others: a reset that cleared the box would take the developer's search
   *  away in a gesture about columns. */
  test("leaves the query and the facets alone in both directions", () => {
    const narrowed = view({
      detail: true,
      sort: { key: "cacheRead", descending: true },
      query: "budget",
      facets: facets({ forecast: "S" }),
    });

    for (const next of [false, true]) {
      const after = withDetail(narrowed, next);
      expect(after.query).toBe(narrowed.query);
      expect(after.facets).toEqual(narrowed.facets);
      expect(after.detail).toBe(next);
    }
  });
});
