/**
 * The two readings the Usage page's charts draw, derived from the rows the scan
 * already sent.
 *
 * This is the page's pure half — the two readings, and the one way it prints a
 * figure — separate from the chart components for the reason `mini-rows.ts`
 * and `kpi-status.ts` sit beside the dashboard's panels: what a chart *says* is
 * worth a unit test, and what it *looks like* is not one a unit test can hold —
 * Recharts renders nothing in jsdom, where every container measures zero. So
 * the arithmetic is tested here, the page's copy and empty states in
 * `UsagePage.test.tsx`, and the drawn result in `tests/e2e/dev-usage.spec.ts`.
 *
 * Nothing here recomputes a figure a row already carries. The verdict on each
 * row is `verdictFor`'s, from the shared join in `apps/web/dev/usage.ts`, and
 * the bands and quartiles are `protocol.ts`'s — so the accuracy figure on the
 * page and the one `bun run tokens` prints are the same tally of the same
 * words, not two implementations that agree today.
 *
 * **Both readings exclude the same rows, and that is the whole of it.** Since
 * #251 a row can exist with no recorded work at all — every open issue gets
 * one. Counting those as zeroes would score an unstarted ticket as having beaten
 * its estimate (`bucketFor(0)` is `S`, so a `forecast/L` read against it prints
 * "under") and would file it among the cheapest tickets in the distribution,
 * dragging every quartile toward zero as the backlog grows. `bun run tokens`
 * keeps them out of both figures for the same reason; this is that rule said
 * again on the other side of the wire.
 */

import {
  BUCKETS,
  VERDICT,
  bucketFor,
  percentiles,
  type Bucket,
  type IssueUsage,
  type Verdict,
} from "./protocol";

/**
 * A whole number of tokens, grouped for reading.
 *
 * The terminal table rounds (`120k`) because it is budgeting column widths; this
 * page has room, and the PRD's complaint about the CLI is that the numbers are
 * hard to read rather than that they are too precise. The locale is pinned
 * rather than left to the machine, so the figure a test asserts is the figure
 * every developer sees.
 *
 * One copy for the table and the charts. A quartile drawn as `90,000` beside a
 * column of `90000`s is the kind of small inconsistency nothing fails over and
 * everyone notices.
 */
export const formatTokens = (n: number): string => n.toLocaleString("en-US");

/**
 * The verdicts in reading order: what was overestimated, what was right, what
 * was underestimated.
 *
 * Not `Object.values(VERDICT)`, whose order is the record's and means nothing.
 * This one is an axis — the two misses sit either side of the hit, so the shape
 * of the column chart is the shape of the error, and a reader sees which way the
 * bands are wrong before reading a single label.
 */
export const ACCURACY_ORDER = [
  VERDICT.under,
  VERDICT.onTarget,
  VERDICT.over,
] as const;

export interface AccuracyBin {
  verdict: Verdict;
  count: number;
}

export interface ForecastAccuracy {
  /** All three, always, in `ACCURACY_ORDER` — a zero is a result. */
  bins: AccuracyBin[];
  /** Rows carrying a verdict: the denominator, and what "nothing to score"
   *  means when it is zero. */
  scored: number;
  onTarget: number;
}

/**
 * How often the band an issue was cut with matched what it actually cost.
 *
 * Gated on the verdict rather than on the forecast, which is the same gate
 * `bun run tokens` uses and for the same measured reason: a row can carry a
 * band and no spend to read it against, and counting those as scored-and-missed
 * would walk the accuracy figure toward zero every time somebody files a
 * ticket.
 *
 * Every bin is returned whether or not anything landed in it. A chart that drops
 * its empty columns has axes that move as the data does, and "nothing came in
 * over" is a finding, not an absence.
 */
export function forecastAccuracy(issues: IssueUsage[]): ForecastAccuracy {
  const counts = new Map<Verdict, number>(ACCURACY_ORDER.map((v) => [v, 0]));
  for (const row of issues) {
    if (!row.verdict) continue;
    counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
  }
  const bins = ACCURACY_ORDER.map((verdict) => ({
    verdict,
    count: counts.get(verdict) ?? 0,
  }));
  return {
    bins,
    scored: bins.reduce((sum, b) => sum + b.count, 0),
    onTarget: counts.get(VERDICT.onTarget) ?? 0,
  };
}

/** Which quartile a mark is, as the word the chart prints. */
export type PercentileKey = "p25" | "median" | "p75";

export interface PercentileMark {
  key: PercentileKey;
  value: number;
  /**
   * The band this quartile falls in — the only reason the browser half needed
   * `bucketFor` at all. A quartile is a figure no row carries, so it has to be
   * placed against the bands by the same arithmetic that placed the rows, or
   * the mark and the column under it could disagree about the boundary.
   */
  band: Bucket;
}

export interface DistributionBin {
  band: Bucket;
  /** The range the letter means, from `BUCKETS` — the axis is jargon without
   *  it. */
  label: string;
  count: number;
}

export interface OutputDistribution {
  /** All four bands, `BUCKETS` order, S to XL. */
  bins: DistributionBin[];
  /** Rows with recorded spend — the sample size, and the only honest test of
   *  whether there is a distribution to draw. */
  measured: number;
  /** p25, median and p75 in that order, or **empty** when nothing has been
   *  spent. See below. */
  marks: PercentileMark[];
}

/**
 * What issues in this repository actually cost, against the bands they are
 * forecast in.
 *
 * The question it answers is not "what did we spend" but "do these bands still
 * fit the work" — they were fixed off one measurement of 90 branches and
 * nothing has re-checked them since, so the quartiles are the point and the
 * columns are the context.
 *
 * **No marks at all when nothing has been spent**, rather than three at the
 * origin. `percentiles([])` answers 0/0/0 by design, which a caller formatting a
 * figure wants and a caller *drawing* one must not take: three lines on the S
 * column would read as a repository of very cheap tickets rather than as no
 * measurement. `measured` is the honest test, and it is what the page branches
 * on.
 */
export function outputDistribution(issues: IssueUsage[]): OutputDistribution {
  const spent = issues.flatMap((row) => (row.spend ? [row.spend.out] : []));
  const counts = new Map<Bucket, number>(
    (Object.keys(BUCKETS) as Bucket[]).map((band) => [band, 0]),
  );
  for (const out of spent) {
    const band = bucketFor(out);
    counts.set(band, (counts.get(band) ?? 0) + 1);
  }

  const { p25, p50, p75 } = percentiles(spent);
  const mark = (key: PercentileKey, value: number): PercentileMark => ({
    key,
    value,
    band: bucketFor(value),
  });

  return {
    bins: (Object.keys(BUCKETS) as Bucket[]).map((band) => ({
      band,
      label: BUCKETS[band].label,
      count: counts.get(band) ?? 0,
    })),
    measured: spent.length,
    marks: spent.length
      ? [mark("p25", p25), mark("median", p50), mark("p75", p75)]
      : [],
  };
}
