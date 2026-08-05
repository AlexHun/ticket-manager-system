import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { OnChangeFn, SortingState } from "@tanstack/react-table";
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_TICKET_SORT,
  FIRST_PAGE,
  SORT_ORDER,
  TICKET_SORT_FIELD,
  type SortOrder,
  type TicketSortField,
  type TicketsListResponse,
} from "@ticket/shared";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  TicketsFilters,
  type TicketFilterState,
} from "./TicketsFilters";
import { TicketsPagination } from "./TicketsPagination";
import { TicketsTable, TicketsTableSkeleton } from "./TicketsTable";

/** Keystrokes settle for this long before the search hits the API. */
const SEARCH_DEBOUNCE_MS = 300;

const DEFAULT_SORTING: SortingState = [
  {
    id: DEFAULT_TICKET_SORT.field,
    desc: DEFAULT_TICKET_SORT.order === SORT_ORDER.desc,
  },
];

function isTicketSortField(value: string): value is TicketSortField {
  return value in TICKET_SORT_FIELD;
}

/**
 * TanStack types a column id as a plain `string`, so narrow rather than cast.
 * Anything unrecognised falls back to the default, which keeps this correct if
 * the sort ever arrives from somewhere untrusted (a URL, restored state).
 */
function toSortParams(sorting: SortingState): {
  sort: TicketSortField;
  order: SortOrder;
} {
  const active = sorting[0];
  if (!active || !isTicketSortField(active.id)) {
    return { sort: DEFAULT_TICKET_SORT.field, order: DEFAULT_TICKET_SORT.order };
  }
  return {
    sort: active.id,
    order: active.desc ? SORT_ORDER.desc : SORT_ORDER.asc,
  };
}

interface TicketsQueryParams {
  sort: TicketSortField;
  order: SortOrder;
  page: number;
  pageSize: number;
  status?: string;
  category?: string;
  q?: string;
}

/** Empty filters are dropped rather than sent as blanks the API must ignore. */
function toQueryParams(
  sorting: SortingState,
  filters: TicketFilterState,
  page: number,
  pageSize: number,
): TicketsQueryParams {
  const params: TicketsQueryParams = { ...toSortParams(sorting), page, pageSize };
  if (filters.status) params.status = filters.status;
  if (filters.category) params.category = filters.category;
  const search = filters.search.trim();
  if (search) params.q = search;
  return params;
}

function useTicketsQuery(params: TicketsQueryParams) {
  return useQuery({
    queryKey: ["tickets", params],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketsListResponse>("/api/tickets", {
        params,
        signal,
      });
      return data;
    },
    // Sorting, filtering and paging each swap the whole result set. Hold the
    // current rows on screen while the new ones load instead of flashing the
    // skeleton on every interaction.
    placeholderData: keepPreviousData,
  });
}

export function TicketsPage() {
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [filters, setFilters] = useState<TicketFilterState>(EMPTY_FILTERS);
  const [page, setPage] = useState(FIRST_PAGE);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  // Only the text input is debounced — the selects should react immediately.
  const debouncedSearch = useDebouncedValue(filters.search, SEARCH_DEBOUNCE_MS);
  const params = toQueryParams(
    sorting,
    { ...filters, search: debouncedSearch },
    page,
    pageSize,
  );

  const { data, isPending, isFetching, error } = useTicketsQuery(params);

  /**
   * Re-sorting or re-filtering rebuilds the result set, so page 3 of the old
   * set means nothing in the new one — and would often be past the end.
   * Both reset to the first page.
   */
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting((prev) =>
      typeof updater === "function" ? updater(prev) : updater,
    );
    setPage(FIRST_PAGE);
  };

  const handleFiltersChange = (next: TicketFilterState) => {
    setFilters(next);
    setPage(FIRST_PAGE);
  };

  const handlePageSizeChange = (next: number) => {
    setPageSize(next);
    setPage(FIRST_PAGE);
  };

  const filtered = hasActiveFilters(filters);

  return (
    // Owns the viewport: only the table body scrolls, so the filters stay put
    // and the pagination bar is always reachable without scrolling the window.
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <NavBar />
      <main className="flex min-h-0 flex-1 flex-col p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Tickets</h1>
        </div>

        <div className="mb-4">
          <TicketsFilters filters={filters} onChange={handleFiltersChange} />
        </div>

        {isPending && <TicketsTableSkeleton className="min-h-0 flex-1" />}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {extractErrorMessage(error, "Failed to load tickets")}
          </p>
        )}

        {data && (
          // min-h-0 is load-bearing: a flex item won't shrink below its content
          // without it, and the frame would overflow instead of scrolling.
          <div
            aria-busy={isFetching}
            className={cn(
              "flex min-h-0 flex-1 flex-col transition-opacity",
              isFetching && "opacity-60",
            )}
          >
            <TicketsTable
              className="min-h-0 flex-1"
              tickets={data.tickets}
              sorting={sorting}
              onSortingChange={handleSortingChange}
              emptyMessage={
                filtered
                  ? "No tickets match these filters."
                  : "No tickets found."
              }
            />
            {data.total > 0 && (
              <TicketsPagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                onPageChange={setPage}
                onPageSizeChange={handlePageSizeChange}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
