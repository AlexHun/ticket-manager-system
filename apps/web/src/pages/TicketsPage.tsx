import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { OnChangeFn, SortingState } from "@tanstack/react-table";
import {
  DEFAULT_TICKET_SORT,
  SORT_ORDER,
  TICKET_SORT_FIELD,
  type SortOrder,
  type TicketSortField,
  type TicketsListResponse,
} from "@ticket/shared";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import {
  LIST_PARAM,
  parseTicketListParams,
  writeTicketListParams,
  type TicketListPatch,
} from "@/lib/ticket-list-params";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import {
  hasActiveFilters,
  TicketsFilters,
  type TicketFilterState,
} from "./TicketsFilters";
import { TicketsPagination } from "./TicketsPagination";
import { TicketsTable, TicketsTableSkeleton } from "./TicketsTable";

/** Keystrokes settle for this long before the search hits the API. */
const SEARCH_DEBOUNCE_MS = 300;

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
  // The URL is the state: it makes a filtered view shareable, and it is what
  // browser Back restores when returning from a ticket.
  const [searchParams, setSearchParams] = useSearchParams();
  const listState = useMemo(
    () => parseTicketListParams(searchParams),
    [searchParams],
  );

  // The raw param, not the parsed one: the schema trims `q`, and an input whose
  // value came back trimmed would eat spaces as they were typed.
  const urlSearch = searchParams.get(LIST_PARAM.q) ?? "";
  const [searchInput, setSearchInput] = useState(urlSearch);

  // Only the text input is debounced — the selects should react immediately.
  const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

  const update = (patch: TicketListPatch, replace = false) => {
    setSearchParams((prev) => writeTicketListParams(prev, patch), { replace });
  };

  // The settled search lands in the URL. `replace`, because every pause in
  // typing would otherwise leave a history entry to click back through.
  useEffect(() => {
    if (debouncedSearch !== searchInput) return; // still settling
    if (debouncedSearch === urlSearch) return; // URL already agrees
    update({ q: debouncedSearch || undefined }, true);
  }, [debouncedSearch, searchInput, urlSearch]);

  // Adopt a search that changed from outside the input — Back/Forward, or a
  // shared link. The guard above is what stops the two from ping-ponging.
  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);

  const sorting = useMemo<SortingState>(
    () => [
      {
        id: listState.sort,
        desc: listState.order === SORT_ORDER.desc,
      },
    ],
    [listState.sort, listState.order],
  );

  const filters: TicketFilterState = {
    status: listState.status ?? "",
    category: listState.category ?? "",
    search: searchInput,
  };

  const params = toQueryParams(
    sorting,
    { ...filters, search: debouncedSearch },
    listState.page,
    listState.pageSize,
  );

  const { data, isPending, isFetching, error } = useTicketsQuery(params);

  // Every patch below drops `page` unless it names one — see
  // writeTicketListParams for why re-sorting and re-filtering go back to page 1.
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    update(toSortParams(next));
  };

  const handleFiltersChange = (next: TicketFilterState) => {
    setSearchInput(next.search);

    // Selects react immediately, and the pending search text rides along in the
    // same write — so the URL never disagrees with the controls, and one
    // interaction stays one request.
    const selectsChanged =
      next.status !== filters.status || next.category !== filters.category;
    if (selectsChanged) {
      update({
        status: next.status || undefined,
        category: next.category || undefined,
        q: next.search.trim() || undefined,
      });
    }
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
                onPageChange={(page) => update({ page })}
                onPageSizeChange={(pageSize) => update({ pageSize })}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
