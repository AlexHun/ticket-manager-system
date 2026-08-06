import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { ChartCard, DataTable } from "./ChartCard";
import { StackSegmentV } from "./chart-marks";
import {
  CHART_ANIMATION_MS,
  CHART_BOX,
  countChartConfig,
  ORDINAL_FILL,
} from "./chart-tokens";

export interface Bin {
  label: string;
  count: number;
}

interface BucketChartProps {
  title: string;
  subtitle?: string;
  stat?: ReactNode;
  bins: Bin[];
  /** Column heading for the table twin's first column. */
  binColumn: string;
  footer?: ReactNode;
  emptyMessage?: string;
  className?: string;
}

/**
 * A distribution over ordered bins — hours-to-first-reply, age-of-open-ticket.
 *
 * These are *ordinal*, not categorical: the bins have a direction, so they take
 * one hue in monotone lightness steps and the reader sees the ordering in the
 * colour. Four separate hues would say the bins are peers, which is the opposite
 * of what a distribution means.
 *
 * The ramp's first step sits under 3:1 on the light card by design, which is
 * legal only with a relief channel — hence the direct value labels here and the
 * table twin `ChartCard` gives every panel. Don't remove either.
 */
export function BucketChart({
  title,
  subtitle,
  stat,
  bins,
  binColumn,
  footer,
  emptyMessage,
  className,
}: BucketChartProps) {
  const isEmpty = bins.every((b) => b.count === 0);

  return (
    <ChartCard
      className={className}
      title={title}
      subtitle={subtitle}
      stat={stat}
      isEmpty={isEmpty}
      emptyMessage={emptyMessage}
      table={
        <DataTable
          columns={[binColumn, "Tickets"]}
          rows={bins.map((b) => [b.label, b.count])}
        />
      }
    >
      <div className="flex flex-col">
        <ChartContainer config={countChartConfig} className={CHART_BOX}>
          <BarChart
            accessibilityLayer
            data={bins}
            margin={{ top: 20, right: 8, left: -16, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
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
              dataKey="count"
              maxBarSize={44}
              shape={<StackSegmentV radius={4} />}
              animationDuration={CHART_ANIMATION_MS}
            >
              {bins.map((bin, i) => (
                <Cell
                  key={bin.label}
                  // Fill follows the bin's position in the sequence, not its
                  // value — the ramp encodes the ordering, and re-sorting by
                  // size would make the colours meaningless.
                  fill={ORDINAL_FILL[Math.min(i, ORDINAL_FILL.length - 1)]}
                />
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
        {footer && (
          <p className="pt-1 text-xs text-muted-foreground">{footer}</p>
        )}
      </div>
    </ChartCard>
  );
}
