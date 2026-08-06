import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  DASHBOARD_SCOPE,
  TICKET_STATUS,
  type AgentWorkload,
  type DashboardScope,
  type StatusCounts,
  type WorkloadCounts,
} from "@ticket/shared";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { ChartCard, DataTable } from "./ChartCard";
import { StackSegmentH } from "./chart-marks";
import {
  CHART_ANIMATION_MS,
  STATUS_STACK,
  statusChartConfig,
} from "./chart-tokens";

const UNASSIGNED_LABEL = "Unassigned";
const ROW_PX = 34;
const MIN_PLOT_PX = 240;

/** One bar in the chart. The status keys are spelled out rather than spread from
 *  a map so the row stays indexable by `TicketStatus` — which is what the Bar
 *  `dataKey`s are. */
type Row = StatusCounts & { name: string; total: number };

function toRow(name: string, counts: WorkloadCounts): Row {
  return {
    name,
    total: counts.total,
    [TICKET_STATUS.Open]: counts[TICKET_STATUS.Open],
    [TICKET_STATUS.Resolved]: counts[TICKET_STATUS.Resolved],
    [TICKET_STATUS.Closed]: counts[TICKET_STATUS.Closed],
  };
}

interface WorkloadChartProps {
  workload: AgentWorkload[];
  unassigned: WorkloadCounts;
  scope: DashboardScope;
  className?: string;
}

/**
 * Tickets per assignee, stacked by status, with the unowned pile last.
 *
 * Agents with nothing in the slice are included on purpose — an idle queue is
 * information, and dropping the row would make the chart quietly answer a
 * different question ("who has tickets") than the one it is asked.
 *
 * Horizontal rather than vertical columns: the labels are names, and a small
 * team makes three or four *rows* read fine where three or four columns look
 * like a broken chart.
 *
 * Unassigned keeps the same status colours as the agent rows rather than a flat
 * muted fill — how much of the unowned pile is still open is the actionable part
 * of it, and a single colour would throw that away.
 */
export function WorkloadChart({
  workload,
  unassigned,
  scope,
  className,
}: WorkloadChartProps) {
  const data = useMemo<Row[]>(() => {
    const rows: Row[] = workload.map((agent) => toRow(agent.name, agent));
    // Pinned last regardless of size: "nobody" is not a person, so it should
    // never compete with the agents for the top of the chart.
    if (unassigned.total > 0) {
      rows.push(toRow(UNASSIGNED_LABEL, unassigned));
    }
    return rows;
  }, [workload, unassigned]);

  const isEmpty = data.length === 0 || data.every((r) => r.total === 0);
  const plotHeight = Math.max(MIN_PLOT_PX, data.length * ROW_PX + 40);

  return (
    <ChartCard
      className={className}
      title={scope === DASHBOARD_SCOPE.mine ? "Your workload" : "Workload"}
      subtitle="Tickets created in this range, by who they are assigned to"
      isEmpty={isEmpty}
      emptyMessage="Nothing assigned in this range."
      table={
        <DataTable
          columns={["Assignee", ...STATUS_STACK, "Total"]}
          rows={data.map((r) => [
            r.name,
            ...STATUS_STACK.map((s) => r[s]),
            r.total,
          ])}
        />
      }
    >
      <ChartContainer
        config={statusChartConfig}
        className="aspect-auto w-full"
        style={{ height: plotHeight }}
      >
        <BarChart
          accessibilityLayer
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis
            type="category"
            dataKey="name"
            tickLine={false}
            axisLine={false}
            width={104}
            tickMargin={4}
          />
          <ChartTooltip content={<ChartTooltipContent />} />
          {STATUS_STACK.map((status, i) => (
            <Bar
              key={status}
              dataKey={status}
              stackId="status"
              fill={`var(--color-${status})`}
              maxBarSize={18}
              shape={
                <StackSegmentH
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
