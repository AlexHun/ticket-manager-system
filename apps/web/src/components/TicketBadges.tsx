import {
  TICKET_CATEGORY,
  TICKET_STATUS,
  type TicketCategory,
  type TicketStatus,
} from "@ticket/shared";
import { Badge } from "@/components/ui/badge";

/**
 * Status is a progression, so it reads as emphasis: New and Open are solid and
 * loud, Resolved is a soft accent tint, Closed recedes to neutral. Scanning a
 * page of tickets, the ones still needing work are the ones that stand out.
 *
 * New is the *only* one that takes a hue of its own rather than a tint, because
 * it is the one an agent is looking for: an untriaged ticket is the queue's
 * actual work, and it has to win against a screen of Open ones. Open keeps the
 * solid `default` it always had.
 *
 * Processing is drawn even though the tickets list never shows one — the list
 * filters that status out, deliberately, so an agent cannot answer a ticket a
 * worker is already answering. It is still reachable on a detail page opened by
 * deep link while the model is composing, and a blank badge there would be worse
 * than a quiet one. Muted, because it is not anybody's work to pick up.
 */
const STATUS_BADGE: Record<
  TicketStatus,
  { variant: "default" | "outline"; className?: string }
> = {
  // Ember: somebody is waiting. New is the hotter of the two because an
  // untriaged ticket is the queue's actual work and has to win against a screen
  // of open ones.
  [TICKET_STATUS.New]: {
    variant: "outline",
    className: "border-transparent bg-ember-1/15 text-ember-1",
  },
  [TICKET_STATUS.Open]: {
    variant: "outline",
    className: "border-transparent bg-ember-2/15 text-ember-2",
  },
  // Neutral: a worker holds it for a few seconds and nobody can act on it.
  // Deliberately neither family — a green Processing would read as settled.
  [TICKET_STATUS.Processing]: {
    variant: "outline",
    className: "border-transparent bg-muted text-foreground/70",
  },
  // Calm: settled. Resolved keeps presence, Closed recedes.
  [TICKET_STATUS.Resolved]: {
    variant: "outline",
    className: "border-transparent bg-calm/12 text-calm",
  },
  [TICKET_STATUS.Closed]: {
    variant: "outline",
    // foreground/70 rather than muted-foreground: the theme's own
    // muted-foreground-on-muted pairing measures 4.1:1, under AA for text-xs.
    className: "border-transparent bg-muted text-foreground/70",
  },
};

/**
 * Category is a nominal facet and must never outshout state.
 *
 * This used to be four saturated hues from Tailwind's own palette — a second
 * colour system, disconnected from the theme tokens, which rendered "Other" in
 * alarm-red. Nothing is wrong with an "Other" ticket. On a queue where hue now
 * means *is anybody waiting*, a red badge on a filed-and-answered ticket is not
 * merely noisy, it is a false statement.
 *
 * So categories are neutral, and the mark tells them apart rather than the
 * colour. That is the honest encoding: which of four boxes a ticket was filed
 * in ranks nothing and is nobody's alarm, and an agent who wants only Refunds
 * has a filter for exactly that.
 *
 * Refund is the single exception, and it is not decoration: a refund is the one
 * category the auto-reply may never answer and the one an agent should know
 * they are looking at before they read a word of the thread. It gets weight —
 * the same neutral hue, one step brighter with a visible edge — rather than a
 * hue of its own.
 */
const CATEGORY_MARK: Record<TicketCategory, string> = {
  [TICKET_CATEGORY.General]: "◦",
  [TICKET_CATEGORY.Technical]: "◆",
  [TICKET_CATEGORY.Refund]: "◈",
  [TICKET_CATEGORY.Other]: "·",
};

const CATEGORY_BADGE: Record<TicketCategory, string> = {
  [TICKET_CATEGORY.General]:
    "border-transparent bg-muted text-muted-foreground",
  [TICKET_CATEGORY.Technical]:
    "border-transparent bg-muted text-muted-foreground",
  [TICKET_CATEGORY.Refund]: "border-border bg-muted text-foreground",
  [TICKET_CATEGORY.Other]: "border-transparent bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  const { variant, className } = STATUS_BADGE[status];
  return (
    <Badge variant={variant} className={className}>
      {status}
    </Badge>
  );
}

export function CategoryBadge({ category }: { category: TicketCategory }) {
  return (
    <Badge variant="outline" className={CATEGORY_BADGE[category]}>
      {/* Decorative: the label beside it is the accessible name, and a screen
          reader announcing "black diamond Technical" would be worse than
          silence. The mark is for scanning a column of four, not for reading. */}
      <span aria-hidden="true" className="opacity-70">
        {CATEGORY_MARK[category]}
      </span>
      {category}
    </Badge>
  );
}
