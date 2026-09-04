import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { LayoutGrid } from "lucide-react";
import {
  DASHBOARD_SCOPE,
  TUTORIAL_PAGE_KEY,
  type AssistantEffectivenessResponse,
  type DashboardPanelId,
  type DashboardPanelPlacement,
  type TicketStatsResponse,
} from "@ticket/shared";
import { AssistantEffectivenessCard } from "@/components/dashboard/AssistantEffectivenessCard";
import { DashboardFilters } from "@/components/dashboard/DashboardFilters";
import { DashboardPanelSlot } from "@/components/dashboard/DashboardPanelSlot";
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
import { DASHBOARD_GRID } from "@/components/dashboard/grid";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tutorial } from "@/components/Tutorial";
import {
  useDashboardLayoutQuery,
  useResetDashboardLayout,
  useSaveDashboardLayout,
} from "@/lib/dashboard-layout-queries";
import {
  parseDashboardParams,
  writeDashboardParams,
  type DashboardPatch,
} from "@/lib/dashboard-params";
import {
  applyPanelCommand,
  panelCapabilities,
  reorderPanels,
} from "@/lib/dashboard-panels";
import {
  assistantEffectivenessQueryOptions,
  ticketStatsQueryOptions,
} from "@/lib/dashboard-queries";
import { extractErrorMessage } from "@/lib/errors";
import { ROUTE_TIMING, useRouteRenderedMark } from "@/lib/route-timing";
import { cn } from "@/lib/utils";

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
  const [customizing, setCustomizing] = useState(false);

  const update = (patch: DashboardPatch) => {
    setSearchParams(writeDashboardParams(searchParams, patch), {
      replace: true,
    });
  };

  // All three built from the same options the route's loader primes them with
  // (`DashboardPage.loader.ts`), so the entries it wrote are the ones these
  // read — and on a normal visit they are already there, so nothing below ever
  // renders `DashboardSkeleton`.
  const {
    data,
    isPending: statsPending,
    isFetching: statsFetching,
    error: statsError,
  } = useQuery(ticketStatsQueryOptions(params));
  const {
    data: effectiveness,
    isPending: effectivenessPending,
    isFetching: effectivenessFetching,
    error: effectivenessError,
  } = useQuery(assistantEffectivenessQueryOptions({ range: params.range }));
  const { data: layoutData, isPending: layoutPending } =
    useDashboardLayoutQuery();
  const saveLayout = useSaveDashboardLayout();
  const resetLayout = useResetDashboardLayout();

  const isPending = statsPending || effectivenessPending || layoutPending;
  const isFetching = statsFetching || effectivenessFetching;
  const error = statsError ?? effectivenessError;

  // Closes `dashboard:navigate`. All three, not the first to arrive: this route
  // is the one that fans out, and a bracket that stopped at the fastest of the
  // three would be measuring the wrong thing — the panels below render only
  // once every one of them is in hand.
  useRouteRenderedMark(
    ROUTE_TIMING.dashboard,
    Boolean(data && effectiveness && layoutData),
  );

  // Pointer only, on the grip handle inside `DashboardPanelSlot` — see that
  // file's header comment for why there is no `KeyboardSensor` here.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  /**
   * Where every layout change lands — the four toolbar commands and a pointer
   * drag alike. The arrangement itself is decided by the pure functions in
   * `@/lib/dashboard-panels`, which hand back `null` for a move that would
   * change nothing; this page's whole share of it is knowing that `null` means
   * there is nothing to persist.
   */
  const save = (next: DashboardPanelPlacement[] | null) => {
    if (next) saveLayout.mutate(next);
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-6">
      <Tutorial pageKey={TUTORIAL_PAGE_KEY.dashboard} />

      {/* The controls ride on the heading's line rather than a row of their own,
          which is what stops the heading costing any vertical space here. They
          still sit above everything they scope — so every panel is always
          describing the same slice — and the description says so, because a
          panel that is empty for the selected range looks exactly like a panel
          that is empty. */}
      <PageHeader
        title="Dashboard"
        description="Every panel below follows the selected range and scope."
      >
        <div className="flex flex-wrap items-center gap-2">
          <div data-tutorial-anchor="range" className="contents">
            <DashboardFilters
              range={params.range}
              scope={params.scope}
              onRangeChange={(range) => update({ range })}
              onScopeChange={(scope) => update({ scope })}
            />
          </div>
          {/* Only worth offering once there is something to reset, and only
              while the controls that would make a new mess are visible. */}
          {customizing && !(layoutData?.isDefault ?? true) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => resetLayout.mutate()}
            >
              Reset to default
            </Button>
          )}
          <Button
            type="button"
            variant={customizing ? "secondary" : "outline"}
            size="sm"
            aria-pressed={customizing}
            onClick={() => setCustomizing((v) => !v)}
          >
            <LayoutGrid aria-hidden="true" />
            {customizing ? "Done customizing" : "Customize"}
          </Button>
        </div>
      </PageHeader>

      {isPending && <DashboardSkeleton />}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {extractErrorMessage(error, "Failed to load dashboard")}
        </p>
      )}

      {data && effectiveness && layoutData && (
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
            isFetching && "**:data-[slot=chart]:opacity-60",
          )}
        >
          <div data-tutorial-anchor="kpis" className="contents">
            <KpiRow
              summary={data.summary}
              firstResponse={data.firstResponse}
              categories={data.categories}
            />
          </div>

          {/* Two Recharts panels on the page, not five.

              The three that went are the ones whose whole job was "five labelled
              bars", which a proportional <div> does for a fraction of the cost —
              see MiniBarList. What stayed is what actually needs a plot: a time
              series with a real x-axis, and one latency distribution. Nothing was
              dropped, only re-rendered. */}
          {/* The panels fade up once, on mount. `both` fill means each element
              animates a single time when it first appears — a range change
              re-renders these panels but does not remount them, so switching
              7d/30d/90d does not replay it. Reordering/resizing (issue #102)
              doesn't remount them either: `DashboardPanelSlot` is keyed by
              `panelId`, not by array index, so React matches each panel to its
              existing DOM node across a drag instead of tearing it down. */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            // dnd-kit reports the ids it was handed, typed as its own
            // `UniqueIdentifier` — `reorderPanels` looks both up in the array
            // and declines the drag if either is a stranger.
            onDragEnd={({ active, over }) => {
              if (!over) return;
              save(
                reorderPanels(
                  layoutData.layout,
                  active.id as DashboardPanelId,
                  over.id as DashboardPanelId,
                ),
              );
            }}
          >
            <SortableContext
              items={layoutData.layout.map((p) => p.panelId)}
              strategy={rectSortingStrategy}
            >
              <div className={cn(DASHBOARD_GRID, "*:animate-panel-in")}>
                {layoutData.layout.map((placement) => (
                  <DashboardPanelSlot
                    key={placement.panelId}
                    placement={placement}
                    capabilities={panelCapabilities(
                      layoutData.layout,
                      placement.panelId,
                    )}
                    customizing={customizing}
                    onCommand={(command) =>
                      save(
                        applyPanelCommand(
                          layoutData.layout,
                          placement.panelId,
                          command,
                        ),
                      )
                    }
                  >
                    {renderDashboardPanel(placement.panelId, {
                      data,
                      effectiveness,
                    })}
                  </DashboardPanelSlot>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}

/** One panel's content, by durable id — see `DASHBOARD_PANEL_ID` in
 * `@ticket/shared` for why the id exists at all. Kept as one function rather
 * than inlined per-case in `DashboardPage`, so `DashboardPanelSlot`'s props
 * (the placement and its commands) stay visually separate from what each panel
 * actually renders. */
function renderDashboardPanel(
  panelId: DashboardPanelId,
  {
    data,
    effectiveness,
  }: {
    data: TicketStatsResponse;
    effectiveness: AssistantEffectivenessResponse;
  },
) {
  switch (panelId) {
    case "volumeChart":
      return <VolumeChart volume={data.volume} bucket={data.bucket} />;
    // The status key sits beside the chart it explains, so the volume chart
    // still needs no legend box of its own.
    case "statusMix":
      return (
        <StatusMixCard
          byStatus={data.summary.byStatus}
          total={data.summary.total}
        />
      );
    case "needsAttention":
      return <NeedsAttentionCard tickets={data.needsAttention} />;
    case "firstResponseChart":
      return <FirstResponseChart stats={data.firstResponse} />;
    case "byCategory":
      return (
        <MiniBarList
          title="By category"
          subtitle="Including tickets nobody has filed yet"
          rows={categoryRows(data.categories)}
        />
      );
    case "workload":
      return (
        <MiniBarList
          title={
            data.scope === DASHBOARD_SCOPE.mine ? "Your workload" : "Workload"
          }
          subtitle="By who the ticket is assigned to"
          rows={workloadRows(data.workload, data.unassigned)}
          emptyMessage="Nothing assigned in this range."
        />
      );
    case "backlogAge":
      return (
        <MiniBarList
          title="Open backlog age"
          subtitle="How long still-open tickets have waited"
          rows={backlogAgeRows(data.backlogAge)}
          emptyMessage="Nothing open in this range."
        />
      );
    case "topCustomers":
      return <TopCustomersCard customers={data.topCustomers} />;
    case "assistantEffectiveness":
      return (
        <div data-tutorial-anchor="assistant" className="contents">
          <AssistantEffectivenessCard data={effectiveness} />
        </div>
      );
  }
}
