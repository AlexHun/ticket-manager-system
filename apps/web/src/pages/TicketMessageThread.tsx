import {
  MESSAGE_DIRECTION,
  type MessageDirection,
  type ThreadMessage,
} from "@ticket/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Who sent it, in the reader's terms. The raw enum values ("inbound") describe
 * the mail flow, not what an agent scanning the thread needs to know.
 */
const DIRECTION_LABEL: Record<MessageDirection, string> = {
  [MESSAGE_DIRECTION.inbound]: "From customer",
  [MESSAGE_DIRECTION.outbound]: "From support",
};

export function TicketMessageThread({
  messages,
}: {
  messages: ThreadMessage[];
}) {
  // Reachable: a ticket created outside the inbound-email webhook has no
  // messages at all, which includes every seeded row.
  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No messages on this ticket yet.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-4">
      {messages.map((message) => (
        <li
          key={message.id}
          className={cn(
            "rounded-xl px-4 py-3 ring-1 ring-border",
            // Tint rather than colour alone: the direction badge below carries
            // the same information in text.
            message.direction === MESSAGE_DIRECTION.outbound
              ? "bg-muted/40"
              : "bg-card",
          )}
        >
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-medium">{message.senderName}</span>
            <span className="text-xs text-muted-foreground">
              {message.senderEmail}
            </span>
            <Badge variant="outline" className="ml-auto">
              {DIRECTION_LABEL[message.direction]}
            </Badge>
            <time
              dateTime={message.createdAt}
              className="w-full text-xs text-muted-foreground sm:w-auto"
            >
              {new Date(message.createdAt).toLocaleString()}
            </time>
          </div>

          {message.textBody ? (
            // pre-wrap keeps the line breaks and quoting email depends on;
            // break-words stops a long URL from widening the column.
            // React escapes this, so an HTML-looking body renders as text.
            <p className="whitespace-pre-wrap break-words">
              {message.textBody}
            </p>
          ) : (
            // HTML-only senders land here. The raw htmlBody is deliberately not
            // available to render, and stripping tags by hand to fake a
            // plain-text part is exactly how that hole gets reopened.
            <p className="text-sm text-muted-foreground italic">
              This message has no plain-text content.
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
