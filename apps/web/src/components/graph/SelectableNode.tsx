import type { KeyboardEvent, ReactNode } from "react";
import {
  GRAPH_EMPHASIS,
  GRAPH_EMPHASIS_ATTRIBUTE,
  GRAPH_NODE_ATTRIBUTE,
  type GraphEmphasis,
} from "@/lib/how-it-works/dom";
import type { Rect } from "@/lib/how-it-works/layout";
import { cn } from "@/lib/utils";

/** How far a dimmed part of a drawing fades back. */
export const DIMMED = "opacity-35";

/**
 * A box on a How it works drawing that can be selected: a button by role,
 * reached with Tab and pressed with Enter or Space as well as a click, and
 * outlined in the ring colour while it is the one selected. What it says is
 * its children, drawn over the box.
 */
export function SelectableNode({
  id,
  label,
  rect,
  selected,
  onSelect,
  emphasis,
  children,
}: {
  /** Written to `GRAPH_NODE_ATTRIBUTE`, for the E2E. */
  id: string;
  /** The accessible name. */
  label: string;
  rect: Rect;
  selected: boolean;
  onSelect: () => void;
  /** Written to `GRAPH_EMPHASIS_ATTRIBUTE`; a dimmed box fades back. */
  emphasis?: GraphEmphasis;
  children: ReactNode;
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      {...{
        [GRAPH_NODE_ATTRIBUTE]: id,
        [GRAPH_EMPHASIS_ATTRIBUTE]: emphasis,
      }}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={cn(
        "group cursor-pointer outline-none motion-safe:transition-opacity",
        emphasis === GRAPH_EMPHASIS.dimmed && DIMMED,
      )}
    >
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={8}
        className={cn(
          "fill-card stroke-border transition-colors group-hover:stroke-muted-foreground group-focus-visible:stroke-ring",
          selected && "stroke-ring group-hover:stroke-ring",
        )}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      {children}
    </g>
  );
}
