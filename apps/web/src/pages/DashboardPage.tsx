import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { TicketStatsQuery } from "@ticket/core";
import { DASHBOARD_SCOPE, type TicketStatsResponse } from "@ticket/shared";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { FirstResponseChart } from "@/components/dashboard/FirstResponseChart";
import { KpiRow } from "@/components/dashboard/KpiRow";
import { MiniBarList } from "@/components/dashboard/MiniBarList";
import { NeedsAttentionCard } from "@/components/dashboard/NeedsAttentionCard";
import { StatusMixCard } from "@/components/dashboard/StatusMixCard";
import { TopCustomersCard } from "@/components/dashboard/TopCustomersCard";
import { VolumeChart } from "@/components/dashboard/VolumeChart";
import {
  backlogAgeRows,
  categoryRows,
  workloadRows,
} from "@/components/dashboard/mini-rows";
import { DASHBOARD_GRID, PANEL_SPAN } from "@/components/dashboard/grid";
import { api } from "@/lib/api";
import {
  parseDashboardParams,
  writeDashboardParams,
  type DashboardPatch,
} from "@/lib/dashboard-params";
import { extractErrorMessage } from "@/lib/errors";
import { ticketKeys } from "@/lib/ticket-queries";
import { cn } from "@/lib/utils";

function useTicketStatsQuery(params: TicketStatsQuery) {
  return useQuery({
    queryKey: ticketKeys.stats(params),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketStatsResponse>(
        "/api/tickets/stats",
        { params, signal },
      );
      return data;
    },
    // Changing the range holds the rendered dashboard rather than replacing it
    // with a skeleton, so the layout never collapses and rebuilds under you.
    placeholderData: keepPreviousData,
  });
}

/**
 * The dashboard, at `/` — where every user already lands after signing in.
 *
 * Everything drawn here is derived from columns that exist. There is no
 * `resolvedAt`, so resolution time is absent rather than approximated from
 * `updatedAt`, which bumps on any edit and would read as a measurement while
 * being noise.
 *
 * Range and scope live in the URL, so a particular view is shareable and
 * survives a reload — the same arrangement as the tickets list.
 */
export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = parseDashboardParams(searchParams);

  const update = (patch: DashboardPatch) => {
    setSearchParams(writeDashboardParams(searchParams, patch), {
      replace: true,
    });
  };

  const { data, isPending, isFetching, error } = useTicketStatsQuery(params);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        {/* One filter row, above everything it scopes — so every panel is
            always describing the same slice. */}
        <DashboardFilters
          range={params.range}
          scope={params.scope}
          onRangeChange={(range) => update({ range })}
          onScopeChange={(scope) => update({ scope })}
        />
      </div>

      {isPending && <DashboardSkeleton />}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {extractErrorMessage(error, "Failed to load dashboard")}
        </p>
      )}

      {data && (
        <div
          aria-busy={isFetching}
          className={cn(
            "flex flex-col gap-3 transition-opacity motion-reduce:transition-none",
            // Only the plots dim, not the whole dashboard.
            //
            // `opacity` composites toward the surface underneath, so the same
            // 0.6 does very different things per mode: on the white card it
            // drags muted label text from 4.65:1 down to 1.89:1, while on the
            // dark card it composites toward black and lands back at 4.65:1 —
            // which is why this only ever looked wrong in light mode. No
            // opacity both signals "stale" and keeps light text at 4.5:1 (the
            // break-even is about 0.99), so the dim comes off the words
            // entirely. The cue still lands on the plots themselves, and
            // `aria-busy` above carries it for anyone not looking at the
            // colour.
            isFetching && "[&_[data-slot=chart]]:opacity-60",
          )}
        >
          <KpiRow
            summary={data.summary}
            firstResponse={data.firstResponse}
            categories={data.categories}
          />

          {/* Two Recharts panels on the page, not five.

              The three that went are the ones whose whole job was "five labelled
              bars", which a proportional <div> does for a fraction of the cost —
              see MiniBarList. What stayed is what actually needs a plot: a time
              series with a real x-axis, and one latency distribution. Nothing was
              dropped, only re-rendered. */}
          {/* The panels fade up once, on mount. `both` fill means each element
              animates a single time when it first appears — a range change
              re-renders these panels but does not remount them, so switching
              7d/30d/90d does not replay it. */}
          <div className={cn(DASHBOARD_GRID, "[&>*]:animate-panel-in")}>
            <VolumeChart
              className={PANEL_SPAN.twoThirds}
              volume={data.volume}
              bucket={data.bucket}
            />
            {/* The status key sits beside the chart it explains, so the volume
                chart still needs no legend box of its own. */}
            <StatusMixCard
              className={PANEL_SPAN.narrow}
              byStatus={data.summary.byStatus}
              total={data.summary.total}
            />

            <NeedsAttentionCard
              className={PANEL_SPAN.twoThirds}
              tickets={data.needsAttention}
            />
            <FirstResponseChart
              className={PANEL_SPAN.narrow}
              stats={data.firstResponse}
            />

            <MiniBarList
              className={PANEL_SPAN.narrow}
              title="By category"
              subtitle="Including tickets nobody has filed yet"
              rows={categoryRows(data.categories)}
            />
            <MiniBarList
              className={PANEL_SPAN.narrow}
              title={
                data.scope === DASHBOARD_SCOPE.mine
                  ? "Your workload"
                  : "Workload"
              }
              subtitle="By who the ticket is assigned to"
              rows={workloadRows(data.workload, data.unassigned)}
              emptyMessage="Nothing assigned in this range."
            />
            <MiniBarList
              className={PANEL_SPAN.narrow}
              title="Open backlog age"
              subtitle="How long still-open tickets have waited"
              rows={backlogAgeRows(data.backlogAge)}
              emptyMessage="Nothing open in this range."
            />

            <TopCustomersCard
              className={PANEL_SPAN.wide}
              customers={data.topCustomers}
            />
          </div>
        </div>
      )}
    </div>
  );
}
