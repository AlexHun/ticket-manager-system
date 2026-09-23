/**
 * The distribution the Usage page charts, shaped for an axis — and the one way
 * this page prints a figure.
 *
 * Pure, and separate from the chart components for the reason `mini-rows.ts` and
 * `kpi-status.ts` sit beside the dashboard's panels: what a chart *says* is worth
 * a unit test, and what it *looks like* is not one a unit test can hold —
 * Recharts renders nothing in jsdom, where every container measures zero. So the
 * arithmetic is tested here, the page's copy and empty states in
 * `UsagePage.test.tsx`, and the drawn result in `tests/e2e/dev-usage.spec.ts`.
 *
 * Nothing here recomputes a figure something else already owns. The verdict on
 * each row is `verdictFor`'s; the bands are `usage-protocol.ts`'s, and the
 * quartiles, the accuracy tally and the rule about which rows count are
 * `usage-readings.ts`'s — both of which `bun run tokens` imports directly
 * (#290). That is not tidiness: an accuracy figure the terminal and the page
 * each tallied for themselves would agree until somebody changed one, and
 * nothing would fail when they stopped.
 *
 * What is left here is what only a chart wants — bins with the band labels an
 * axis prints, and the quartiles placed against those bands as marks. The
 * exclusion rule they inherit arrives through `recordedSpend` and is stated
 * once, as `hasRecordedSpend` in `usage-readings.ts` (#285): a row with no
 * recorded work is an absence, never a zero. Nothing here restates it — which
 * is the point, since the same predicate is what dashes the cells and sinks the
 * rows in the table beside these charts.
 */

import { BUCKETS, type Bucket, type IssueUsage } from "./usage-protocol";
import { bucketFor, percentiles, recordedSpend } from "./usage-readings";

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
 * column would read as a repository of very cheap issues rather than as no
 * measurement. `measured` is the honest test, and it is what the page branches
 * on.
 */
export function outputDistribution(issues: IssueUsage[]): OutputDistribution {
  const spent = recordedSpend(issues);
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
