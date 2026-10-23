import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The chevron on every fold of the Sessions page (a card's subagents, a
 * chain's issues, How this page reads): pointing right while folded, down
 * while open, turned by `transform` alone (design-states.md).
 */
export function FoldChevron({
  open,
  inline = false,
}: {
  open: boolean;
  /** Before a label in a text button, where the button pads for it. */
  inline?: boolean;
}) {
  return (
    <ChevronRight
      aria-hidden="true"
      data-icon={inline ? "inline-start" : undefined}
      className={cn("transition-transform", open && "rotate-90")}
    />
  );
}
