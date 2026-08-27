import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { TicketUnreadResponse } from "@ticket/shared";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { ticketKeys } from "@/lib/ticket-queries";

function useUnreadAssignments() {
  return useQuery({
    queryKey: ticketKeys.unread,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketUnreadResponse>(
        "/api/tickets/unread",
        { signal },
      );
      return data.tickets;
    },
  });
}

/**
 * Toasts a ticket the instant it becomes unread — assigned to the signed-in
 * agent and not yet opened (ADR-0013). Call once, inside `RealtimeProvider`:
 * `realtime-events.ts` refetches `ticketKeys.unread` on any `ticket_updated`
 * event naming the assignee field, and this reacts to the result landing.
 *
 * **The first successful read is a baseline, not news.** Everything in it was
 * already unread before this tab opened — that is `/tickets`'s job to show,
 * not a live notification's. Only a ticket that *joins* the set after that
 * earns a toast, which is why this compares against the previous set rather
 * than a "have I run yet" flag: StrictMode double-invokes effects on mount,
 * and a flag would already be true on the second call, but a `Set` holding
 * the same ids diffs to nothing on its own.
 *
 * **Events are hints, not data**, same rule as `EVENT_EFFECT`: the toast's
 * ticket ids and subjects come from this query's own authenticated read, never
 * from the event that triggered the refetch.
 */
export function useAssignmentToasts(): void {
  const navigate = useNavigate();
  const { data } = useUnreadAssignments();
  const previousRef = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (!data) return;

    const previous = previousRef.current;
    if (previous) {
      for (const ticket of data) {
        if (previous.has(ticket.id)) continue;
        toast.message(`Assigned to you: ${ticket.subject}`, {
          action: {
            label: "Open",
            onClick: () => navigate(`/tickets/${ticket.id}`),
          },
        });
      }
    }

    previousRef.current = new Set(data.map((t) => t.id));
  }, [data, navigate]);
}
