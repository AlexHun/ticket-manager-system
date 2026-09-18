import { useId, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { StackSegmentV } from "@/components/dashboard/chart-marks";
import {
  CHART_ANIMATION,
  CHART_BOX,
  CHART_HEIGHT_CLASS,
  ORDINAL_FILL,
} from "@/components/dashboard/chart-tokens";
import { cn } from "@/lib/utils";
import {
  BUCKETS,
  VERDICT,
  forecastAccuracy,
  type Bucket,
  type IssueUsage,
  type Verdict,
} from "./protocol";
import {
  formatTokens,
  outputDistribution,
  type PercentileMark,
} from "./usage-charts";

/**
 * The two questions the table makes you compute by eye (#252).
 *
 * **Forecast accuracy** — how often the band an issue was cut with matched what
 * it actually cost. **Output distribution** — whether the bands themselves still
 * fit the work, which is a live question rather than a decorative one: they were
 * fixed off a single measurement of 90 branches and nothing has re-checked them
 * since.
 *
 * Recharts, as the dashboard uses, and the dashboard's own chart tokens rather
 * than a second set: `CHART_ANIMATION` especially, which carries the measured
 * reason `isAnimationActive` is deliberately *absent* — unset it resolves to
 * `'auto'`, which is what keeps the reduced-motion path working, and passing
 * `true` would force animation on for people who asked for none.
 *
 * **Not `ChartCard`.** The dashboard's panel shell gives every chart a table
 * twin behind a toggle, and that twin renders into a container with no
 * `tabIndex`, role or name — the defect #111 fixed everywhere else, on the one
 * container where the table *is* the chart's accessibility-relief path. It is
 * tracked as #123 and is a known gap rather than the convention, so this page
 * does not copy the shape. Its relief path is the spend table below, which is a
 * real `TableFrame` and carries every figure these two readings are derived
 * from.
 *
 * **And not `BucketChart` either**, which is the same decision one level down
 * and is worth naming because the plot bodies below do look like copies of it.
 * They are: grid, two axes, a tooltip, `maxBarSize`, `StackSegmentV`, a
 * `LabelList`. What is not shared is everything that decides anything — that
 * component is welded to `ChartCard`, takes `{label, count}` bins with a
 * `binColumn` for the table twin it must have, colours one way (the ordinal ramp
 * by position), and has no notion of a reference line. Parameterising it for a
 * diverging per-verdict palette, optional marks and no twin would leave a
 * component that is more options than body. If a fourth bar chart arrives, that
 * is the moment to extract one; three is not it.
 *
 * Nothing here computes a verdict or a band. The rows arrive already scored by
 * the shared join in `apps/web/dev/usage.ts`, so the accuracy figure on this
 * page and the one `bun run tokens` prints are the same tally of the same words.
 */

/**
 * One hue per verdict, and only one of the three is loud.
 *
 * The same reading `VERDICT_VARIANT` makes of these words in the table: over is
 * the one worth catching an eye. Under gets the pale ordinal step rather than a
 * second alarm colour — overestimating is a miss, not a problem.
 */
const VERDICT_FILL: Record<Verdict, string> = {
  [VERDICT.under]: "var(--viz-ord-2)",
  [VERDICT.onTarget]: "var(--viz-accent)",
  [VERDICT.over]: "var(--destructive)",
};

/**
 * A band letter, spelled out: `S` becomes `S <60k`.
 *
 * Keyed loosely on purpose — Recharts hands a label formatter whatever the axis
 * is carrying, typed as a `ReactNode`, so a record with a total lookup is what
 * turns that back into something safe without a cast. The letter alone is jargon
 * and the range alone does not match the label on the issue, which is the same
 * argument `Band` makes in the table.
 */
const BAND_TICK: Record<string, string> = Object.fromEntries(
  (Object.keys(BUCKETS) as Bucket[]).map((band) => [
    band,
    `${band} ${BUCKETS[band].label}`,
  ]),
);

/** One series, so one config key — and it must equal the `dataKey`, which is
 *  what `ChartStyle` emits its custom property from. */
const issuesConfig = {
  count: { label: "Issues", color: "var(--viz-accent)" },
} satisfies ChartConfig;

/**
 * A bin with its own colour on it, which is what the tooltip needs.
 *
 * Both charts colour per column rather than per series, and a `<Cell>` alone
 * does not tell the tooltip that: `ChartTooltipContent` resolves its swatch as
 * `color ?? item.payload?.fill ?? item.color`, and with the fill living only on
 * the Cell it falls through to `item.color` — the *series* colour from
 * `issuesConfig`. Hovering the red "over" column then showed an accent-green dot
 * beside it. Carrying the fill on the datum answers both: the `<Cell>` reads it
 * for the bar, and Recharts hands the same object to the tooltip.
 */
const withFill = <T,>(bin: T, fill: string) => ({ ...bin, fill });

/**
 * The shell both panels share: a named region, a headline figure, and an empty
 * state that says what is missing instead of drawing an axis around nothing.
 *
 * `role="region"` with `aria-labelledby` for the reason `TableFrame` carries the
 * same pair (#111): a region without an accessible name is not exposed as a
 * landmark at all, and these two panels are what the E2E addresses by name —
 * Playwright's full-page screenshots catch Recharts mid-animation, so the spec
 * asserts on roles and text and never on a picture.
 */
function ChartPanel({
  title,
  description,
  stat,
  isEmpty,
  emptyMessage,
  footer,
  children,
}: {
  title: string;
  description: string;
  /** A headline figure for the top-right — the one number the panel is for. */
  stat?: ReactNode;
  isEmpty: boolean;
  /** Shown instead of the chart. Says which measurement is missing, never
   *  "no data". */
  emptyMessage: string;
  /** What the figures are read against. Shown in both states: it is context for
   *  the empty message as much as for the chart. */
  footer: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {stat && (
          <CardAction className="text-sm font-medium tabular-nums">
            {stat}
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div
            className={cn(CHART_HEIGHT_CLASS, "grid place-items-center")}
            role="status"
          >
            <p className="max-w-prose text-center text-sm text-muted-foreground">
              {emptyMessage}
            </p>
          </div>
        ) : (
          children
        )}
        <p className="max-w-prose pt-2 text-xs text-muted-foreground">
          {footer}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * How often the forecast band matched the actual spend.
 *
 * Empty when nothing carries a verdict, and it says so in those words. That is
 * not politeness: three empty columns under an axis read as "we forecast
 * everything and got all of it wrong", which is the opposite of what a missing
 * `forecast/S|M|L` label means. It is also the ordinary state of this page with
 * no `gh` — the listing is where the bands come from, so a machine that cannot
 * reach GitHub has every figure and nothing to score.
 */
function AccuracyChart({ issues }: { issues: IssueUsage[] }) {
  const { bins, scored, onTarget } = forecastAccuracy(issues);
  const data = bins.map((bin) => withFill(bin, VERDICT_FILL[bin.verdict]));

  return (
    <ChartPanel
      title="Forecast accuracy"
      description="Issues carrying a forecast band, by how the actual read against it."
      stat={
        scored > 0 && (
          <span>
            {onTarget}/{scored} on target (
            {Math.round((onTarget / scored) * 100)}%)
          </span>
        )
      }
      isEmpty={scored === 0}
      emptyMessage="Nothing to score. No issue here carries both a forecast/S|M|L label and recorded spend to read against it."
      footer="Only issues with both halves are counted. A band nobody has started work against is not a forecast that has been tested, and counting it as a miss would walk this figure toward zero as the backlog grows."
    >
      <ChartContainer config={issuesConfig} className={CHART_BOX}>
        <BarChart
          accessibilityLayer
          data={data}
          margin={{ top: 20, right: 8, left: -16, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="verdict"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            allowDecimals={false}
          />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel />}
          />
          <Bar
            {...CHART_ANIMATION}
            dataKey="count"
            maxBarSize={44}
            shape={<StackSegmentV radius={4} />}
          >
            {data.map((bin) => (
              <Cell key={bin.verdict} fill={bin.fill} />
            ))}
            <LabelList
              dataKey="count"
              position="top"
              offset={8}
              className="fill-foreground"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartPanel>
  );
}

/**
 * The quartile marks that landed in one band, stacked beside its line.
 *
 * Grouped by band rather than drawn one line each, because two quartiles landing
 * in the same band is the *ordinary* case and not a rare one — a distribution
 * the bands fit well puts p25 and the median a band apart at best, and a young
 * repository puts all three in `S`. Three labels at one x would overprint into
 * an unreadable smear, so they stack and the line is drawn once.
 *
 * `flip` turns the labels inward on the last band, where text running right
 * would leave the plot.
 *
 * **A mark is accurate to its band and no finer, and that is a real limit.** The
 * x-axis is categorical, so `ReferenceLine x={band}` snaps to the band's centre:
 * p25 3,000 and p75 20,000 draw at the same x when both land in `S`. The exact
 * figure is on the label and in the panel's corner, and the position carries
 * only which band — which is the question this chart asks, since the bands are
 * what is being re-checked. Placing them truly would mean a numeric token axis,
 * and the bands are unequal in width and open-ended at the top (`XL` is
 * `Infinity`), so a linear axis would misstate the density it drew. Worth
 * revisiting only if the question changes from "which band" to "where exactly".
 */
const markLabel =
  (marks: PercentileMark[], flip: boolean) =>
  ({ viewBox }: { viewBox?: { x?: number; y?: number } }) => (
    <g>
      {marks.map((mark, i) => (
        <text
          key={mark.key}
          x={(viewBox?.x ?? 0) + (flip ? -6 : 6)}
          y={(viewBox?.y ?? 0) + 12 + i * 14}
          textAnchor={flip ? "end" : "start"}
          className="fill-foreground text-[11px] font-medium"
        >
          {mark.key} {formatTokens(mark.value)}
        </text>
      ))}
    </g>
  );

/**
 * What this repository's issues actually cost, against the bands they are
 * forecast in.
 *
 * The columns are the context and the quartile marks are the point: the bands
 * were cut from p25 55k / median 90k / p75 154k over 90 branches, so where
 * today's quartiles sit *is* the answer to whether they still fit. A median that
 * has walked into `L` says the bands are stale, and nothing else on this page
 * would say it.
 *
 * The fill follows each band's position in the sequence rather than its count —
 * the ramp encodes the ordering, and colouring by height would make it
 * meaningless. Bands are ordinal, which is exactly what one hue in monotone
 * steps is for.
 */
function DistributionChart({ issues }: { issues: IssueUsage[] }) {
  const { bins, measured, marks } = outputDistribution(issues);
  const data = bins.map((bin, i) =>
    withFill(bin, ORDINAL_FILL[Math.min(i, ORDINAL_FILL.length - 1)]!),
  );

  /** The marks that share a band, keyed by it. */
  const byBand = new Map<Bucket, PercentileMark[]>();
  for (const mark of marks) {
    byBand.set(mark.band, [...(byBand.get(mark.band) ?? []), mark]);
  }
  const lastBand = bins[bins.length - 1]?.band;

  return (
    <ChartPanel
      title="Output distribution"
      description="Issues with recorded spend, by the band their output tokens landed in."
      stat={
        marks.length > 0 && (
          <span>
            {marks.map((m) => `${m.key} ${formatTokens(m.value)}`).join(" · ")}
          </span>
        )
      }
      isEmpty={measured === 0}
      emptyMessage="No recorded spend yet, so there is no distribution to draw. Only a branch named <type>/<issue>-<slug> can be attributed to an issue."
      footer={
        <>
          {measured} {measured === 1 ? "issue" : "issues"} with recorded spend.
          The bands were cut from p25 55k / median 90k / p75 154k over 90
          branches and nothing has re-checked them since — where these marks sit
          now is that re-check.
        </>
      }
    >
      <ChartContainer config={issuesConfig} className={CHART_BOX}>
        <BarChart
          accessibilityLayer
          data={data}
          margin={{ top: 20, right: 8, left: -16, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="band"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            allowDecimals={false}
          />
          <ChartTooltip
            cursor={false}
            // The letter is the axis; the range it means is the one thing the
            // axis cannot show without crowding four ticks into a half-width
            // card.
            labelFormatter={(label) =>
              typeof label === "string" ? (BAND_TICK[label] ?? label) : label
            }
            content={<ChartTooltipContent />}
          />
          <Bar
            {...CHART_ANIMATION}
            dataKey="count"
            maxBarSize={44}
            shape={<StackSegmentV radius={4} />}
          >
            {data.map((bin) => (
              <Cell key={bin.band} fill={bin.fill} />
            ))}
            <LabelList
              dataKey="count"
              position="top"
              offset={8}
              className="fill-foreground"
              fontSize={12}
            />
          </Bar>
          {[...byBand].map(([band, bandMarks]) => (
            <ReferenceLine
              key={band}
              x={band}
              stroke="var(--foreground)"
              strokeOpacity={0.55}
              strokeDasharray="4 4"
              label={markLabel(bandMarks, band === lastBand)}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </ChartPanel>
  );
}

/**
 * Both charts, above the table they are derived from.
 *
 * Rendered only once a scan has been read, like the table — the page's claim is
 * that what is on screen was gathered at a named moment, and a chart held over
 * from the last press would be the one thing that outlives it.
 */
export function UsageCharts({ issues }: { issues: IssueUsage[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AccuracyChart issues={issues} />
      <DistributionChart issues={issues} />
    </div>
  );
}
