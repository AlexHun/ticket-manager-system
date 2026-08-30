import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  TUTORIAL_PAGE_KEY,
  type ActivityEntityType,
  type ActivityEntry,
  type ActivityFeedResponse,
} from "@ticket/shared";
import { Tutorial } from "@/components/Tutorial";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { activityKeys } from "@/lib/activity-queries";
import {
  ACTIVITY_ACTION_LABEL,
  ACTIVITY_ENTITY_LABEL,
  activityEntryHref,
  activityEntryLinkLabel,
} from "@/lib/activity-feed-labels";
import { extractErrorMessage } from "@/lib/errors";
import { EMPTY_VALUE } from "@/lib/format";
import { TABLE_FRAME } from "@/lib/table-frame";
import { cn } from "@/lib/utils";
import {
  ActivityFilters,
  EMPTY_ACTIVITY_FILTERS,
  hasActiveActivityFilters,
  type ActivityFilterState,
} from "./ActivityFilters";
import { TicketsPagination } from "./TicketsPagination";

/**
 * The unified admin activity feed, at `/activity` — admin only.
 *
 * `GET /api/activity` (built for #51) is a query-time merge of five sources
 * that already keep their own trail: `TicketActivity`, outbound replies,
 * `KnowledgeArticleRevision`, `AdminActivity`, and `AutomationSettingsRevision`.
 * Until this page existed, reading any of that meant knowing which of four
 * screens to open — and `AdminActivity` and `AutomationSettingsRevision` had
 * no screen at all, so an admin auditing "who changed what" over the whole
 * desk had no single place to look. This is that place: one table, one set of
 * filters, over everything at once.
 *
 * Wears the shared `TABLE_FRAME`, without the sorting or column resizing —
 * the feed is always newest-first (the server's own `ORDER BY`), and there is
 * nothing here worth reordering by.
 */

const HEAD = "sticky top-0 z-10 bg-muted px-4 py-2 text-left font-medium";

interface ActivityQueryParams {
  page: number;
  pageSize: number;
  entityType?: ActivityEntityType;
  actorId?: string;
  from?: string;
  to?: string;
}

/**
 * The API's `to` is exclusive (see `activityQuerySchema`), but the "To" field
 * reads as a calendar day the admin means to *include* — so the day after it
 * is what actually goes on the wire.
 */
function exclusiveTo(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Empty filters are dropped rather than sent as blanks the API must ignore. */
function toActivityQueryParams(
  filters: ActivityFilterState,
  page: number,
  pageSize: number,
): ActivityQueryParams {
  const params: ActivityQueryParams = { page, pageSize };
  if (filters.entityType) params.entityType = filters.entityType;
  if (filters.actorId) params.actorId = filters.actorId;
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = exclusiveTo(filters.to);
  return params;
}

function useActivityQuery(params: ActivityQueryParams) {
  return useQuery({
    queryKey: activityKeys.list(params),
    queryFn: async ({ signal }) => {
      const { data } = await api.get<ActivityFeedResponse>("/api/activity", {
        params,
        signal,
      });
      return data;
    },
    // Filtering and paging each swap the whole result set. Hold the current
    // rows on screen while the new ones load instead of flashing the skeleton
    // on every interaction — same reasoning as `TicketsPage`.
    placeholderData: keepPreviousData,
  });
}

function changeText(entry: ActivityEntry): string {
  if (entry.fromValue && entry.toValue) {
    return `${entry.fromValue} → ${entry.toValue}`;
  }
  return entry.toValue ?? entry.fromValue ?? EMPTY_VALUE;
}

export function ActivityPage() {
  const [filters, setFilters] = useState<ActivityFilterState>(EMPTY_ACTIVITY_FILTERS);
  const [page, setPage] = useState(FIRST_PAGE);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const params = toActivityQueryParams(filters, page, pageSize);
  const { data, isPending, isFetching, error } = useActivityQuery(params);

  const handleFiltersChange = (next: ActivityFilterState) => {
    setFilters(next);
    setPage(FIRST_PAGE);
  };

  const filtered = hasActiveActivityFilters(filters);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
      <Tutorial pageKey={TUTORIAL_PAGE_KEY.activity} />

      <PageHeader
        title="Activity"
        description="Every recorded change across tickets, the knowledge base, accounts and automation — newest first."
      />

      <div className="mb-4 shrink-0" data-tutorial-anchor="filters">
        <ActivityFilters filters={filters} onChange={handleFiltersChange} />
      </div>

      {isPending && <ActivitySkeleton />}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {extractErrorMessage(error, "Failed to load the activity feed")}
        </p>
      )}

      {data && (
        <div
          aria-busy={isFetching}
          data-tutorial-anchor="feed"
          className={cn(
            "flex min-h-0 flex-1 flex-col transition-opacity",
            isFetching && "opacity-60",
          )}
        >
          {data.entries.length === 0 ? (
            <div
              className={cn(
                TABLE_FRAME,
                "grid min-h-0 flex-1 place-items-center",
              )}
            >
              <p className="text-sm text-muted-foreground">
                {filtered
                  ? "No activity matches these filters."
                  : "Nothing recorded yet."}
              </p>
            </div>
          ) : (
            <div className={cn(TABLE_FRAME, "min-h-0 flex-1")}>
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th scope="col" className={HEAD}>
                      When
                    </th>
                    <th scope="col" className={HEAD}>
                      Actor
                    </th>
                    <th scope="col" className={HEAD}>
                      Entity
                    </th>
                    <th scope="col" className={HEAD}>
                      Action
                    </th>
                    <th scope="col" className={HEAD}>
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((entry) => (
                    <ActivityRow key={entry.id} entry={entry} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.total > 0 && (
            <TicketsPagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setPageSize(next);
                setPage(FIRST_PAGE);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const href = activityEntryHref(entry);
  const linkLabel = activityEntryLinkLabel(entry);
  const entityText = linkLabel
    ? `${ACTIVITY_ENTITY_LABEL[entry.entityType]} ${linkLabel}`
    : ACTIVITY_ENTITY_LABEL[entry.entityType];

  return (
    <tr className="border-t border-border transition-colors hover:bg-muted/50">
      <td className="px-4 py-2 whitespace-nowrap text-muted-foreground">
        <time dateTime={entry.createdAt}>
          {new Date(entry.createdAt).toLocaleString()}
        </time>
      </td>
      <td className="px-4 py-2">{entry.actorName}</td>
      <td className="px-4 py-2">
        {href ? (
          <Link
            to={href}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {entityText}
          </Link>
        ) : (
          <span className="text-muted-foreground">{entityText}</span>
        )}
      </td>
      <td className="px-4 py-2">{ACTIVITY_ACTION_LABEL[entry.action]}</td>
      <td className="px-4 py-2 text-muted-foreground">{changeText(entry)}</td>
    </tr>
  );
}

function ActivitySkeleton() {
  return (
    <div
      className={cn(TABLE_FRAME, "min-h-0 flex-1 p-4")}
      aria-busy="true"
      aria-label="Loading activity"
    >
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}
