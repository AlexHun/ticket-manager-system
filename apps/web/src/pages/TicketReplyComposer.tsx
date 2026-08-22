import { useState } from "react";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCheck, Loader2, Send, Sparkles, Undo2 } from "lucide-react";
import {
  createTicketMessageSchema,
  type CreateTicketMessageValues,
  type PolishReplyValues,
} from "@ticket/core";
import {
  MAX_MESSAGE_BODY_LENGTH,
  TICKET_STATUS,
  type CreateTicketMessageResponse,
  type PolishReplyResponse,
  type ThreadMessage,
  type TicketDetail,
  type TicketStatus,
} from "@ticket/shared";
import { AiShine } from "@/components/AiShine";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { extractErrorMessage } from "@/lib/errors";
import { ticketKeys } from "@/lib/ticket-queries";
import { useTicketField } from "@/lib/use-ticket-field";

/** The textarea's id, so the label above it points somewhere. */
const REPLY_FIELD_ID = "ticket-reply";

const EMPTY_REPLY: CreateTicketMessageValues = { textBody: "" };

const SEND_FAILED = "Failed to send the reply";

const POLISH_FAILED = "Failed to polish the draft";

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
 * Takes only the ticket's id, and still only that now Polish is context-aware:
 * the cache update finds its entry by the id on the message that comes back,
 * and the polish endpoint looks the thread up server-side. The ticket object
 * itself is never needed here.
 */
