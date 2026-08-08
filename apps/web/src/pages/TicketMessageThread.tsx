import { useLayoutEffect, useRef } from "react";
import {
  MESSAGE_DIRECTION,
  type MessageDirection,
  type ThreadMessage,
} from "@ticket/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { initialsOf } from "@/lib/initials";
import { cn } from "@/lib/utils";

/**
 * Who sent it, in the reader's terms. The raw enum values ("inbound") describe
 * the mail flow, not what an agent scanning the thread needs to know.
 *
 * Sighted readers get this from the side the bubble sits on and the name above
 * it, so the text itself is only rendered for assistive tech — a badge on every
 * message would repeat what the layout already says.
 */
const DIRECTION_LABEL: Record<MessageDirection, string> = {
  [MESSAGE_DIRECTION.inbound]: "From customer",
  [MESSAGE_DIRECTION.outbound]: "From support",
};

/**
 * Built once: constructing a formatter per message is the expensive part.
 *
 * Both fields are 2-digit so every stamp is the same width — "numeric" hours
 * drop the leading zero, and a column of times that alternates between 14:02
 * and 2:02 reads like two different clocks.
 */
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const ONE_DAY = 24 * 60 * 60 * 1000;

/**
 * The heading a run of messages sits under. Support threads are read the day
 * they arrive far more often than months later, so the two most recent days are
 * named rather than dated.
 */
function dayLabel(date: Date): string {
  const daysAgo = Math.round((startOfDay(new Date()) - startOfDay(date)) / ONE_DAY);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return DAY_FORMAT.format(date);
}

