import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  CHART_ANIMATION,
  CHART_BOX,
} from "@/components/dashboard/chart-tokens";
import { TableFrame } from "@/lib/table-frame";
import { ChartPanel } from "./UsageChartPanel";
import { accuracyLabel, formatTokens } from "./usage-charts";
import { USAGE_TREND_LABEL } from "./usage-copy";
import type { TrendPoint } from "./usage-protocol";
import {
  formatEdges,
  tokenTick,
  trendSeries,
  type TrendDatum,
} from "./usage-trend";

/**
 * How the two readings above move over time (#419, R6, R7): the quartiles of
 * actual output tokens and forecast accuracy, one point per local calendar day
 * on which a scan was taken, the day's last scan standing for it.
 *
 * The same conventions as `./UsageCharts` — Recharts in a `ChartContainer`, the
 * dashboard's `CHART_ANIMATION` and `CHART_BOX`, and `ChartPanel` for the
 * named-region shell and the empty state — and a table beneath them for the
 * reason that file gives for not using `ChartCard`: the relief path is a real
 * `TableFrame`, and it is also where every point's exact figures and stored
 * band edges are printed.
 *
 * **Every point carries the band edges in force on its day, and the quartile
 * chart draws them** as dashed steps behind the three lines. A band that moves
 * moves the step on the day it moved, and the days before it keep the edges
 * they were cut against — which is the question the trend is for: whether the
 * quartiles have walked out of the bands, or the bands have been moved to them.
 *
 * Only spend is plotted. Nothing here is a verdict, and every verdict on the
 * page is still judged against today's bands.
 */

const quartileConfig = {
  p25: { label: "p25", color: "var(--viz-ord-2)" },
  median: { label: "median", color: "var(--viz-accent)" },
  p75: { label: "p75", color: "var(--viz-ord-4)" },
  edgeS: { label: "S edge", color: "var(--muted-foreground)" },
  edgeM: { label: "M edge", color: "var(--muted-foreground)" },
  edgeL: { label: "L edge", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

const QUARTILES = ["p25", "median", "p75"] as const;
const EDGES = ["edgeS", "edgeM", "edgeL"] as const;

const accuracyConfig = {
  accuracy: { label: "% on target", color: "var(--viz-accent)" },
} satisfies ChartConfig;

/** Only a reading taken without a usage history has no points: any scan that
 *  keeps one writes today's. */
const NO_TREND =
  "No trend yet. The trend is one point per day kept in the usage history, and this reading kept none.";

/** The x-axis every trend chart shares: one tick per stored day. */
const dayAxis = (
  <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
);

function QuartileTrend({ data }: { data: TrendDatum[] }) {
  return (
    <ChartPanel
      title={USAGE_TREND_LABEL.quartiles}
      description="p25, median and p75 of actual output tokens, per day, against the band edges in force that day."
      isEmpty={data.length === 0}
      emptyMessage={NO_TREND}
      footer="Dashed steps are the band edges each point was stored with. A day that measured nothing leaves a gap rather than a point at zero."
    >
      <ChartContainer config={quartileConfig} className={CHART_BOX}>
        <LineChart
          accessibilityLayer
          data={data}
          margin={{ top: 12, right: 12, left: -8, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          {dayAxis}
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={tokenTick}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          {EDGES.map((key) => (
            <Line
              key={key}
              {...CHART_ANIMATION}
              dataKey={key}
              type="stepAfter"
              stroke={`var(--color-${key})`}
              strokeOpacity={0.6}
              strokeDasharray="4 4"
              dot={false}
            />
          ))}
          {QUARTILES.map((key) => (
            <Line
              key={key}
              {...CHART_ANIMATION}
              dataKey={key}
              type="monotone"
              stroke={`var(--color-${key})`}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      </ChartContainer>
    </ChartPanel>
  );
}

function AccuracyTrend({ data }: { data: TrendDatum[] }) {
  return (
    <ChartPanel
      title={USAGE_TREND_LABEL.accuracy}
      description="Share of scored issues whose forecast band matched the actual, per day."
      isEmpty={data.length === 0}
      emptyMessage={NO_TREND}
      footer="A day on which nothing carried both a forecast and recorded spend leaves a gap: nothing to score is not 0%."
    >
      <ChartContainer config={accuracyConfig} className={CHART_BOX}>
        <LineChart
          accessibilityLayer
          data={data}
          margin={{ top: 12, right: 12, left: -8, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          {dayAxis}
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Line
            {...CHART_ANIMATION}
            dataKey="accuracy"
            type="monotone"
            stroke="var(--color-accuracy)"
            strokeWidth={2}
          />
        </LineChart>
      </ChartContainer>
    </ChartPanel>
  );
}

/** An em dash for a figure the day did not measure, as the spend table's
 *  cells render an absence. */
const absent = <span className="text-muted-foreground">—</span>;

/**
 * Every stored point, newest first, with its exact figures and the band edges
 * it was stored with. The charts' relief path, and the E2E's handle on a day.
 */
function TrendTable({ points }: { points: TrendPoint[] }) {
  const newestFirst = [...points].reverse();
  return (
    <TableFrame label={USAGE_TREND_LABEL.points} className="max-h-[40dvh]">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Day</th>
            <th className="px-3 py-1.5 text-left font-medium">Accuracy</th>
            <th className="px-3 py-1.5 text-right font-medium">p25</th>
            <th className="px-3 py-1.5 text-right font-medium">median</th>
            <th className="px-3 py-1.5 text-right font-medium">p75</th>
            <th className="px-3 py-1.5 text-left font-medium">Band edges</th>
          </tr>
        </thead>
        <tbody>
          {newestFirst.map((p) => (
            <tr key={p.day} className="border-t border-border">
              <th
                scope="row"
                className="px-3 py-1.5 text-left font-mono font-normal tabular-nums"
              >
                <time dateTime={p.day}>{p.day}</time>
              </th>
              <td className="px-3 py-1.5">
                {p.scored > 0 ? accuracyLabel(p.onTarget, p.scored) : absent}
              </td>
              {QUARTILES.map((key) => (
                <td key={key} className="px-3 py-1.5 text-right tabular-nums">
                  {p.measured > 0 ? formatTokens(p[key]) : absent}
                </td>
              ))}
              <td className="px-3 py-1.5 text-muted-foreground">
                {formatEdges(p.edges)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}

/**
 * The trend, below the two readings it follows. Gated on a report like
 * everything else on the page, so it is always the trend as of that reading.
 */
export function UsageTrend({ points }: { points: TrendPoint[] }) {
  const data = trendSeries(points);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <QuartileTrend data={data} />
        <AccuracyTrend data={data} />
      </div>
      {points.length > 0 && <TrendTable points={points} />}
    </div>
  );
}
