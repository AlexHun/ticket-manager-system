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
      toast.success(describe(updated));
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, errorMessage));
      onError?.();
    },
  });
}
