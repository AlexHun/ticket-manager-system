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
 * The tween is not CSS: each frame is a React re-render
 * (`recharts/animation/JavascriptAnimate.js` drives it from `useState`) that
 * rebuilds every rect and re-runs the custom `shape` in `chart-marks.tsx`. So
 * the cost of animation is set by how *often* it restarts, not just how long it
 * runs — Recharts re-tweens on any dimension change, not only on mount.
 *
 * It was off for a while, and what made it affordable again was fixing the thing
 * that kept restarting it. The sidebar used to animate the width of the element
 * that reflows content, firing ~12 resizes per toggle and relaunching the tween
 * on every chart each time. That element now snaps once, after the slide (see
 * `sidebar-gap` in `ui/sidebar.tsx`), so a toggle costs one tween rather than
 * twelve. Dropping from five charts to two did the rest.
 *
 * `animationDuration: 200` rather than the default: the default is `400`
 * (`defaultBarProps` in `recharts/cartesian/Bar.js`, and note it is *not* the
 * `1500` of v1/v2 — check before assuming an override is an improvement). Half
 * the default is enough to read the columns morph on a range change while
 * halving the number of frames that morph costs.
 *
 * `isAnimationActive` is deliberately absent. It is a tri-state, not a boolean:
 * unset it is `'auto'`, which `JavascriptAnimate` resolves to
 * `!Global.isSsr && !prefersReducedMotion`. Passing `true` would override that
 * and force animation on for people who asked for none — so leaving it off the
 * object is what keeps the reduced-motion path working. It is also why the test
 * suite sees no animation: `src/test/setup.ts` answers `matches: true` to
 * `prefers-reduced-motion`.
 */
export const CHART_ANIMATION = { animationDuration: 200 } as const;

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
