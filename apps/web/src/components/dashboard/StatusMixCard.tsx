import type { StatusCounts, TicketStatus } from "@ticket/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STATUS_STACK, statusChartConfig } from "./chart-tokens";

/**
 * The slice's status mix as a single meter.
 *
 * Three rectangles do not need a chart engine, and a 2-or-3 slice donut is the
 * thing the reader has to work hardest to compare. A 100% meter answers "how
 * much of this is still open" in one glance.
 *
 * It also doubles as the page's colour key: it names Open / Resolved / Closed
 * beside their swatches, which is what lets the volume and workload charts skip
 * a legend box of their own.
 */
export function StatusMixCard({
  byStatus,
  total,
  className,
}: {
  byStatus: StatusCounts;
  total: number;
  className?: string;
}) {
  // Rendered in stack order so the meter and the columns beside it read the
  // same way round.
  const segments = STATUS_STACK.map((status) => ({
    status,
    count: byStatus[status],
  })).filter((s) => s.count > 0);

  return (
    // self-start so the card hugs its content instead of stretching to match
    // the taller panel beside it — a meter and a legend do not benefit from
    // 400px of empty card under them.
    <Card className={cn("self-start", className)}>
      <CardHeader>
        <CardTitle>Status mix</CardTitle>
        <CardDescription>
          {total} {total === 1 ? "ticket" : "tickets"} created in this range
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in this range.</p>
        ) : (
          <>
            {/* gap-0.5 is the 2px surface gap: the segments are separated by the
                card showing through, not by a stroke drawn around each one. */}
            <div
              className="flex h-6 gap-0.5 overflow-hidden rounded-md"
              role="img"
              aria-label={STATUS_STACK.map(
                (s) => `${s}: ${byStatus[s]}`,
              ).join(", ")}
            >
              {segments.map(({ status, count }) => (
                <div
                  key={status}
                  className="first:rounded-l-md last:rounded-r-md"
                  style={{
                    width: `${(count / total) * 100}%`,
                    backgroundColor: fillOf(status),
                  }}
                />
              ))}
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1">
              {STATUS_STACK.map((status) => (
                <li key={status} className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-[3px]"
                    style={{ backgroundColor: fillOf(status) }}
                  />
                  {/* The label and count wear text tokens, never the series
                      colour — the swatch beside them carries the identity. */}
                  <span className="text-muted-foreground">{status}</span>
                  <span className="font-medium tabular-nums">
                    {byStatus[status]}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatPercent(byStatus[status] / total)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function fillOf(status: TicketStatus): string {
  return statusChartConfig[status].color;
}
