import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CHART_HEIGHT_CLASS } from "./chart-tokens";
import { DASHBOARD_GRID, PANEL_SPAN } from "./grid";

/**
 * The dashboard's own layout in placeholder form.
 *
 * The grid classes and the plot height come from the same constants the real
 * panels use, so the two can't drift and the swap from loading to loaded causes
 * no layout shift.
 */
export function DashboardSkeleton() {
  return (
    <div
      className="flex flex-col gap-3"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} size="sm">
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Mirrors DashboardPage's grid panel-for-panel, so the swap to the real
          content moves nothing. The three `short` panels are the MiniBarLists,
          which are rows of text rather than a plot and so stand a fraction of a
          chart's height. */}
      <div className={DASHBOARD_GRID}>
        <PanelSkeleton className={PANEL_SPAN.twoThirds} />
        <PanelSkeleton className={PANEL_SPAN.narrow} short />

        <PanelSkeleton className={PANEL_SPAN.twoThirds} />
        <PanelSkeleton className={PANEL_SPAN.narrow} />

        <PanelSkeleton className={PANEL_SPAN.narrow} short />
        <PanelSkeleton className={PANEL_SPAN.narrow} short />
        <PanelSkeleton className={PANEL_SPAN.narrow} short />

        <PanelSkeleton className={PANEL_SPAN.wide} short />
        <PanelSkeleton className={PANEL_SPAN.wide} short />
      </div>
    </div>
  );
}

function PanelSkeleton({
  className,
  short = false,
}: {
  className?: string;
  short?: boolean;
}) {
  return (
    <Card className={className}>
      <CardHeader className="gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </CardHeader>
      <CardContent>
        <Skeleton className={cn(short ? "h-20" : CHART_HEIGHT_CLASS, "w-full")} />
      </CardContent>
    </Card>
  );
}
