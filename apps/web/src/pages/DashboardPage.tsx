import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { TicketStatsQuery } from "@ticket/core";
import type { TicketStatsResponse } from "@ticket/shared";
import { NavBar } from "@/components/NavBar";
import { BacklogAgeChart } from "@/components/dashboard/BacklogAgeChart";
import { CategoryChart } from "@/components/dashboard/CategoryChart";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { DashboardSkeleton } from "@/components/dashboard/DashboardSkeleton";
import { FirstResponseChart } from "@/components/dashboard/FirstResponseChart";
import { KpiRow } from "@/components/dashboard/KpiRow";
import { NeedsAttentionCard } from "@/components/dashboard/NeedsAttentionCard";
import { StatusMixCard } from "@/components/dashboard/StatusMixCard";
import { TopCustomersCard } from "@/components/dashboard/TopCustomersCard";
import { VolumeChart } from "@/components/dashboard/VolumeChart";
import { WorkloadChart } from "@/components/dashboard/WorkloadChart";
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
    // with a skeleton: the panels dim and the charts morph, so nothing jumps.
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
    <div className="min-h-dvh bg-background">
      <NavBar />
      <main className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
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
              isFetching && "opacity-60",
            )}
          >
            <KpiRow
              summary={data.summary}
              firstResponse={data.firstResponse}
              categories={data.categories}
            />

            <div className={DASHBOARD_GRID}>
              <VolumeChart
                className={PANEL_SPAN.wide}
                volume={data.volume}
                bucket={data.bucket}
              />
              {/* Two short panels stacked beside one tall one, rather than
                  three cells in a row — the status meter is a few lines high and
                  the attention list is not, so side by side they would leave a
                  column of dead space. */}
              <div className={cn(PANEL_SPAN.narrow, "flex flex-col gap-3")}>
                {/* The status key sits directly under the chart it explains, so
                    the volume chart needs no legend box of its own. */}
                <StatusMixCard
                  byStatus={data.summary.byStatus}
                  total={data.summary.total}
                />
                <CategoryChart categories={data.categories} />
              </div>
              <NeedsAttentionCard
                className={PANEL_SPAN.twoThirds}
                tickets={data.needsAttention}
              />
              <FirstResponseChart
                className={PANEL_SPAN.half}
                stats={data.firstResponse}
              />
              <BacklogAgeChart
                className={PANEL_SPAN.half}
                stats={data.backlogAge}
              />
              <WorkloadChart
                className={PANEL_SPAN.half}
                workload={data.workload}
                unassigned={data.unassigned}
                scope={data.scope}
              />
              <TopCustomersCard
                className={PANEL_SPAN.half}
                customers={data.topCustomers}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
