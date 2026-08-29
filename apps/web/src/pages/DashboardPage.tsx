import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { LayoutGrid } from "lucide-react";
import type { TicketEffectivenessQuery, TicketStatsQuery } from "@ticket/core";
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
import { api } from "@/lib/api";
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
import { DASHBOARD_PANEL_WIDTH_ORDER } from "@/lib/dashboard-panels";
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

function useAssistantEffectivenessQuery(params: TicketEffectivenessQuery) {
  return useQuery({
    queryKey: ticketKeys.effectiveness(params),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<AssistantEffectivenessResponse>(
        "/api/tickets/effectiveness",
        { params, signal },
      );
      return data;
    },
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
  const [customizing, setCustomizing] = useState(false);

  const update = (patch: DashboardPatch) => {
    setSearchParams(writeDashboardParams(searchParams, patch), {
      replace: true,
    });
  };

  const {
    data,
    isPending: statsPending,
    isFetching: statsFetching,
    error: statsError,
  } = useTicketStatsQuery(params);
  const {
    data: effectiveness,
    isPending: effectivenessPending,
    isFetching: effectivenessFetching,
    error: effectivenessError,
  } = useAssistantEffectivenessQuery({ range: params.range });
  const { data: layoutData, isPending: layoutPending } =
    useDashboardLayoutQuery();
  const saveLayout = useSaveDashboardLayout();
  const resetLayout = useResetDashboardLayout();

  const isPending = statsPending || effectivenessPending || layoutPending;
  const isFetching = statsFetching || effectivenessFetching;
  const error = statsError ?? effectivenessError;

  // Pointer only, on the grip handle inside `DashboardPanelSlot` — see that
  // file's header comment for why there is no `KeyboardSensor` here.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function moveEarlier(layout: DashboardPanelPlacement[], panelId: DashboardPanelId) {
    const index = layout.findIndex((p) => p.panelId === panelId);
    if (index <= 0) return;
    saveLayout.mutate(arrayMove(layout, index, index - 1));
  }

  function moveLater(layout: DashboardPanelPlacement[], panelId: DashboardPanelId) {
    const index = layout.findIndex((p) => p.panelId === panelId);
    if (index === -1 || index >= layout.length - 1) return;
    saveLayout.mutate(arrayMove(layout, index, index + 1));
  }

  function resize(
    layout: DashboardPanelPlacement[],
    panelId: DashboardPanelId,
    direction: 1 | -1,
  ) {
    const index = layout.findIndex((p) => p.panelId === panelId);
    if (index === -1) return;
    const widthIndex = DASHBOARD_PANEL_WIDTH_ORDER.indexOf(
      layout[index]!.width,
    );
    const nextWidthIndex = widthIndex + direction;
    if (nextWidthIndex < 0 || nextWidthIndex >= DASHBOARD_PANEL_WIDTH_ORDER.length) {
      return;
    }
    const next = [...layout];
    next[index] = {
      ...next[index]!,
      width: DASHBOARD_PANEL_WIDTH_ORDER[nextWidthIndex]!,
    };
    saveLayout.mutate(next);
  }

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
            onDragEnd={(event) => {
              const { active, over } = event;
              if (!over || active.id === over.id) return;
              const oldIndex = layoutData.layout.findIndex(
                (p) => p.panelId === active.id,
              );
              const newIndex = layoutData.layout.findIndex(
                (p) => p.panelId === over.id,
              );
              if (oldIndex === -1 || newIndex === -1) return;
              saveLayout.mutate(
                arrayMove(layoutData.layout, oldIndex, newIndex),
              );
            }}
          >
            <SortableContext
              items={layoutData.layout.map((p) => p.panelId)}
              strategy={rectSortingStrategy}
            >
              <div className={cn(DASHBOARD_GRID, "*:animate-panel-in")}>
                {layoutData.layout.map((placement, index) => {
                  const widthIndex = DASHBOARD_PANEL_WIDTH_ORDER.indexOf(
                    placement.width,
                  );
                  return (
                    <DashboardPanelSlot
                      key={placement.panelId}
                      placement={placement}
                      customizing={customizing}
                      isFirst={index === 0}
                      isLast={index === layoutData.layout.length - 1}
                      canShrink={widthIndex > 0}
                      canGrow={widthIndex < DASHBOARD_PANEL_WIDTH_ORDER.length - 1}
                      onMoveEarlier={() =>
                        moveEarlier(layoutData.layout, placement.panelId)
                      }
                      onMoveLater={() =>
                        moveLater(layoutData.layout, placement.panelId)
                      }
                      onShrink={() =>
                        resize(layoutData.layout, placement.panelId, -1)
                      }
                      onGrow={() =>
                        resize(layoutData.layout, placement.panelId, 1)
                      }
                    >
                      {renderDashboardPanel(placement.panelId, {
                        data,
                        effectiveness,
                      })}
                    </DashboardPanelSlot>
                  );
                })}
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
 * (position, width, customize handlers) stay visually separate from what
 * each panel actually renders. */
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
