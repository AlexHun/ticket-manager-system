import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
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
import { TicketsTable, TicketsTableSkeleton } from "./TicketsTable";

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

function useTicketsQuery(sort: TicketSortField, order: SortOrder) {
  return useQuery({
    queryKey: ["tickets", sort, order],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketsListResponse>("/api/tickets", {
        params: { sort, order },
        signal,
      });
      return data.tickets;
    },
    // Sorting swaps the whole result set. Hold the current rows on screen
    // while the re-sorted ones load instead of dropping back to the skeleton.
    placeholderData: keepPreviousData,
  });
}

export function TicketsPage() {
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const { sort, order } = toSortParams(sorting);
  const {
    data: tickets,
    isPending,
    isFetching,
    error,
  } = useTicketsQuery(sort, order);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Tickets</h1>
        </div>

        {isPending && <TicketsTableSkeleton />}

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {extractErrorMessage(error, "Failed to load tickets")}
          </p>
        )}

        {tickets && (
          <div
            aria-busy={isFetching}
            className={
              isFetching ? "opacity-60 transition-opacity" : "transition-opacity"
            }
          >
            <TicketsTable
              tickets={tickets}
              sorting={sorting}
              onSortingChange={setSorting}
            />
          </div>
        )}
      </main>
    </div>
  );
}
