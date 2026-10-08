import { GRAPH_EMPHASIS, type GraphEmphasis } from "@/lib/how-it-works/dom";
import { cn } from "@/lib/utils";

/**
 * Where a part of a drawing stands while something on it is current:
 * emphasised if `isCurrent`, dimmed if not. Neither while nothing is current.
 */
export function emphasisOf(
  anyCurrent: boolean,
  isCurrent: boolean,
): GraphEmphasis | undefined {
  if (!anyCurrent) return undefined;
  return isCurrent ? GRAPH_EMPHASIS.current : GRAPH_EMPHASIS.dimmed;
}

/** The classes a part of a drawing wears for its emphasis: a dimmed one fades
 *  back, and the fade is animated only where motion is allowed. */
export function emphasisClass(emphasis: GraphEmphasis | undefined): string {
  return cn(
    "motion-safe:transition-opacity",
    emphasis === GRAPH_EMPHASIS.dimmed && "opacity-35",
  );
}
