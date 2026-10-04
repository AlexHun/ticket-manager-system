/**
 * The Usage page's trend, shaped for an axis and a table (#419) — pure, beside
 * `./usage-charts` and for its reason: what a chart says is worth a unit test,
 * and Recharts draws nothing in jsdom.
 *
 * Nothing here computes a quartile or a score. Each `TrendPoint` arrives with
 * them already taken, by `trendPointFor` in `./usage-readings` over the same
 * rows the panels read; this only decides what an absent figure looks like on
 * a line, and how a point's band edges are printed.
 */

import { BUCKETS, type BandEdges, type TrendPoint } from "./usage-protocol";
import { accuracyPercent, formatTokens } from "./usage-charts";

/** One day on the trend's x-axis. */
export interface TrendDatum {
  day: string;
  /** Null when the day measured nothing — a gap in the line, not a point at
   *  zero, which would read as a day of very cheap issues. */
  p25: number | null;
  median: number | null;
  p75: number | null;
  /** Percent on target; null when nothing was scored, which is not 0%. */
  accuracy: number | null;
  /** The edges in force that day, drawn as steps so a moved band shows. */
  edgeS: number;
  edgeM: number;
  edgeL: number;
}

export function trendSeries(points: TrendPoint[]): TrendDatum[] {
  return points.map((p) => {
    const measured = p.measured > 0;
    return {
      day: p.day,
      p25: measured ? p.p25 : null,
      median: measured ? p.median : null,
      p75: measured ? p.p75 : null,
      accuracy: p.scored > 0 ? accuracyPercent(p.onTarget, p.scored) : null,
      edgeS: p.edges.S,
      edgeM: p.edges.M,
      edgeL: p.edges.L,
    };
  });
}

/** The bands that have an edge, in `BUCKETS` order — every one but the
 *  open-ended `XL`. */
const EDGE_BANDS = (Object.keys(BUCKETS) as (keyof typeof BUCKETS)[]).filter(
  (band): band is keyof BandEdges => band !== "XL",
);

/**
 * A point's band edges as one line: `S <60,000 · M <150,000 · L <250,000`.
 *
 * Read off the point rather than off `BUCKETS` — the letters are the record's,
 * the figures the day's — so a point written before the bands moved still
 * prints the edges it was judged against (R7).
 */
export const formatEdges = (edges: BandEdges): string =>
  EDGE_BANDS.map((band) => `${band} <${formatTokens(edges[band])}`).join(" · ");

/** Tokens on a trend axis, in thousands — the axis is narrow, the table and the
 *  tooltip carry the exact figure. */
export const tokenTick = (n: number): string =>
  n === 0 ? "0" : `${Math.round(n / 1000)}k`;
