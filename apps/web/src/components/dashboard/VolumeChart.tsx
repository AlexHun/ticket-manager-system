import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  DASHBOARD_BUCKET,
  type DashboardBucket,
  type TicketVolumePoint,
} from "@ticket/shared";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatBucketFull, formatBucketLabel } from "@/lib/format";
import { ChartCard, DataTable } from "./ChartCard";
import { StackSegmentV } from "./chart-marks";
import {
  CHART_ANIMATION_MS,
  CHART_BOX,
  STATUS_STACK,
  statusChartConfig,
} from "./chart-tokens";

const BUCKET_NOUN: Record<DashboardBucket, string> = {
  [DASHBOARD_BUCKET.day]: "day",
  [DASHBOARD_BUCKET.week]: "week",
  [DASHBOARD_BUCKET.month]: "month",
};

/**
 * Tickets created per bucket, stacked by the status they are in *now*.
 *
 * Worth being precise about what this says: the x-axis is creation time, so a
 * tall Open segment on an old bucket means those tickets are still open — the
 * chart shows arrival volume and how much of each cohort survived, not a
 * status timeline. There is no `resolvedAt`, so a true created-vs-resolved
 * chart isn't available.
 *
 * No legend box: `StatusMixCard` sits beside it naming the same three colours,
 * and a second copy would be noise.
 */
export function VolumeChart({
  volume,
  bucket,
  className,
}: {
  volume: TicketVolumePoint[];
  bucket: DashboardBucket;
  className?: string;
}) {
  // Memoised, and nothing here is keyed on the query params: Recharts v3 tweens
  // from the previous rects, so a range change morphs the columns. Remounting
  // would replay the grow-in and turn the held frame into a flash.
  const data = useMemo(() => volume, [volume]);
  const isEmpty = useMemo(
    () => volume.every((v) => STATUS_STACK.every((s) => v[s] === 0)),
    [volume],
  );

  return (
    <ChartCard
      className={className}
      title="Tickets created"
      subtitle={`Per ${BUCKET_NOUN[bucket]}, stacked by current status${
        bucket === DASHBOARD_BUCKET.week ? " · weeks begin Monday (UTC)" : ""
      }`}
      isEmpty={isEmpty}
      table={
        <DataTable
          columns={[BUCKET_NOUN[bucket], ...STATUS_STACK]}
          rows={data.map((p) => [
            formatBucketFull(p.bucketStart, bucket),
            ...STATUS_STACK.map((s) => p[s]),
          ])}
        />
      }
    >
      <ChartContainer config={statusChartConfig} className={CHART_BOX}>
        <BarChart
          accessibilityLayer
          data={data}
          margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
        >
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="bucketStart"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={16}
            tickFormatter={(value: string) => formatBucketLabel(value, bucket)}
          />
          <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(value) =>
                  formatBucketFull(String(value), bucket)
                }
              />
            }
          />
          {STATUS_STACK.map((status, i) => (
            <Bar
              key={status}
              dataKey={status}
              stackId="status"
              fill={`var(--color-${status})`}
              maxBarSize={24}
              // Only the topmost segment carries the rounded data-end; the stack
              // stays square where it meets the baseline.
              shape={
                <StackSegmentV
                  radius={i === STATUS_STACK.length - 1 ? 4 : 0}
                />
              }
              animationDuration={CHART_ANIMATION_MS}
            />
          ))}
        </BarChart>
      </ChartContainer>
    </ChartCard>
  );
}
