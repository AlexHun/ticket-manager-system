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
  [TICKET_STATUS.New]: {
    variant: "outline",
    className:
      "border-transparent bg-sky-500/15 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200",
  },
  [TICKET_STATUS.Processing]: {
    variant: "outline",
    // Same foreground/70-on-muted pairing as Closed, for the same contrast
    // reason noted there.
    className: "border-transparent bg-muted text-foreground/70",
  },
  [TICKET_STATUS.Open]: { variant: "default" },
  [TICKET_STATUS.Resolved]: {
    variant: "outline",
    className:
      "border-transparent bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  },
  [TICKET_STATUS.Closed]: {
    variant: "outline",
    // foreground/70 rather than muted-foreground: the theme's own
    // muted-foreground-on-muted pairing measures 4.1:1, under AA for text-xs.
    className: "border-transparent bg-muted text-foreground/70",
  },
};

/**
 * Categories are peers rather than a ranking, so each gets its own hue at a
 * matched lightness. The theme's chart ramp is monochrome emerald — fine for
 * a chart, useless for telling four labels apart — hence explicit hues, with
 * `dark:` text so each stays legible on both themes.
 */
const CATEGORY_BADGE: Record<TicketCategory, string> = {
  [TICKET_CATEGORY.General]:
    "border-transparent bg-sky-500/12 text-sky-700 dark:text-sky-300",
  [TICKET_CATEGORY.Technical]:
    "border-transparent bg-violet-500/12 text-violet-700 dark:text-violet-300",
  // amber-700 measures 4.5:1 on the light tint — one step darker to clear AA.
  [TICKET_CATEGORY.Refund]:
    "border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300",
  [TICKET_CATEGORY.Other]:
    "border-transparent bg-rose-500/12 text-rose-700 dark:text-rose-300",
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
      {category}
    </Badge>
  );
}
