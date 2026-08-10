import type { ReactNode } from "react";
import { Hint } from "@/components/Hint";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface MiniBarRow {
  /** Row label. Wears a text token — the bar beside it carries the magnitude. */
  label: string;
  value: number;
  /** Optional second figure shown muted before the bar (e.g. how many are open). */
  note?: ReactNode;
  /** Overrides the default fill. Ordered data passes a ramp step per row. */
  fill?: string;
}

/**
 * A compact distribution: label, proportional bar, value — one row each.
 *
 * This exists to keep Recharts off panels that never needed it. A bar whose
 * length is a percentage of a `<div>` costs one style recalculation; the same
 * five bars in Recharts cost a `ResponsiveContainer`, a ResizeObserver, d3
 * scales, and a full React subtree rebuild every time the panel changes width.
 * On a dashboard whose panels resize whenever the sidebar moves, that difference
 * is the whole performance story — measured at ~20ms per chart per resize.
 *
 * The tradeoff is real and worth stating: there is no axis and no hover layer
 * over the bars. That is acceptable *because* every row is directly labelled
 * with its own value, which is the relief channel a chart would otherwise need
 * its tooltip for. (The label has a `Hint` on it, but that only reveals a name
 * the 8rem column truncated — it carries no data.) Do not use this for anything
 * a reader must compare against a scale, or for continuous data — that is what
 * the two remaining charts are for.
 */
export function MiniBarList({
  title,
  subtitle,
  rows,
  emptyMessage = "Nothing in this range.",
  className,
}: {
  title: string;
  subtitle?: string;
  rows: MiniBarRow[];
  emptyMessage?: string;
  className?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const isEmpty = rows.length === 0 || rows.every((r) => r.value === 0);

  return (
    <Card className={cn("self-start", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <p className="py-4 text-sm text-muted-foreground">{emptyMessage}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.label} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2">
                <Hint content={row.label}>
                  <span className="truncate text-sm text-muted-foreground">
                    {row.label}
                  </span>
                </Hint>
                <span className="flex items-center gap-2">
                  {/* The track is what makes a short bar still read as "small"
                      rather than as a rendering failure. */}
                  <span className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                      style={{
                        width: `${(row.value / max) * 100}%`,
                        backgroundColor: row.fill ?? "var(--viz-accent)",
                      }}
                    />
                  </span>
                  {row.note !== undefined && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {row.note}
                    </span>
                  )}
                </span>
                <span className="w-8 text-right text-sm font-medium tabular-nums">
                  {row.value}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
