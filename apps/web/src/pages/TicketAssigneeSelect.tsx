import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import type {
  TicketAssignee,
  TicketAssigneesResponse,
  TicketDetail,
  TicketWithAssignee,
  UpdateTicketResponse,
} from "@ticket/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { ticketAssigneesKey, ticketKeys } from "@/lib/ticket-queries";

/** The trigger's id, so the detail page's `<dt>` can label it. */
export const ASSIGNEE_SELECT_ID = "ticket-assignee";

/**
 * Radix reserves the empty string for "cleared" and rejects it as an item
 * value, so "nobody" needs its own token. It never leaves this module — the
 * API still gets a real `null`.
 */
const UNASSIGNED = "unassigned";

const UNASSIGNED_LABEL = "Unassigned";

/** How long the roster is trusted without a refetch. Users are created rarely. */
const ROSTER_STALE_MS = 5 * 60_000;

function useAssigneesQuery() {
  return useQuery({
    queryKey: ticketAssigneesKey,
    queryFn: async ({ signal }) => {
      const { data } = await api.get<TicketAssigneesResponse>(
        "/api/tickets/assignees",
        { signal },
      );
      return data.assignees;
    },
    staleTime: ROSTER_STALE_MS,
  });
}

export function TicketAssigneeSelect({ ticket }: { ticket: TicketWithAssignee }) {
  const queryClient = useQueryClient();
  const {
    data: assignees,
    isPending: rosterLoading,
    error: rosterError,
  } = useAssigneesQuery();

  const mutation = useMutation({
    mutationFn: async (assignedToId: string | null) => {
      const { data } = await api.patch<UpdateTicketResponse>(
        `/api/tickets/${ticket.id}/assignee`,
        { assignedToId },
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
      toast.success(
        updated.assignedTo
          ? `Assigned to ${updated.assignedTo.name}`
          : "Ticket unassigned",
      );
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, "Failed to update the assignee"));
      // The likeliest cause is a roster that has moved on — a user removed
      // since this page was drawn. Refetch it so the choice that just failed
      // stops being offered.
      void queryClient.invalidateQueries({ queryKey: ticketAssigneesKey });
    },
  });

  /**
   * While the request is in flight the trigger shows what was picked, not what
   * the server last confirmed — otherwise the control snaps back to the old
   * name for the length of a round trip and reads as if the click was ignored.
   */
  const selectedId = mutation.isPending
    ? (mutation.variables ?? null)
    : ticket.assignedToId;

  const options = useMemo(() => {
    const roster = assignees ?? [];
    const current = ticket.assignedTo;
    // The current assignee is listed even when they are no longer assignable —
    // deleted since, or the roster hasn't arrived yet. Dropping them would
    // leave the field looking empty on a ticket that is plainly assigned.
    if (current && !roster.some((a) => a.id === current.id)) {
      return [current, ...roster];
    }
    return roster;
  }, [assignees, ticket.assignedTo]);

  const selected = options.find((a) => a.id === selectedId) ?? null;

  const handleChange = (value: string) => {
    const next = value === UNASSIGNED ? null : value;
    if (next === ticket.assignedToId) return; // picking the current value again
    mutation.mutate(next);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Select
          value={selectedId ?? UNASSIGNED}
          onValueChange={handleChange}
          disabled={mutation.isPending || rosterLoading || Boolean(rosterError)}
        >
          <SelectTrigger id={ASSIGNEE_SELECT_ID} className="w-56">
            {/* Children rather than the default: the selected name has to render
                before the roster arrives, and the ticket already carries it. */}
            <SelectValue>{selected?.name ?? UNASSIGNED_LABEL}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED}>{UNASSIGNED_LABEL}</SelectItem>
            {options.map((assignee) => (
              <SelectItem key={assignee.id} value={assignee.id}>
                {assignee.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* The control greys out while saving, which says nothing on its own to
            a screen reader — the live region is what announces the wait. */}
        {mutation.isPending && (
          <span role="status" className="text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
            <span className="sr-only">Saving assignee</span>
          </span>
        )}
      </div>

      <AssigneeStatus
        selected={selected}
        rosterError={rosterError}
        mutationError={mutation.error}
      />
    </div>
  );
}

/**
 * The line under the control: the assignee's email, or whichever failure got in
 * the way. One element, because they are alternatives — showing an email beside
 * "couldn't load users" would suggest the field is fine.
 */
function AssigneeStatus({
  selected,
  rosterError,
  mutationError,
}: {
  selected: TicketAssignee | null;
  rosterError: unknown;
  mutationError: unknown;
}) {
  if (mutationError) {
    return (
      <p className="text-xs text-destructive" role="alert">
        {extractErrorMessage(mutationError, "Failed to update the assignee")}
      </p>
    );
  }

  if (rosterError) {
    return (
      <p className="text-xs text-destructive" role="alert">
        Couldn't load the list of users.
      </p>
    );
  }

  if (selected) {
    return <span className="text-xs text-muted-foreground">{selected.email}</span>;
  }

  return null;
}
