import { describe, expect, it } from "vitest";
import { BUCKETS, type IssueUsage } from "./usage-protocol";
import {
  bandEdges,
  forecastAccuracy,
  localDay,
  percentiles,
  recordedSpend,
  trendPointFor,
} from "./usage-readings";

/**
 * A day's trend point (#419): what it holds, and which day it is filed under.
 * The store's replace-not-append rule is `apps/web/dev/usage.test.ts`'s, through
 * `gatherUsage` with an injected clock.
 */

const row = (over: Partial<IssueUsage> = {}): IssueUsage => ({
  issue: 101,
  spend: { out: 20_000, turns: 2, sessions: 1, cacheRead: 0 },
  title: null,
  url: null,
  forecast: "S",
  bucket: "S",
  verdict: "on target",
  ...over,
});

const ROWS: IssueUsage[] = [
  row(),
  row({
    issue: 102,
    spend: { out: 3000, turns: 1, sessions: 1, cacheRead: 0 },
    forecast: null,
    verdict: null,
  }),
  row({
    issue: 105,
    spend: { out: 90_000, turns: 3, sessions: 1, cacheRead: 0 },
    bucket: "M",
    verdict: "over",
  }),
  // Unstarted: in neither the sample nor the score.
  row({ issue: 110, spend: null, bucket: null, verdict: null, forecast: "L" }),
];

describe("trendPointFor", () => {
  it("holds the quartiles and the accuracy the panels compute from the same rows", () => {
    const point = trendPointFor(ROWS, new Date(2026, 9, 4, 12));
    const { p25, p50, p75 } = percentiles(recordedSpend(ROWS));
    const { scored, onTarget } = forecastAccuracy(ROWS);

    expect(point).toMatchObject({
      measured: 3,
      p25,
      median: p50,
      p75,
      scored,
      onTarget,
    });
    // The fixture's own figures, so the arithmetic is not only agreeing with
    // itself.
    expect(point).toMatchObject({
      p25: 3000,
      median: 20_000,
      p75: 90_000,
      scored: 2,
      onTarget: 1,
    });
  });

  it("carries the band edges in force when it was written", () => {
    expect(trendPointFor(ROWS, new Date()).edges).toEqual({
      S: BUCKETS.S.max,
      M: BUCKETS.M.max,
      L: BUCKETS.L.max,
    });
    expect(bandEdges()).toEqual({ S: 60_000, M: 150_000, L: 250_000 });
  });

  it("stamps the scan's moment and files it under that moment's local day", () => {
    const at = new Date(2026, 9, 4, 23, 59);

    const point = trendPointFor(ROWS, at);

    expect(point.at).toBe(at.toISOString());
    expect(point.day).toBe("2026-10-04");
  });

  it("measures nothing when nothing was spent, rather than three zeroes that look like figures", () => {
    const point = trendPointFor([], new Date());

    expect(point.measured).toBe(0);
    expect(point.scored).toBe(0);
  });
});

// That the day is the local one rather than UTC's needs `process.env.TZ`, which
// `src/` has no Node types for: it is `apps/web/dev/usage.test.ts`'s, through
// `gatherUsage`, on both sides of the date line.
describe("localDay", () => {
  it("pads the month and the day", () => {
    expect(localDay(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});