export function TicketMessageThread({
  messages,
  className,
}: {
  messages: ThreadMessage[];
  /** Sizing from the pane that holds it — the scrolling itself lives here. */
  className?: string;
}) {
  const scrollRef = useRef<HTMLOListElement>(null);

  // A thread opens on its newest message, the way a chat does: the last reply
  // is what an agent came for, and the history is a scroll up.
  //
  // Keyed on the count and the ticket rather than on `messages` itself — a
  // background refetch rebuilds that array with identical contents, and
  // depending on its identity would yank a reader back down mid-thread. The
  // count catches a new reply; the ticket id catches moving between two
  // tickets that happen to have the same number of messages.
  //
  // Layout effect, so it lands before paint rather than as a visible jump.
  const count = messages.length;
  const ticketId = messages[0]?.ticketId;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, ticketId]);

  // Reachable: the inbound webhook always writes a message with its ticket, but
  // a row created any other way — by hand, or by a fixture — starts with none.
  if (count === 0) {
    return (
      // Takes the pane's sizing like the list below does, so the empty state
      // fills the column rather than collapsing to one line. Without it the
      // composer pinned underneath rides up under this sentence instead of
      // sitting at the bottom of the pane.
      <p className={cn("text-sm text-muted-foreground", className)}>
        No messages on this ticket yet.
      </p>
    );
  }

  return (
    // The list is the scroll container itself — a wrapper around it would add a
    // node for nothing. gap-1 is the *within*-run spacing; a message that opens
    // a run adds its own margin, so the eye groups a sender's messages before
    // it separates them. pe-2 keeps the bubbles off the scrollbar.
    // Named for the same reason the sidebar's <nav> is: it is not the only list
    // on the page. Sonner renders its toasts as an <ol> of <li>, so an unscoped
    // `ol > li` counts a visible toast as a message — which is exactly how the
    // reply E2E test came to expect four messages and find five. The name also
    // gives assistive tech something better than "list".
    <ol
      ref={scrollRef}
      aria-label="Message thread"
      className={cn("flex flex-col gap-1 overflow-y-auto pe-2", className)}
    >
      {messages.map((message, index) => {
        const previous = index > 0 ? messages[index - 1] : null;
        const outbound = message.direction === MESSAGE_DIRECTION.outbound;
        const sentAt = new Date(message.createdAt);

        const newDay =
          previous === null ||
          startOfDay(new Date(previous.createdAt)) !== startOfDay(sentAt);

        // Consecutive messages from one address are one run: repeating the
        // avatar and address under every line is what makes an email client
        // look like an email client rather than a conversation.
        const startsRun =
          newDay ||
          previous.senderEmail !== message.senderEmail ||
          previous.direction !== message.direction;

        return (
          <li
            key={message.id}
            className={cn("flex flex-col", startsRun && index > 0 && "mt-5")}
          >
            {newDay && <DayDivider label={dayLabel(sentAt)} first={index === 0} />}

            <div className={cn("flex gap-2", outbound && "flex-row-reverse")}>
              {startsRun ? (
                <Avatar>
                  <AvatarFallback
                    className={cn(
                      outbound && "bg-primary/10 text-primary dark:bg-primary/20",
                    )}
                  >
                    {initialsOf(message.senderName)}
                  </AvatarFallback>
                </Avatar>
              ) : (
                // Holds the column open so a continuation lines up with the
                // bubble above it instead of sliding under the avatar.
                <div className="size-8 shrink-0" aria-hidden="true" />
              )}

              <div
                className={cn(
                  // Two ceilings: 85% keeps a bubble from spanning a narrow
                  // pane edge to edge, and 42rem holds the line length
                  // readable once the pane is given a wide monitor to fill.
                  "flex min-w-0 max-w-[min(85%,42rem)] flex-col gap-1",
                  outbound ? "items-end" : "items-start",
                )}
              >
                {startsRun && (
                  <div
                    className={cn(
                      "flex flex-wrap items-baseline gap-x-2 px-1",
                      outbound && "flex-row-reverse",
                    )}
                  >
                    <span className="text-sm font-medium">
                      {message.senderName}
                    </span>
                    <span className="text-xs break-all text-muted-foreground">
                      {message.senderEmail}
                    </span>
                  </div>
                )}

                <div
                  className={cn(
                    // `relative` is load-bearing, not decoration: the sr-only
                    // label below is absolutely positioned, and without a
                    // positioned ancestor its containing block is the page
                    // itself. It then escapes this pane's clipping and stretches
                    // the document past the viewport — a full-height layout
                    // scrolls the window by a few hundred px for a span nobody
                    // can see.
                    "relative rounded-2xl px-3.5 py-2.5 text-sm",
                    outbound
                      ? "rounded-tr-sm bg-primary text-primary-foreground"
                      : "rounded-tl-sm bg-muted text-foreground ring-1 ring-border",
                  )}
                >
                  <span className="sr-only">
                    {DIRECTION_LABEL[message.direction]}
                  </span>

                  {message.textBody ? (
                    // pre-wrap keeps the line breaks and quoting email depends
                    // on; break-words stops a long URL from widening the
                    // column. React escapes this, so an HTML-looking body
                    // renders as text.
                    <p className="whitespace-pre-wrap break-words">
                      {message.textBody}
                    </p>
                  ) : (
                    // HTML-only senders land here. The raw htmlBody is
                    // deliberately not available to render, and stripping tags
                    // by hand to fake a plain-text part is exactly how that
                    // hole gets reopened.
                    <p
                      className={cn(
                        "italic",
                        outbound
                          ? "text-primary-foreground/75"
                          : "text-muted-foreground",
                      )}
                    >
                      This message has no plain-text content.
                    </p>
                  )}
                </div>

                <time
                  dateTime={message.createdAt}
                  className="px-1 text-xs text-muted-foreground"
                >
                  {TIME_FORMAT.format(sentAt)}
                </time>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Lives inside the first `<li>` of the day rather than beside it: the thread is
 * an ordered list of messages, and a date is not one of them.
 */
function DayDivider({ label, first }: { label: string; first: boolean }) {
  return (
    <div className={cn("mb-4 flex items-center gap-3", !first && "mt-2")}>
      <Separator className="flex-1" />
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Separator className="flex-1" />
    </div>
  );
}
