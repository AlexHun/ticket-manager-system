import { useMemo } from "react";
import { Bar, BarChart, LabelList, XAxis, YAxis } from "recharts";
import type { TicketCategoryCount } from "@ticket/shared";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { ChartCard, DataTable } from "./ChartCard";
import { StackSegmentH } from "./chart-marks";
import {
  CHART_BOX,
  countChartConfig,
  UNCATEGORISED_LABEL,
} from "./chart-tokens";

/**
 * Ticket counts per category.
 *
 * One hue for every bar, not four. Categories are peers with no natural order,
 * so colouring each one differently would spend the identity channel re-encoding
 * what the bar length already shows — and the theme's ramp is monochrome, so the
 * four hues would have to come from somewhere unvalidated. Length carries the
 * comparison; the direct labels carry the values.
 *
 * Horizontal because the category names are words, and rotated tick labels are
 * harder to read than a left-aligned column of them.
 */
export function CategoryChart({
  categories,
  className,
}: {
  categories: TicketCategoryCount[];
  className?: string;
}) {
  const data = useMemo(() => {
    const named = categories
      .filter((c) => c.category !== null)
      .sort((a, b) => b.count - a.count)
      .map((c) => ({ label: String(c.category), count: c.count }));
    const uncategorised = categories.find((c) => c.category === null);
    // Pinned last whatever its size: "no category yet" is a different kind of
    // thing from the four real ones, and sorting it into the middle of them
    // implies it is one.
    return uncategorised
      ? [...named, { label: UNCATEGORISED_LABEL, count: uncategorised.count }]
      : named;
  }, [categories]);

  const isEmpty = data.every((d) => d.count === 0);

  return (
    <ChartCard
      className={className}
      title="By category"
      subtitle="Including tickets nobody has filed yet"
      isEmpty={isEmpty}
      table={
        <DataTable
          columns={["Category", "Tickets"]}
          rows={data.map((d) => [d.label, d.count])}
        />
      }
    >
      <ChartContainer config={countChartConfig} className={CHART_BOX}>
        <BarChart
          accessibilityLayer
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 32, left: 0, bottom: 0 }}
        >
          <XAxis type="number" dataKey="count" hide />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={96}
            tickMargin={4}
          />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent hideLabel />}
          />
          <Bar
            dataKey="count"
            fill="var(--color-count)"
            maxBarSize={20}
            shape={<StackSegmentH radius={4} />}
          >
            {/* Direct labels rather than an x-axis: with one series the value
                beside each bar is quicker to read than a scale to measure
                against, and it is also the relief the contrast check asks for. */}
            <LabelList
              dataKey="count"
              position="right"
              offset={8}
              className="fill-foreground"
              fontSize={12}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartCard>
  );
}
