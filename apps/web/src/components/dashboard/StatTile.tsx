import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCountUp } from "@/lib/use-count-up";
import { formatDelta } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KPI_STATUS, StatusPill, type KpiStatus } from "./StatusPill";

interface StatTileProps {
  label: string;
  /** The number to count up to. Omit for a tile whose value isn't numeric
   *  (a formatted duration, say) and pass `display` instead. */
  value?: number;
  /** A pre-formatted value, used as-is. Takes precedence over `value`. */
  display?: string;
  /** One line of context under the value — the thing that makes it actionable. */
  sub?: ReactNode;
  /** Change against the previous window of the same length. */
  delta?: number;
  /** State of this KPI against its threshold, from `kpi-status.ts`. Omit when
   *  the number is unremarkable — a tile with nothing to say shows no pill. */
  status?: KpiStatus;
  /** The word inside the pill. Required with `status`, because status colour
   *  never carries meaning on its own. */
  statusLabel?: string;
  className?: string;
}

/** Only the two states that mean "act on this" tint the number itself. `good`
 *  deliberately does not: a dashboard where the healthy case is also coloured
 *  has no quiet state left to contrast against, and the green would land in the
 *  same hue family as every series on the page. */
const TINTED: Record<KpiStatus, string | undefined> = {
  [KPI_STATUS.good]: undefined,
  [KPI_STATUS.warning]: "text-status-warning",
  [KPI_STATUS.critical]: "text-status-critical",
};

/**
 * One KPI.
 *
 * The number counts up, which means the DOM briefly holds values that were never
 * true. So the animated frames are `aria-hidden` and the real number is exposed
 * separately to assistive tech — and neither is inside a live region, because
 * intermediate frames are decoration and announcing them would be noise.
 *
 * The value uses proportional figures, not `tabular-nums`: equal-width digits
 * make a number look loose at display sizes. Tabular belongs in the table twins,
 * where figures align vertically.
 */
export function StatTile({
  label,
  value,
  display,
  sub,
  delta,
  status,
  statusLabel,
  className,
}: StatTileProps) {
  const counted = useCountUp(value ?? 0);
  const shown = display ?? String(counted);
  const truth = display ?? String(value ?? 0);

  return (
    <Card
      size="sm"
      className={cn(
        // Lifts a little under the pointer. Transform and shadow only, so it
        // composites rather than reflowing the grid around it.
        "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <CardContent className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {status && statusLabel && (
            <StatusPill status={status} label={statusLabel} />
          )}
        </div>
        <p
          className={cn(
            "text-3xl leading-none font-semibold transition-colors duration-300",
            status && TINTED[status],
          )}
        >
          <span aria-hidden="true">{shown}</span>
          {/* The pill's word rides along in the accessible name so the state is
              not something you have to see a colour to learn. */}
          <span className="sr-only">
            {truth}
            {status && statusLabel ? `, ${statusLabel}` : ""}
          </span>
        </p>
        <div className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
          {sub}
          {delta !== undefined && <DeltaBadge delta={delta} />}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Change vs the previous window.
 *
 * Deliberately not coloured green/red: more tickets arriving is not good or bad
 * on its own, and spending a status colour to imply it would say something the
 * data doesn't. The arrow carries the direction; the text carries the size.
 */
function DeltaBadge({ delta }: { delta: number }) {
  const Icon = delta === 0 ? Minus : delta > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5")}>
      <Icon className="size-3" aria-hidden="true" />
      {formatDelta(delta)}
      <span className="sr-only"> versus the previous period</span>
    </span>
  );
}
