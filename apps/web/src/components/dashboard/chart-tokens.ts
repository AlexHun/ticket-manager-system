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
 * Bar animation settings, spread onto every `<Bar>` on the dashboard.
 *
 * Animation is off. The reason is that the tween is not CSS: each frame is a
 * React re-render (`recharts/animation/JavascriptAnimate.js` drives it from
 * `useState`), and each frame rebuilds every rect and re-runs the custom
 * `shape` in `chart-marks.tsx`. That loop is the dashboard's single largest
 * source of main-thread work, and it runs far more often than "on mount":
 * Recharts tweens from the previous geometry on *any* dimension change, so
 * every resize restarts it on all five charts at once. Collapsing the sidebar
 * animates `SidebarInset`'s width for 200ms (`transition-[width] duration-200`
 * in `ui/sidebar.tsx`), which is exactly such a change.
 *
 * What this costs: a range change now snaps instead of morphing the columns.
 * That morph was deliberate, so if it is wanted back, prefer swapping the flag
 * for a short duration over restoring the default —
 *
 *     export const CHART_ANIMATION = { animationDuration: 200 } as const
 *
 * — and re-measure. Note the default is `400`, not the `1500` of v1/v2
 * (`defaultBarProps` in `recharts/cartesian/Bar.js`); check it before assuming
 * any override is an improvement.
 *
 * `isAnimationActive` is a tri-state, not a boolean. Left unset it is `'auto'`,
 * which `JavascriptAnimate` resolves to `!Global.isSsr && !prefersReducedMotion`
 * — so `false` here is strictly a superset of the reduced-motion path and takes
 * nothing away from it. Never pass `true`: that would override the check and
 * force animation on for people who asked for none.
 */
export const CHART_ANIMATION = { isAnimationActive: false } as const;

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
