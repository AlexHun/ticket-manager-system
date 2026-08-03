import { useQuery } from "@tanstack/react-query";
import type { TicketsListResponse } from "@ticket/shared";
import { NavBar } from "@/components/NavBar";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { TicketsTable, TicketsTableSkeleton } from "./TicketsTable";

function useTicketsQuery() {
  return useQuery({
    queryKey: ["tickets"],
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketsListResponse>("/api/tickets", {
        signal,
      });
      return data.tickets;
    },
  });
}

export function TicketsPage() {
  const { data: tickets, isPending, error } = useTicketsQuery();

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

        {tickets && <TicketsTable tickets={tickets} />}
      </main>
    </div>
  );
}
