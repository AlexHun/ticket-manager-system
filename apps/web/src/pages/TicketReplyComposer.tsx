import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Send } from "lucide-react";
import {
  createTicketMessageSchema,
  type CreateTicketMessageValues,
} from "@ticket/core";
import type {
  CreateTicketMessageResponse,
  ThreadMessage,
  TicketDetail,
} from "@ticket/shared";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { ticketKeys } from "@/lib/ticket-queries";

/** The textarea's id, so the label above it points somewhere. */
const REPLY_FIELD_ID = "ticket-reply";

const EMPTY_REPLY: CreateTicketMessageValues = { textBody: "" };

const SEND_FAILED = "Failed to send the reply";

/**
 * Put a new message into every cached copy of its ticket.
 *
 * Deliberately *not* the `{ ...prev, ...updated }` merge `useTicketField` uses.
 * Those endpoints answer with a whole ticket, so spreading it over the cached
 * one is the update; this one answers with a single message, and spreading that
 * would overwrite the ticket with a message-shaped object. The thread has to be
 * rebuilt with the new entry on the end instead.
 *
 * `lastMessageAt` moves with it because the server moved it in the same
 * transaction off the same instant — so `created.createdAt` is not an estimate,
 * it is the value in the column. Without this the sidebar's "Last message" sits
 * one reply behind until something refetches.
 *
 * The id guard covers a background refetch that already landed this message:
 * appending it twice would draw the bubble twice and hand React a duplicate key.
 */
function appendMessage(queryClient: QueryClient, created: ThreadMessage): void {
  queryClient.setQueriesData<TicketDetail>(
    { predicate: (query) => ticketKeys.isDetailKey(query.queryKey) },
    (prev) => {
      if (prev?.id !== created.ticketId) return prev;
      if (prev.messages.some((m) => m.id === created.id)) return prev;
      return {
        ...prev,
        lastMessageAt: created.createdAt,
        messages: [...prev.messages, created],
      };
    },
  );
}

/**
 * The reply box pinned under the thread.
 *
 * Nothing is emailed yet: the endpoint writes an outbound message carrying the
 * headers a real send would, and a transport drops in behind it later.
 *
 * Takes only the ticket's id — the cache update finds its entry by the id on
 * the message that comes back, so the ticket object itself is never needed.
 */
export function TicketReplyComposer({ ticketId }: { ticketId: number }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateTicketMessageValues>({
    resolver: zodResolver(createTicketMessageSchema),
    defaultValues: EMPTY_REPLY,
  });

  const mutation = useMutation({
    mutationFn: async (values: CreateTicketMessageValues) => {
      const { data } = await api.post<CreateTicketMessageResponse>(
        `/api/tickets/${ticketId}/messages`,
        values,
      );
      return data.message;
    },
    onSuccess: (created) => {
      appendMessage(queryClient, created);
      // Cached list pages and the dashboard are now out of date — a reply moves
      // the ticket's last-message time and answers a thread the stats count as
      // waiting. `refetchType: "none"` marks them without fetching a screen
      // nobody is looking at, the same as the field mutations do.
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.all,
        refetchType: "none",
      });
      // Cleared only on success: a rejected reply keeps what was typed, because
      // the draft is the only copy of it.
      reset(EMPTY_REPLY);
      toast.success("Reply added to the thread");
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, SEND_FAILED));
    },
  });

  const submit = handleSubmit((values) => {
    mutation.mutate(values);
  });

  return (
    // shrink-0 so the composer keeps its height and the thread above it gives up
    // the rest. The rule is what separates it from the last bubble once the
    // thread is scrolled to the bottom.
    <form
      onSubmit={submit}
      noValidate
      className="mt-4 flex shrink-0 flex-col gap-2 border-t border-border pt-4"
    >
      {/* The pane's own heading already says what this column is, and a visible
          "Reply" above a box reading "Write a reply…" is the same word twice.
          The label still exists for assistive tech. */}
      <Label htmlFor={REPLY_FIELD_ID} className="sr-only">
        Reply
      </Label>
      <Textarea
        id={REPLY_FIELD_ID}
        rows={3}
        placeholder="Write a reply…"
        aria-invalid={Boolean(errors.textBody)}
        disabled={mutation.isPending}
        // Enter inserts a newline: this is an email reply, not a chat line, and
        // paragraphs are the normal case. ⌘/Ctrl+Enter sends, which is the
        // gesture every mail client has trained people on.
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        // The component sizes itself to its content; this bounds that at both
        // ends so an empty box still looks like somewhere to type and a long
        // draft stops before it eats the thread. No `maxLength` — the browser
        // would silently truncate a long paste, where the schema says what
        // happened.
        className="max-h-48 min-h-20 resize-y"
        {...register("textBody")}
      />

      {errors.textBody && (
        <p className="text-sm text-destructive" role="alert">
          {errors.textBody.message}
        </p>
      )}

      {/* Read off the mutation rather than mirrored into state: react-query
          clears it the moment the next attempt starts, which is exactly when a
          stale "couldn't send" should stop being on screen. */}
      {mutation.error && (
        <p className="text-sm text-destructive" role="alert">
          {extractErrorMessage(mutation.error, SEND_FAILED)}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          ⌘/Ctrl + Enter to send
        </span>
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Send aria-hidden="true" className="size-4" />
          )}
          {mutation.isPending ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
