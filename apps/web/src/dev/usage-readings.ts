/**
 * What the Usage page and `bun run tokens` both compute from the wire's rows:
 * the band a figure lands in, the quartiles, the accuracy tally, the
 * distribution's sample — and `hasRecordedSpend`, the page's central rule,
 * which every one of those asks before it reads a figure.
 *
 * Split out of `./usage-protocol` in #297, and by reader: the node half, the
 * terminal and the browser all import this, where the column order and the UI
 * copy beside it (`./usage-copy`) are the browser's alone.
 *
 * **Its one import carries the `.ts` extension, and must.** `apps/web/dev/`
 * reaches this module by relative path under Vite's native config loader, which
 * resolves nothing extensionless in anything it pulls in — the trap
 * `./usage-sort` found in #286. It imports the wire and nothing else, and the
 * wire imports nothing, so there is no cycle for that loader to fail on.
 */

import {
  BUCKETS,
  VERDICT,
  type Bucket,
  type IssueSpend,
  type IssueUsage,
  type Verdict,
} from "./usage-protocol.ts";

/**
 * The band an actual spend lands in. `max` is exclusive, so a figure sitting
 * exactly on a boundary belongs to the band above it.
 *
 * Shared rather than in the scan, for the reason `BUCKETS` is on the wire:
 * this is the arithmetic that turns those boundaries into a letter, and since
 * #252 both halves do it. The scan puts a letter on every row; the page's
 * distribution chart has to place a *percentile* in the same bands, and a
 * percentile is a figure no row carries. A second `find` over the
 * same record, written in the browser, is exactly the drift one record exists
 * to stop. Every reader imports it from here — the scan, the charts and
 * `bun run tokens` alike, the last of which reached it through a re-export in
 * `apps/web/dev/usage.ts` until #290.
 */
export const bucketFor = (out: number): Bucket =>
  (Object.keys(BUCKETS) as Bucket[]).find((b) => out < BUCKETS[b].max) ?? "XL";

/**
 * The quartiles of a set of output-token totals.
 *
 * Nearest-rank on the sorted values — the arithmetic `bun run tokens` has
 * always printed, and since #252 what the Usage page marks on its distribution
 * chart. One copy, for the reason `BUCKETS` is one copy: a terminal and a page
 * each computing their own median would disagree about this repository's own
 * size eventually, and nothing would fail when they did.
 *
 * An empty set reports zeroes rather than `undefined`, so a caller formatting
 * the result need not branch. But a caller deciding whether there is a
 * distribution *at all* must ask how many values it was given, not whether
 * these came back zero — three marks at the origin read as very cheap issues
 * rather than as no measurement. Both callers ask: the CLI prints "no
 * distribution to report", and the chart says the same in its own words.
 */
export function percentiles(values: number[]): {
  p25: number;
  p50: number;
  p75: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.floor(sorted.length * q)] ?? 0;
  return { p25: at(0.25), p50: at(0.5), p75: at(0.75) };
}

/**
 * The verdicts in reading order: what was overestimated, what was right, what
 * was underestimated.
 *
 * Not `Object.values(VERDICT)`, whose order is the record's and means nothing.
 * This one is an axis — the two misses sit either side of the hit, so the shape
 * of the accuracy chart's columns is the shape of the error, and a reader sees
 * which way the bands are wrong before reading a single label.
 *
 * It stopped being the chart's alone in #274: the verdict facet's rows read in
 * this order too, and take it from here, for the same reason the columns do —
 * under, on target, over is the axis the words sit on, and a select that listed
 * them in some other order would be a second opinion about what that order
 * means. Beside `forecastAccuracy` below rather than beside `VERDICT` since
 * #297: the tally is the first thing that spends it, and the wire has no reader
 * that needs an order.
 */
export const ACCURACY_ORDER = [
  VERDICT.under,
  VERDICT.onTarget,
  VERDICT.over,
] as const;

