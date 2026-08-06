import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCountUp } from "@/lib/use-count-up";
import { formatDelta } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  className?: string;
}

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
  className,
}: StatTileProps) {
  const counted = useCountUp(value ?? 0);
  const shown = display ?? String(counted);
  const truth = display ?? String(value ?? 0);

  return (
    <Card size="sm" className={className}>
      <CardContent className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-3xl leading-none font-semibold">
          <span aria-hidden="true">{shown}</span>
          <span className="sr-only">{truth}</span>
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
