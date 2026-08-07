import {
  AGE_BUCKET,
  LATENCY_BUCKET,
  TICKET_STATUS,
  type AgeBucket,
  type LatencyBucket,
} from "@ticket/shared";
import type { ChartConfig } from "@/components/ui/chart";

/**
 * Plot height, shared by every chart and by the skeleton that stands in for it,
 * so the swap from loading to loaded causes no layout shift.
 *
 * `ChartContainer`'s own base class is `aspect-video`, so every chart must also
 * pass `aspect-auto` or it ignores this. The height deliberately includes room
 * for the x-axis band — sized to the plot alone, the card grows a nested
 * scrollbar to reach its own tick labels.
 */
export const CHART_BOX = "aspect-auto h-[240px] w-full";
export const CHART_HEIGHT_CLASS = "h-[240px]";

/**
 * There is deliberately no `animationDuration` constant here, and no chart
 * passes the prop. Recharts' own default is what runs.
 *
 * This used to be `600`, justified by a comment about "Recharts' 1500ms
 * default" — which was true of v1/v2 and stopped being true in v3. The default
 * is now `400` (`defaultBarProps` in `recharts/cartesian/Bar.js`), so the
 * override meant to make the dashboard feel quicker was making every chart half
 * again slower than doing nothing. Check that default before reintroducing one.
 *
 * Duration is worth being careful with because the animation is not CSS: each
 * frame is a React re-render (`recharts/animation/JavascriptAnimate.js` drives
 * it from `useState`), and each frame rebuilds every rect and re-runs the
 * custom `shape` in `chart-marks.tsx`. A longer duration is not just a longer
 * wait — it is proportionally more main-thread work, across five charts that
 * all mount at once.
 *
 * Note what is *not* set anywhere either: `isAnimationActive`. It defaults to
 * `'auto'`, which `JavascriptAnimate` resolves to
 * `!Global.isSsr && !prefersReducedMotion` — passing `true` would override that
 * and defeat the accessibility path.
 */

/**
 * Status as a chart series.
 *
 * The config keys must equal the `dataKey`s, which are the TicketStatus values,
 * so `ChartStyle` emits `--color-Open` / `--color-Resolved` / `--color-Closed`.
 * Capitalised CSS custom properties look odd but are perfectly valid — don't
 * "fix" them to lowercase, the lookup is by exact key.
 */
export const statusChartConfig = {
  [TICKET_STATUS.Open]: { label: "Open", color: "var(--viz-open)" },
  [TICKET_STATUS.Resolved]: { label: "Resolved", color: "var(--viz-resolved)" },
  [TICKET_STATUS.Closed]: { label: "Closed", color: "var(--viz-closed)" },
} satisfies ChartConfig;

/** Stack order, bottom to top. Closed at the bottom so Open — the status that
 *  needs work — sits at the top of the column where the eye lands. */
export const STATUS_STACK = [
  TICKET_STATUS.Closed,
  TICKET_STATUS.Resolved,
  TICKET_STATUS.Open,
] as const;

/** One series, so one hue (see the --viz-accent note in index.css). */
export const countChartConfig = {
  count: { label: "Tickets", color: "var(--viz-accent)" },
} satisfies ChartConfig;

/**
 * The ordinal ramp, light → dark, as CSS custom properties rather than values:
 * the window they point at differs per mode and only CSS can shift it.
 */
export const ORDINAL_FILL = [
  "var(--viz-ord-1)",
  "var(--viz-ord-2)",
  "var(--viz-ord-3)",
  "var(--viz-ord-4)",
] as const;

export const LATENCY_LABEL: Record<LatencyBucket, string> = {
  [LATENCY_BUCKET.under1h]: "< 1h",
  [LATENCY_BUCKET.h1to4]: "1–4h",
  [LATENCY_BUCKET.h4to24]: "4–24h",
  [LATENCY_BUCKET.over24h]: "> 24h",
};

export const AGE_LABEL: Record<AgeBucket, string> = {
  [AGE_BUCKET.under1d]: "< 1d",
  [AGE_BUCKET.d1to3]: "1–3d",
  [AGE_BUCKET.d3to7]: "3–7d",
  [AGE_BUCKET.over7d]: "> 7d",
};

/** What a null category is called in the UI. The API sends `null`, which is the
 *  real state — this is only the label for it. */
export const UNCATEGORISED_LABEL = "Uncategorised";
