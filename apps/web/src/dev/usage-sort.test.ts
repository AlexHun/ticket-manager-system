import { describe, expect, test } from "vitest";
import type { IssueUsage } from "./usage-protocol";
import {
  DEFAULT_USAGE_SORT,
  USAGE_SORT_KEYS,
  nextSort,
  sortIssues,
  type UsageSortKey,
} from "./usage-sort";

/**
 * The ranking the table's headers drive, and the one row it must refuse to
 * rank.
 *
 * Every case here is about the sink. The arithmetic is a subtraction — what
 * earns a unit test is that an issue nobody has started is an *absence* rather
 * than a small spend, and that this holds whichever column is clicked and
 * whichever way round it is. `bucketFor(0)` is `S`, so a row treated as zero
 * ascending floats to the top as the cheapest work in the repository: the same
 * lie the page refuses to tell in its cells, told in its ordering instead.
 *
 * Tested here rather than through the page for the reason `usage-charts.ts` is:
 * the rule is a property of the comparator over a set of rows, and a component
 * test can only ask it about the three or four rows it happened to render.
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
    verdict: "on target",
    ...over,
  };
}

/** An open issue nobody has started: a band, and no figures at all. The whole
 *  subject of this file. */
const unstarted = (issue: number): IssueUsage =>
  makeIssue({ issue, spend: null, bucket: null, verdict: null });

/** A row carrying a figure, for the key under test, so a case can name the one
 *  number it is about. */
const withFigure = (issue: number, over: Partial<IssueUsage["spend"]>) =>
  makeIssue({
    issue,
    spend: { out: 20_000, turns: 2, sessions: 1, cacheRead: 400_000, ...over },
  });

const numbersOf = (rows: IssueUsage[]) => rows.map((row) => row.issue);

