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
import { TableFrame } from "@/lib/table-frame";
import { cn } from "@/lib/utils";
import { CHART_HEIGHT_CLASS } from "./chart-tokens";

interface ChartCardProps {
  title: string;
  /** One line under the title. Say what the numbers cover, not what they are. */
  subtitle?: string;
  /** A headline figure — a median, a total — where one exists. Top-right from
   *  `sm` up; on its own line under the heading on a phone. */
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

  // A headline figure in `CardAction`'s second column squeezes the title and
  // description into what is left of a phone's width (#400). Below `sm` the
  // header is one column and the action row drops under the heading, figure
  // left and toggle right; from `sm` it is shadcn's top-right corner again.
  // A viewport breakpoint, not a container query: the narrow dashboard panels
  // are about 320px wide at 1280px and keep the corner there. Without a figure
  // the toggle alone fits the corner at any width, so nothing moves.
  // The two class strings work only as a pair: change the breakpoint in both.
  // Not `stat &&`: a figure of 0 is a figure and still renders.
  const hasStat = stat !== undefined && stat !== null && stat !== false;
  const stackedHeader =
    "has-data-[slot=card-action]:grid-cols-1 sm:has-data-[slot=card-action]:grid-cols-[1fr_auto]";
  const stackedAction =
    "col-start-1 row-span-1 row-start-auto justify-between justify-self-stretch sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end";

  return (
    <Card className={className}>
      <CardHeader className={cn(hasStat && stackedHeader)}>
        <CardTitle>{title}</CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
        <CardAction
          className={cn("flex items-center gap-3", hasStat && stackedAction)}
        >
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
          <TableFrame label={title} className={CHART_HEIGHT_CLASS}>
            {table}
          </TableFrame>
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
  rows: ReactNode[][];
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
