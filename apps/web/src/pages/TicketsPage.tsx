import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Rows3 } from "lucide-react";
import type { OnChangeFn, SortingState } from "@tanstack/react-table";
import {
  DEFAULT_TICKET_SORT,
  SORT_ORDER,
  TICKET_SORT_FIELD,
  type SortOrder,
  type TicketSortField,
  type TicketsListResponse,
} from "@ticket/shared";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import {
  LIST_PARAM,
  parseTicketListParams,
  writeTicketListParams,
  type TicketListPatch,
} from "@/lib/ticket-list-params";
import { ticketKeys } from "@/lib/ticket-queries";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { ROW_DENSITY, useRowDensity, type RowDensity } from "@/lib/use-row-density";
import { cn } from "@/lib/utils";
import { Toggle } from "@/components/ui/toggle";
import {
  hasActiveFilters,
  TicketsFilters,
  type TicketFilterState,
} from "./TicketsFilters";
import { TicketsPagination } from "./TicketsPagination";
import { TicketsTable, TicketsTableSkeleton } from "./TicketsTable";

/** Keystrokes settle for this long before the search hits the API. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * One pressed-state control rather than a Comfortable/Compact pair.
 *
 * Two exclusive options would be honest but wasteful: comfortable is simply the
 * table as everyone already knows it, so there is nothing to name, and a
 * segmented control announcing both states earns a second target for a setting
 * most people will touch once. Radix's Toggle carries `aria-pressed`, so the one
 * button says what it is and whether it is on.
 *
 * Labelled, not icon-only. An icon here would be legible to whoever guessed it
 * and to nobody else — the only label would be a Tooltip, and this app holds
 * those for 2s by design (see `AppShell`), which is an eternity for a control
 * you are hunting for.
 */
function DensityToggle({
  density,
  onChange,
}: {
  density: RowDensity;
  onChange: (next: RowDensity) => void;
}) {
  return (
    <Toggle
      variant="outline"
      size="sm"
      pressed={density === ROW_DENSITY.compact}
      onPressedChange={(pressed) =>
        onChange(pressed ? ROW_DENSITY.compact : ROW_DENSITY.comfortable)
      }
    >
      <Rows3 aria-hidden="true" />
      Compact rows
    </Toggle>
  );
}

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
  assignedTo?: string;
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
  if (filters.assignedTo) params.assignedTo = filters.assignedTo;
  const search = filters.search.trim();
  if (search) params.q = search;
  return params;
}

function useTicketsQuery(params: TicketsQueryParams) {
  return useQuery({
    queryKey: ticketKeys.list(params),
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

  // The `q` this component last agreed with, so the effect below can tell which
  // side moved. Without it the two directions are indistinguishable, and the
  // input wins a fight it should lose — see the effect.
  const settledSearch = useRef(urlSearch);

  // Input and URL, kept in step. One effect rather than two, because the whole
  // question is *which of them changed*, and that cannot be answered by two
  // effects that each see only their own dependency.
  useEffect(() => {
    // The URL moved on its own: Back/Forward, or a saved view in the sidebar.
    // Whatever is in the box belongs to the view being left, so it is adopted
    // and nothing is written back.
    //
    // This branch has to come first and has to exist. Without it the write
    // below fires on the same pass — its guards are satisfied, since a settled
    // input necessarily disagrees with a `q` that has just been cleared — and
    // puts the old search straight back into the URL. Clicking "Mine" with
    // `race` still in the box then landed on Mine *and* race: one row where the
    // sidebar badge said seven, with the filters showing no sign of why.
    if (settledSearch.current !== urlSearch) {
      settledSearch.current = urlSearch;
      setSearchInput(urlSearch);
      return;
    }

    if (debouncedSearch !== searchInput) return; // still settling
    if (debouncedSearch === urlSearch) return; // URL already agrees

    // The settled search lands in the URL. `replace`, because every pause in
    // typing would otherwise leave a history entry to click back through.
    settledSearch.current = debouncedSearch;
    update({ q: debouncedSearch || undefined }, true);
  }, [debouncedSearch, searchInput, urlSearch]);

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
    assignedTo: listState.assignedTo ?? "",
    search: searchInput,
  };

  const params = toQueryParams(
    sorting,
    { ...filters, search: debouncedSearch },
    listState.page,
    listState.pageSize,
  );

  const { data, isPending, isFetching, error } = useTicketsQuery(params);

  const [density, setDensity] = useRowDensity();

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
      next.status !== filters.status ||
      next.category !== filters.category ||
      next.assignedTo !== filters.assignedTo;

    // Emptying the search writes at once too, for the same reason: there is
    // nothing to settle. Debouncing a clear only bought a 300ms window in which
    // the input said "" and the URL still said `q=…`, and anything that re-derived
    // the input from the URL inside that window put the old text back — leaving
    // the list filtered by a term no longer on screen and the "Clear filters"
    // button apparently doing nothing. That is what the E2E test
    // "explains an empty result and lets the filter be cleared" caught
    // intermittently, and it made a clear feel laggy for everyone else.
    //
    // `replace` when only the search cleared, matching the debounced path: a
    // clear should not leave a history entry to click back through. A select
    // change still pushes, as it always did.
    const searchCleared = next.search === "" && filters.search !== "";

    if (selectsChanged || searchCleared) {
      update(
        {
          status: next.status || undefined,
          category: next.category || undefined,
          assignedTo: next.assignedTo || undefined,
          q: next.search.trim() || undefined,
        },
        !selectsChanged,
      );
    }
  };

  const filtered = hasActiveFilters(filters);

  return (
    // Opts out of scrolling as a page: only the table body moves, so the
    // filters stay put and the pagination bar is always reachable. `min-h-0` is
    // what lets this be shorter than its content — see the height chain in
    // AppShell, which this is the bottom of.
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
      {/* Filters left, display setting right — they are different kinds of
          thing. Everything on the left changes which tickets are in the table
          and travels in the URL; the toggle on the right changes how they are
          drawn for whoever is looking and does not. */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <TicketsFilters filters={filters} onChange={handleFiltersChange} />
        <DensityToggle density={density} onChange={setDensity} />
      </div>

      {isPending && (
        <TicketsTableSkeleton density={density} className="min-h-0 flex-1" />
      )}

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
            density={density}
            emptyMessage={
              filtered ? "No tickets match these filters." : "No tickets found."
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
    </div>
  );
}
