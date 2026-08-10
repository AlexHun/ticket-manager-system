import type { ComponentProps, ReactElement, ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A shadcn Tooltip shaped like the `title` attribute it replaces.
 *
 * Native `title` is drawn by the OS, so it ignores every theme token, waits
 * about a second, and cannot be placed — the same objection that keeps native
 * `<select>` out of this app. This wraps the one composition all those call
 * sites wanted, so revealing a truncated string costs a wrapper instead of a
 * Tooltip/Trigger/Content trio each time.
 *
 * The trigger is `asChild` and neither Root nor Trigger emits a box of its own,
 * so the element handed in stays the element rendered — nothing new to disturb a
 * flex row, a table cell or a `truncate`. The cost is that the child must be a
 * single element that takes a ref and spreads props: a bare string or a fragment
 * will not do.
 *
 * Empty content renders the child untouched, so an optional hint needs no
 * conditional at the call site.
 *
 * Needs a `TooltipProvider` above it or Radix throws — `AppShell` and
 * `DevRoutes` each mount one, and so does `renderWithQuery` for tests.
 */
export function Hint({
  content,
  children,
  side,
  align,
  className,
}: {
  content: ReactNode;
  children: ReactElement;
  side?: ComponentProps<typeof TooltipContent>["side"];
  align?: ComponentProps<typeof TooltipContent>["align"];
  /** Classes for the tooltip surface, not the trigger. */
  className?: string;
}) {
  if (!content) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} align={align} className={className}>
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