export function TicketReplyComposer({ ticketId }: { ticketId: number }) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateTicketMessageValues>({
    resolver: zodResolver(createTicketMessageSchema),
    defaultValues: EMPTY_REPLY,
  });

  /**
   * The draft as it stood before the last polish, or null when there is nothing
   * to go back to.
   *
   * Local state rather than a form field: it is not part of the reply, it never
   * travels to the server, and it has to survive the `setValue` that overwrote
   * the box — which is exactly what a second field would not do.
   */
  const [prePolish, setPrePolish] = useState<string | null>(null);

  /**
   * The polished draft the box currently reflects, or null when it does not.
   *
   * Set alongside `prePolish`, one polish later, and cleared on the same two
   * edges — Undo and a successful send — for the same reason: once either
   * fires, whatever is in the box is no longer traceable to a particular
   * Polish call. What survives an ordinary edit is deliberate: the agent may
   * rewrite the polished text before sending, and that gap between what Polish
   * proposed and what actually went out is the thing `polishedDraft` on the
   * wire exists to capture, not to hide.
   */
  const [polishedDraft, setPolishedDraft] = useState<string | null>(null);

  /**
   * Whether the send now in flight should resolve the ticket after it lands.
   *
   * Read in the send's `onSuccess`, so it has to be set before `mutate` and
   * survive the round trip. State rather than a mutation variable because the
   * form owns the payload shape — `CreateTicketMessageValues` is the request
   * body, and smuggling a UI intent into it would put a field on the wire that
   * the endpoint does not have.
   */
  const [resolveOnSend, setResolveOnSend] = useState(false);

  /**
   * The status change behind "Send & resolve".
   *
   * Replying deliberately has no status side-effect on the server (see the
   * route), and that stays true — this is a second, explicit call the agent
   * asked for by choosing that button. Its error text carries the partial
   * success, because by the time it can fail the reply is already in the thread
   * and "failed to update the status" alone would read as though nothing
   * happened.
   */
  const resolve = useTicketField<TicketStatus>({
    ticketId,
    field: "status",
    toBody: (status) => ({ status }),
    describe: () => "Reply sent · ticket resolved",
    errorMessage: "Reply sent, but the ticket could not be resolved",
  });

  // The textarea is uncontrolled, so nothing re-renders as it is typed into —
  // and Polish has to know whether there is anything to polish. `watch` buys
  // that for a re-render per keystroke, which on a form of one textarea and
  // three buttons is cheaper than the alternatives: mirroring the value into
  // state, or an always-enabled button that answers a click with a 400.
  const draft = watch("textBody") ?? "";
  const trimmedDraft = draft.trim();
  const draftTooLong = trimmedDraft.length > MAX_MESSAGE_BODY_LENGTH;
  const canPolish = trimmedDraft.length > 0 && !draftTooLong;
  // Send is held only on an empty box — the one rejection the agent can see
  // coming. A too-long draft keeps the button live on purpose: the schema's
  // message is what explains it, and a silently greyed-out button would not.
  const canSend = trimmedDraft.length > 0;

  // Declared above the send mutation only so that one can call `polish.reset()`
  // in its success path without a forward reference.
  const polish = useMutation({
    mutationFn: async (value: string) => {
      // Typed as the schema's own inferred shape, so a field the server starts
      // requiring fails to compile here rather than at runtime. The ticket id
      // is all the context that travels: the server reads the customer's
      // message out of the thread itself, which is why the composer does not
      // have to hold one.
      const payload: PolishReplyValues = { draft: value, ticketId };
      const { data } = await api.post<PolishReplyResponse>(
        "/api/ai/polish-reply",
        payload,
      );
      return data.polished;
    },
    // `sent` is react-query's record of what this call was given, which is
    // exactly what Undo has to restore — so there is nothing to stash before the
    // request and no way to stash the wrong thing.
    onSuccess: (polished, sent) => {
      setPrePolish(sent);
      setPolishedDraft(polished);
      // Writes through to the registered <textarea>; an uncontrolled box shows
      // nothing new otherwise. `shouldValidate` clears a stale "Write a reply
      // before sending" left behind by an earlier empty submit.
      setValue("textBody", polished, {
        shouldDirty: true,
        shouldValidate: true,
      });
      toast.success("Draft polished");
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, POLISH_FAILED));
    },
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
      // The draft Undo would restore has just been sent. Offering to put it back
      // into a box that was cleared on purpose is a trap.
      setPrePolish(null);
      setPolishedDraft(null);
      polish.reset();

      // One click, one toast. When the agent asked for both, the resolve's own
      // message covers the pair — two toasts for one button is noise, and the
      // second would arrive a round trip after the first and read as a separate
      // event.
      if (resolveOnSend) {
        setResolveOnSend(false);
        resolve.mutate(TICKET_STATUS.Resolved);
        return;
      }

      toast.success("Reply added to the thread");
    },
    onError: (err) => {
      // The intent belonged to the attempt that just failed. Left set, the next
      // plain "Send reply" would silently resolve the ticket too.
      setResolveOnSend(false);
      toast.error(extractErrorMessage(err, SEND_FAILED));
    },
  });

  const runPolish = () => {
    if (!canPolish || polish.isPending || mutation.isPending) return;
    // The alert below shows one message and it should describe the action just
    // taken, so a stale send failure steps aside for this one's outcome.
    mutation.reset();
    polish.mutate(getValues("textBody").trim());
  };

  const undoPolish = () => {
    if (prePolish === null) return;
    setValue("textBody", prePolish, { shouldDirty: true, shouldValidate: true });
    setPrePolish(null);
    setPolishedDraft(null);
    polish.reset();
  };

  const submit = handleSubmit((values) => {
    polish.reset();
    // `polishedDraft` is local UI state, not a form field — same reasoning as
    // `resolveOnSend` below. Undefined when Polish was never run or was undone,
    // so a plain send drops the key rather than sending an empty string.
    mutation.mutate({ ...values, polishedDraft: polishedDraft ?? undefined });
  });

  const busy =
    mutation.isPending || polish.isPending || resolve.isPending;

  /**
   * "Send & resolve", as one gesture.
   *
   * Sets the intent and then submits the same form, so validation, the payload
   * and the failure path are the ones "Send reply" already uses — there is no
   * second send path to keep in step. ⌘/Ctrl+Enter deliberately stays a plain
   * send: a keyboard shortcut that also closed the ticket would be the kind of
   * thing you only discover by having done it.
   */
  const sendAndResolve = () => {
    if (busy || !canSend) return;
    setResolveOnSend(true);
    void submit();
  };

  /**
   * One alert, one message, newest cause first.
   *
   * Not three nodes: RTL and Playwright both resolve `role="alert"` as a single
   * element, so a second one on screen at once is a strict-mode failure in the
   * specs that assert on a rejected reply. Read straight off the mutations
   * rather than mirrored into state — react-query clears an error the moment the
   * next attempt starts, which is exactly when a stale one should leave the
   * screen. The `reset()` calls above are what keep this precedence honest:
   * whichever action ran last is the one whose error can still be showing.
   */
  const alertMessage =
    errors.textBody?.message ??
    (mutation.error
      ? extractErrorMessage(mutation.error, SEND_FAILED)
      : undefined) ??
    (polish.error
      ? extractErrorMessage(polish.error, POLISH_FAILED)
      : undefined);

  const polishHint = polish.isPending
    ? "Rewriting your draft…"
    : draftTooLong
      ? `A draft is limited to ${MAX_MESSAGE_BODY_LENGTH} characters`
      : trimmedDraft.length === 0
        ? "Write a draft first"
        : "Rewrite this draft as a reply to the customer's message. You can undo it.";

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
        // Locked during a polish too: the box is about to be overwritten, and
        // keystrokes typed into it in the meantime would be thrown away.
        disabled={busy}
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

      {alertMessage && (
        <p className="text-sm text-destructive" role="alert">
          {alertMessage}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">
          ⌘/Ctrl + Enter to send
        </span>

        {/* The controls travel together on the right; the row above keeps the
            hint pinned left. Undo only exists after a polish, so this is two
            buttons wide at rest. */}
        <div className="flex items-center gap-2">
          {prePolish !== null && (
            <Hint content="Put back the draft you had before polishing">
              {/* type="button" — the default inside a <form> is submit, which
                  here would send the reply. Same for Polish below. */}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={undoPolish}
                disabled={busy}
              >
                <Undo2 aria-hidden="true" className="size-4" />
                Undo polish
              </Button>
            </Hint>
          )}

          {/* The span is not decoration. `buttonVariants` sets
              `disabled:pointer-events-none`, so a disabled Button never fires
              the hover a Radix TooltipTrigger listens for — and "why is Polish
              greyed out?" is the one question this hint exists to answer.
              Wrapping it gives the trigger an element that stays interactive. */}
          <Hint content={polishHint}>
            <span className="inline-flex">
              {/* `relative` positions the shine ring, which traces this
                  button's own border while the rewrite is in flight — the same
                  cue the summary panel wears, so "a model is working on this"
                  looks the same wherever it happens. */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="relative"
                onClick={runPolish}
                disabled={busy || !canPolish}
              >
                <AiShine active={polish.isPending} />
                {polish.isPending ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Sparkles aria-hidden="true" className="size-4" />
                )}
                {polish.isPending ? "Polishing…" : "Polish"}
              </Button>
            </span>
          </Hint>

          {/* Two visible buttons rather than a split button with the second
              action behind a chevron. Answer-and-close is the commonest way a
              ticket ends, so it earns its own target — and hiding it would
              leave the multi-step version (send, then open the status select)
              as the discoverable one. */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={sendAndResolve}
            disabled={busy || !canSend}
          >
            {resolve.isPending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <CheckCheck aria-hidden="true" className="size-4" />
            )}
            Send &amp; resolve
          </Button>

          <Button type="submit" size="sm" disabled={busy || !canSend}>
            {mutation.isPending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Send aria-hidden="true" className="size-4" />
            )}
            {mutation.isPending ? "Sending…" : "Send reply"}
          </Button>
        </div>
      </div>
    </form>
  );
}
