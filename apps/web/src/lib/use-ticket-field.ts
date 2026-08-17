import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  TicketDetail,
  TicketWithAssignee,
  UpdateTicketResponse,
} from "@ticket/shared";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { ticketKeys } from "@/lib/ticket-queries";

/**
 * Change one field of a ticket.
 *
 * Each field is its own sub-resource — `/status`, `/category`, `/assignee` —
 * and all three answer with the whole ticket, so the cache write, the list
 * invalidation and the failure path are identical for every one of them. What
 * differs is the last segment of the URL, the body, and the words in the toast,
 * which is exactly what this takes.
 */
export function useTicketField<TValue>({
  ticketId,
  field,
  toBody,
  describe,
  errorMessage,
  onError,
}: {
  ticketId: number;
  field: string;
  /** The value, as the endpoint's body. Its one key is the field's own name. */
  toBody: (value: TValue) => Record<string, unknown>;
  /** The toast, written from the server's answer rather than from what was sent. */
  describe: (ticket: TicketWithAssignee) => string;
  /** Shown when the server didn't say why it refused. */
  errorMessage: string;
  onError?: () => void;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (value: TValue) => {
      const { data } = await api.patch<UpdateTicketResponse>(
        `/api/tickets/${ticketId}/${field}`,
        toBody(value),
      );
      return data.ticket;
    },
    onSuccess: (updated) => {
      // The response is the new truth for this ticket, so write it straight
      // into the cache — refetching would re-download the whole thread to learn
      // one field. The messages already on screen are carried across, and the
      // entry is found by the ticket's id rather than by the key the page
      // happened to build from the URL.
      queryClient.setQueriesData<TicketDetail>(
        { predicate: (query) => ticketKeys.isDetailKey(query.queryKey) },
        (prev) => (prev?.id === updated.id ? { ...prev, ...updated } : prev),
      );
      // Cached list pages are now out of date. `refetchType: "none"` marks them
      // without fetching a list nobody is looking at; it reloads when the user
      // goes back to it.
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.all,
        refetchType: "none",
      });
      // The sidebar's counts are the exception, and they need the refetch the
      // sweep above withholds. Status, category and assignee are precisely the
      // three fields the saved views are cut by, so every mutation here moves at
      // least one of those numbers — and unlike a cached list page, the sidebar
      // is on screen while it happens. Marked-stale-but-not-refetched would mean
      // taking a ticket and watching "Unassigned" keep its old number until you
      // alt-tabbed. It is one small request against a page the user is looking at.
      void queryClient.invalidateQueries({ queryKey: ticketKeys.views });
      // The trail is the other thing on screen that this mutation just changed:
      // the entry recording it was written in the same transaction as the update
      // whose response we are holding. Refetched rather than marked, for the
      // same reason as the counts above — the agent is looking at the thread
      // they just added a line to.
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.activity(updated.id),
      });
      toast.success(describe(updated));
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, errorMessage));
      onError?.();
    },
  });
}