describe("sortIssues", () => {
  /**
   * The default is the order the rows arrive in, so the first render after a
   * scan does not reshuffle in front of the developer.
   *
   * `joinIssues` in `apps/web/dev/usage.ts` sorts the rows it puts on the wire
   * by calling `sortIssues` with this very default (#286), so the three
   * properties asserted here — output tokens descending, the issue number
   * breaking ties upward, and the unstarted rows in a block at the end — are
   * the server's order *and* the table's opening state in one reading. They
   * used to be this comparator's half of a claim the node side wrote out again
   * in a `rank` of its own; this case was what held the two together, and it is
   * unchanged because the properties did not move, only the second copy.
   */
  test("opens on output tokens descending, matching the order rows arrive in", () => {
    const rows = [
      unstarted(300),
      withFigure(102, { out: 3_000 }),
      withFigure(101, { out: 20_000 }),
      unstarted(200),
    ];

    expect(numbersOf(sortIssues(rows, DEFAULT_USAGE_SORT))).toEqual([
      101, 102, 200, 300,
    ]);
  });

  test("ranks by whichever figure the key names", () => {
    const rows = [
      withFigure(1, { turns: 9, sessions: 1, cacheRead: 30 }),
      withFigure(2, { turns: 1, sessions: 7, cacheRead: 20 }),
      withFigure(3, { turns: 5, sessions: 4, cacheRead: 10 }),
    ];

    expect(
      numbersOf(sortIssues(rows, { key: "turns", descending: true })),
    ).toEqual([1, 3, 2]);
    expect(
      numbersOf(sortIssues(rows, { key: "sessions", descending: true })),
    ).toEqual([2, 3, 1]);
    expect(
      numbersOf(sortIssues(rows, { key: "cacheRead", descending: false })),
    ).toEqual([3, 2, 1]);
    expect(
      numbersOf(sortIssues(rows, { key: "issue", descending: true })),
    ).toEqual([3, 2, 1]);
  });

  /**
   * The ticket's real constraint, asked of every key in both directions rather
   * than of the one column it is easiest to demonstrate on: the sink is a
   * property of the comparator, not of the output-tokens column.
   */
  test.each(
    USAGE_SORT_KEYS.flatMap((key) =>
      [true, false].map((descending) => ({ key, descending })),
    ),
  )(
    "puts a row with no recorded spend last, sorting $key descending=$descending",
    ({ key, descending }: { key: UsageSortKey; descending: boolean }) => {
      const rows = [
        unstarted(300),
        withFigure(101, { out: 20_000, turns: 2, sessions: 1, cacheRead: 400 }),
        unstarted(200),
        withFigure(102, { out: 3_000, turns: 1, sessions: 3, cacheRead: 900 }),
      ];

      const sorted = sortIssues(rows, { key, descending });

      expect(sorted.slice(0, 2).every((row) => row.spend !== null)).toBe(true);
      // As a set: which way round the two sunk rows sit is the next case's
      // subject, and it is not what "last in both directions" claims.
      expect(numbersOf(sorted.slice(2)).sort()).toEqual([200, 300]);
    },
  );

  /**
   * Inside the sunk block the clicked column still ranks whatever it can.
   *
   * For the four figures that is nothing — an unstarted row has none — so the
   * issue number orders them ascending, the same tie-break the rest of the
   * table uses. The issue number is the one sortable column an unstarted row
   * *does* carry, and reversing it reverses the block too: a column of numbers
   * that descended down the table and then turned round at the dashes would be
   * the header lying about what it did.
   */
  test("ranks the sunk block by the one column an unstarted row carries", () => {
    const rows = [
      unstarted(300),
      withFigure(101, { out: 20_000 }),
      unstarted(200),
    ];

    expect(
      numbersOf(sortIssues(rows, { key: "issue", descending: true })),
    ).toEqual([101, 300, 200]);
    expect(
      numbersOf(sortIssues(rows, { key: "issue", descending: false })),
    ).toEqual([101, 200, 300]);
    // And a figure column, which they carry nothing for, leaves them ascending
    // whichever way the figures above them are ranked.
    expect(
      numbersOf(sortIssues(rows, { key: "out", descending: true })),
    ).toEqual([101, 200, 300]);
    expect(
      numbersOf(sortIssues(rows, { key: "out", descending: false })),
    ).toEqual([101, 200, 300]);
  });

  /**
   * The sink is about an *absence*, and this is the case that says so: a row
   * that really spent zero is a measurement and sorts as the cheapest work
   * there is, while the row that recorded nothing stays below it. They would
   * be indistinguishable if a missing spend were read as a zero — which is
   * exactly the substitution `IssueSpend`'s nullability exists to prevent.
   */
  test("keeps a measured zero above a row that recorded nothing", () => {
    const rows = [
      unstarted(300),
      withFigure(102, { out: 0 }),
      withFigure(101, { out: 20_000 }),
    ];

    expect(
      numbersOf(sortIssues(rows, { key: "out", descending: false })),
    ).toEqual([102, 101, 300]);
  });

  /**
   * A total order, so a re-render never reshuffles rows the sort cannot tell
   * apart. Asserted from two different input orders rather than by sorting
   * twice: `Array.prototype.sort` is stable, so a second pass over an already
   * sorted array would agree with itself even if the comparator returned 0 for
   * every pair.
   */
  test("gives equal values one total order, whatever order they arrived in", () => {
    const tied = [1, 2, 3].map((issue) => withFigure(issue, { out: 5_000 }));

    for (const arrival of [tied, [...tied].reverse()]) {
      expect(
        numbersOf(sortIssues(arrival, { key: "out", descending: true })),
      ).toEqual([1, 2, 3]);
      expect(
        numbersOf(sortIssues(arrival, { key: "out", descending: false })),
      ).toEqual([1, 2, 3]);
    }
  });

  // The rows are the report's, and the report is one reading held by the page.
  test("leaves the rows it was given alone", () => {
    const rows = [
      withFigure(102, { out: 3_000 }),
      withFigure(101, { out: 20_000 }),
    ];

    sortIssues(rows, { key: "out", descending: true });

    expect(numbersOf(rows)).toEqual([102, 101]);
  });
});

describe("nextSort", () => {
  test("reverses the column that is already sorted", () => {
    expect(nextSort({ key: "out", descending: true }, "out")).toEqual({
      key: "out",
      descending: false,
    });
    expect(nextSort({ key: "out", descending: false }, "out")).toEqual({
      key: "out",
      descending: true,
    });
  });

  // Every sortable column here is a figure, and a figure is interesting from
  // the top — the biggest spend, the most sittings, the highest issue number.
  test("opens a new column descending", () => {
    expect(nextSort({ key: "out", descending: false }, "turns")).toEqual({
      key: "turns",
      descending: true,
    });
  });
});
