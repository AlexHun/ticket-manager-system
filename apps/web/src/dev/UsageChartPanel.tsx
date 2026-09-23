import { useId, type ReactNode } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ChartConfig } from "@/components/ui/chart";
import { CHART_HEIGHT_CLASS } from "@/components/dashboard/chart-tokens";
import { cn } from "@/lib/utils";

/**
 * What the Usage page's two charts share: the panel they sit in, their one
 * series config, and the per-bin fill the tooltip reads.
 *
 * Out of `UsageCharts.tsx` since #297. That file is the two *readings* — which
 * question each chart asks and how its marks answer it — and this is the shell
 * both of them are poured into, which neither one decides anything about.
 */

/** One series, so one config key — and it must equal the `dataKey`, which is
 *  what `ChartStyle` emits its custom property from. */
export const issuesConfig = {
  count: { label: "Issues", color: "var(--viz-accent)" },
} satisfies ChartConfig;

/**
 * A bin with its own colour on it, which is what the tooltip needs.
 *
 * Both charts colour per column rather than per series, and a `<Cell>` alone
 * does not tell the tooltip that: `ChartTooltipContent` resolves its swatch as
 * `color ?? item.payload?.fill ?? item.color`, and with the fill living only on
 * the Cell it falls through to `item.color` — the *series* colour from
 * `issuesConfig`. Hovering the red "over" column then showed an accent-green dot
 * beside it. Carrying the fill on the datum answers both: the `<Cell>` reads it
 * for the bar, and Recharts hands the same object to the tooltip.
 */
export const withFill = <T,>(bin: T, fill: string) => ({ ...bin, fill });

/**
 * The shell both panels share: a named region, a headline figure, and an empty
 * state that says what is missing instead of drawing an axis around nothing.
 *
 * `role="region"` with `aria-labelledby` for the reason `TableFrame` carries the
 * same pair (#111): a region without an accessible name is not exposed as a
 * landmark at all, and these two panels are what the E2E addresses by name —
 * Playwright's full-page screenshots catch Recharts mid-animation, so the spec
 * asserts on roles and text and never on a picture.
 */
export function ChartPanel({
  title,
  description,
  stat,
  isEmpty,
  emptyMessage,
  footer,
  children,
}: {
  title: string;
  description: string;
  /** A headline figure for the top-right — the one number the panel is for. */
  stat?: ReactNode;
  isEmpty: boolean;
  /** Shown instead of the chart. Says which measurement is missing, never
   *  "no data". */
  emptyMessage: string;
  /** What the figures are read against. Shown in both states: it is context for
   *  the empty message as much as for the chart. */
  footer: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader>
        <CardTitle id={titleId}>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {stat && (
          <CardAction className="text-sm font-medium tabular-nums">
            {stat}
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div
            className={cn(CHART_HEIGHT_CLASS, "grid place-items-center")}
            role="status"
          >
            <p className="max-w-prose text-center text-sm text-muted-foreground">
              {emptyMessage}
            </p>
          </div>
        ) : (
          children
        )}
        <p className="max-w-prose pt-2 text-xs text-muted-foreground">
          {footer}
        </p>
      </CardContent>
    </Card>
  );
}