/**
 * Whether the transcripts recorded any work at all against this issue — **the
 * page's central claim, and since #285 the one place the page states it** (R2).
 *
 * A row with no recorded spend is an *absence*, not a zero. `bucketFor(0)` is
 * `S`, so a row read as zero would be filed in the smallest band, scored
 * "under" against whatever it was forecast at, and counted in the quartiles —
 * which would put every unstarted issue in the backlog in the table claiming to
 * have beaten its estimate, and drag the accuracy figure and the distribution
 * down with it as the backlog grows.
 *
 * It asks `spend !== null` and deliberately **not** `out > 0`: a turn can
 * record no output tokens at all, so an issue really can have spent zero. That
 * is a measurement, and it ranks, bands and scores like any other figure.
 *
 * Four callers read it and none re-derives it — the table's comparator
 * (`sortIssues` in `./usage-sort`), the `started` facet (`FACET_MATCH` in
 * `./usage-facets`), the distribution's sample (`recordedSpend` below) and the
 * cell that renders the em dash (`figure` in `./SpendCells`). It was written
 * out separately in each of them until #285, with nothing holding them in step.
 *
 * It was five until #286. The node half had a ranking of its own (`rank` in
 * `apps/web/dev/usage.ts`) that branched on this to pick between a row's output
 * tokens and a sink value; `joinIssues` now sorts with `sortIssues` itself, so
 * that caller is the comparator above rather than a second one beside it.
 *
 * **One statement of the rule used to survive outside those five, and #290
 * closed it.** `figure` in `scripts/issue-tokens.ts` is the terminal's own
 * em-dash cell; it took a nullable `IssueSpend` rather than a row, so it could
 * not call this, and it took one because the terminal was assembling its own
 * rows and had no `IssueUsage` to hand. It calls `gatherUsage` now, so it has
 * one, and it asks this instead. This is the repo's home for the rule.
 *
 * **It is not a ranking's sink value, and the two must not be collapsed.**
 * This answers "is there spend"; a sink value is the *number* an absent row
 * sorts at — below every real figure, and `-1` rather than `0` because zero is
 * a real figure — which is a different question with a different answer type.
 * Ranking by this predicate instead would make every started row compare equal
 * and lose the output-token order the page opens on. Nothing in the repo holds
 * such a value any more: `dev/usage.ts`'s `UNSTARTED_RANK` was the only one and
 * #286 deleted it, because `sortIssues` asks this of *two rows* before it reads
 * any figure and so never needs a number for the absent case. A reintroduced
 * sink value would be a second ordering, not a helper.
 *
 * A type guard rather than a `boolean`, so a caller that asks the question and
 * then reads a figure off the *same* row — `sortIssues`, `recordedSpend`,
 * `figure` in `./SpendCells` — does it without a `?.` or a `!` standing beside
 * the check as a second, unverified copy of it.
 *
 * That covers a caller reading one row. It is **not** a rule that every `?.` on
 * `spend` is now a defect: `figureOf` in `./usage-sort` keeps one deliberately,
 * because it runs on two rows already known to be on the same side of the sink
 * and its null is a live answer rather than an unreached fallback. Its doc
 * comment is where that is argued.
 */
export const hasRecordedSpend = (
  row: IssueUsage,
): row is IssueUsage & { spend: IssueSpend } => row.spend !== null;

export interface AccuracyBin {
  verdict: Verdict;
  count: number;
}

export interface ForecastAccuracy {
  /** All three, always, in `ACCURACY_ORDER` — a zero is a result, and only the
   *  chart spends this. */
  bins: AccuracyBin[];
  /** Rows carrying a verdict: the denominator, and what "nothing to score"
   *  means when it is zero. */
  scored: number;
  onTarget: number;
}

/**
 * How often the band an issue was cut with matched what it actually cost.
 *
 * Here rather than beside either caller because there are two, and the figure is
 * the page's headline claim: `bun run tokens` prints `hits/scored on target` at
 * the foot of its table and the Usage page prints the same words in a card
 * corner. Those were two tallies of the same rows until #252 — the kind of pair
 * that agrees right up until somebody changes one, with nothing failing when
 * they stop.
 *
 * **Gated on the verdict, not on the forecast**, and that is the whole rule. A
 * row can carry a band and no spend to read it against — since #251 every open
 * issue gets one — and counting those as scored-and-missed would walk the figure
 * toward zero every time somebody files an issue. The verdict is already null
 * unless both halves are present (see `verdictFor`), so asking for it is asking
 * the question once.
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

/**
 * The output-token totals of the rows that recorded any, in row order.
 *
 * The distribution's sample, and the one line that decides what is in it. Shared
 * for the same reason `forecastAccuracy` is: the CLI's percentiles and the
 * page's quartile marks must be quartiles *of the same set*, and both had
 * written this `flatMap` out for themselves.
 *
 * The exclusion is `hasRecordedSpend` above and is written down there: a row
 * with no recorded spend is an absence, not a zero. This is the one line that
 * decides what is in the sample, and since #285 it decides it by asking the
 * same predicate the ranking, the comparator, the facets and the cells ask
 * rather than by re-deriving the rule.
 */
export const recordedSpend = (issues: IssueUsage[]): number[] =>
  issues.flatMap((row) => (hasRecordedSpend(row) ? [row.spend.out] : []));
