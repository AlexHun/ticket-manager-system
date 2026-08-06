import { useId, useState, type ReactNode } from "react";
import { ChartColumn, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CHART_HEIGHT_CLASS } from "./chart-tokens";

interface ChartCardProps {
  title: string;
  /** One line under the title. Say what the numbers cover, not what they are. */
  subtitle?: string;
  /** A headline figure for the top-right — a median, a total — where one exists. */
  stat?: ReactNode;
  /** The chart. Rendered only when `isEmpty` is false. */
  children: ReactNode;
  /**
   * The same numbers as a table. Not optional by accident: a tooltip must never
   * be the only way to read a value, and this is the relief that guarantees it —
   * including for the one ordinal step that sits under 3:1 on the light card.
   */
  table: ReactNode;
  /** True when the series sums to zero: draw the message, not an axis around
   *  nothing. A real case, not an edge one — a fresh scope=mine has no tickets. */
  isEmpty?: boolean;
  emptyMessage?: string;
  className?: string;
}

/**
 * The shell every chart panel shares: heading, optional headline figure, the
 * chart/table toggle, and the empty state.
 *
 * The toggle lives here rather than per-chart so that every chart gets a table
 * twin for free — a chart that shipped without one would have to opt out
 * deliberately instead of merely forgetting.
 */
export function ChartCard({
  title,
  subtitle,
  stat,
  children,
  table,
  isEmpty = false,
  emptyMessage = "Nothing in this range.",
  className,
}: ChartCardProps) {
  const [showTable, setShowTable] = useState(false);
  const panelId = useId();

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
        <CardAction className="flex items-center gap-3">
          {stat}
          {!isEmpty && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-pressed={showTable}
              aria-controls={panelId}
              aria-label={showTable ? "Show chart" : "Show data table"}
              onClick={() => setShowTable((v) => !v)}
            >
              {showTable ? <ChartColumn /> : <Table2 />}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent id={panelId}>
        {isEmpty ? (
          <div
            className={cn(CHART_HEIGHT_CLASS, "grid place-items-center")}
            role="status"
          >
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : showTable ? (
          <div className={cn(CHART_HEIGHT_CLASS, "overflow-auto")}>{table}</div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The table twin's markup, shared so every panel's table looks the same.
 *
 * `tabular-nums` is correct *here* — these are columns of figures that align
 * vertically — and deliberately absent from the stat tiles, where equal-width
 * digits make a large number look loose.
 */
export function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: (ReactNode[])[];
}) {
  return (
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-card">
        <tr className="border-b text-left text-xs text-muted-foreground">
          {columns.map((c, i) => (
            <th
              key={c}
              scope="col"
              className={cn("py-1.5 font-medium", i > 0 && "text-right")}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, r) => (
          <tr key={r} className="border-b last:border-0">
            {cells.map((cell, i) => (
              <td
                key={i}
                className={cn(
                  "py-1.5",
                  i > 0 && "text-right tabular-nums",
                  i === 0 && "text-muted-foreground",
                )}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
