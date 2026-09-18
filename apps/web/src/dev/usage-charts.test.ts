import { describe, expect, test } from "vitest";
import { BUCKETS, VERDICT, type IssueUsage } from "./protocol";
import {
  ACCURACY_ORDER,
  forecastAccuracy,
  outputDistribution,
} from "./usage-charts";

/**
 * The two readings the charts draw, and the rows they must refuse to read.
 *
 * Everything here is about *exclusion*. Both figures are trivial arithmetic over
 * the rows; what earns a test is which rows they are allowed to see. An issue
 * nobody has started carries a band and no spend, and letting it into either
 * reading is the bug #251 spent a whole slice describing: `bucketFor(0)` is `S`,
 * so a zeroed unstarted row scores as "under" against any larger forecast and
 * lands in the smallest band, dragging the accuracy figure down and the
 * percentiles with it. It is not an edge case — every open ticket in the backlog
 * is one.
 */

/** A row with both halves: work recorded, and a band it was scored against. */
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

/** An open issue nobody has started: a band, and nothing else. */
const unstarted = (over: Partial<IssueUsage> = {}) =>
  makeIssue({ spend: null, bucket: null, verdict: null, ...over });

/** Spend, but no `forecast/S|M|L` label — so nothing to score it against. */
const unforecast = (out: number) =>
  makeIssue({
    spend: { out, turns: 1, sessions: 1, cacheRead: 0 },
    forecast: null,
    verdict: null,
  });

describe("forecastAccuracy", () => {
  test("counts the three verdicts, in under → on target → over order", () => {
    const result = forecastAccuracy([
      makeIssue({ issue: 1, verdict: VERDICT.over }),
      makeIssue({ issue: 2, verdict: VERDICT.onTarget }),
      makeIssue({ issue: 3, verdict: VERDICT.over }),
      makeIssue({ issue: 4, verdict: VERDICT.under }),
    ]);

    expect(result.bins.map((b) => b.verdict)).toEqual([...ACCURACY_ORDER]);
    expect(result.bins.map((b) => b.count)).toEqual([1, 1, 2]);
    expect(result.scored).toBe(4);
    expect(result.onTarget).toBe(1);
  });

  test("keeps all three bins when one of them is empty", () => {
    const result = forecastAccuracy([makeIssue({ verdict: VERDICT.onTarget })]);

    // A bin dropped for being zero is a chart whose columns move as the data
    // changes — and "nothing came in over" is a result worth seeing drawn.
    expect(result.bins).toHaveLength(3);
    expect(result.bins.map((b) => b.count)).toEqual([0, 1, 0]);
  });

  test("scores no row that carries no verdict", () => {
    // Both absences, which the page renders differently and this reads the
    // same: nothing was forecast, or nothing has been spent against a forecast.
    const result = forecastAccuracy([
      unforecast(90_000),
      unstarted({ issue: 2, forecast: "L" }),
    ]);

    expect(result.scored).toBe(0);
    expect(result.onTarget).toBe(0);
    expect(result.bins.map((b) => b.count)).toEqual([0, 0, 0]);
  });
});

describe("outputDistribution", () => {
  test("bins recorded spend by band, keeping every band and its label", () => {
    const result = outputDistribution([
      unforecast(10_000),
      unforecast(20_000),
      unforecast(90_000),
      unforecast(300_000),
    ]);

    expect(result.bins).toEqual([
      { band: "S", label: BUCKETS.S.label, count: 2 },
      { band: "M", label: BUCKETS.M.label, count: 1 },
      { band: "L", label: BUCKETS.L.label, count: 0 },
      { band: "XL", label: BUCKETS.XL.label, count: 1 },
    ]);
    expect(result.measured).toBe(4);
  });

  test("marks the quartiles with the band each one falls in", () => {
    const result = outputDistribution(
      [10_000, 40_000, 90_000, 200_000].map(unforecast),
    );

    expect(result.marks).toEqual([
      { key: "p25", value: 40_000, band: "S" },
      { key: "median", value: 90_000, band: "M" },
      { key: "p75", value: 200_000, band: "L" },
    ]);
  });

  test("leaves an issue nobody has started out of both the bins and the marks", () => {
    // The whole rule, in one assertion. Counted as a zero this row would add a
    // fifth measurement in band `S` and pull every quartile down with it.
    const result = outputDistribution([
      unforecast(90_000),
      unstarted({ issue: 2, forecast: "L" }),
    ]);

    expect(result.measured).toBe(1);
    expect(result.bins.find((b) => b.band === "S")?.count).toBe(0);
    expect(result.marks.map((m) => m.value)).toEqual([90_000, 90_000, 90_000]);
  });

  test("reports no marks at all when nothing has been spent", () => {
    // Not three marks at the origin: `percentiles([])` answers 0/0/0, which
    // draws as a measurement of very cheap tickets rather than as no
    // measurement. The caller shows its empty state off `measured`.
    const result = outputDistribution([unstarted(), unstarted({ issue: 2 })]);

    expect(result.measured).toBe(0);
    expect(result.marks).toEqual([]);
    expect(result.bins.every((b) => b.count === 0)).toBe(true);
  });
});
