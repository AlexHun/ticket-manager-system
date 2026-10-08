import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";
import { select } from "d3-selection";
// Adds `.transition()` to a selection, which the glide to a step runs in.
import "d3-transition";
import {
  zoom,
  zoomTransform,
  type D3ZoomEvent,
  type ZoomBehavior,
} from "d3-zoom";
import {
  GRAPH_GLIDE_MS,
  GRAPH_VIEWPORT_ATTRIBUTE,
} from "@/lib/how-it-works/dom";
import { contains, type Rect } from "@/lib/how-it-works/layout";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * A pannable, zoomable SVG drawing — the canvas both How it works views share.
 *
 * React renders everything on it; d3 owns exactly one thing, the view
 * transform. `zoom()` is bound to the `<svg>` and writes `event.transform` to
 * the single `<g>` holding the drawing, so scrolling and dragging move the view
 * and never a box (R9). The attribute is written directly rather than through
 * state: a wheel gesture fires dozens of events, and none of them changes
 * anything React draws.
 *
 * `focus` is the one way React moves the view: when it changes to a box that
 * is not wholly in frame, the view glides to centre it at the current zoom, or
 * jumps there under reduced motion. Only the transform changes, so the box
 * stays where the layout put it.
 *
 * This module is reached only through the lazily loaded How it works page,
 * which is what keeps d3 out of the entry chunk.
 */

const SCALE_EXTENT: [number, number] = [0.5, 4];

export function GraphCanvas({
  width,
  height,
  label,
  focus = null,
  onKeyDown,
  className,
  children,
}: {
  /** The drawing's own size, in its coordinates; the SVG scales it to fit. */
  width: number;
  height: number;
  /** The drawing's accessible name. */
  label: string;
  /** A box, in the drawing's coordinates, the view should bring into frame. */
  focus?: Rect | null;
  /** Given, the canvas takes focus with Tab, and keys pressed on it or on a
   *  box inside it reach this. */
  onKeyDown?: KeyboardEventHandler<SVGSVGElement>;
  className?: string;
  children: ReactNode;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const behaviourRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(
    null,
  );
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behaviour = zoom<SVGSVGElement, unknown>()
      .scaleExtent(SCALE_EXTENT)
      // The double-click zoom animates too; it jumps under reduced motion.
      .duration(reducedMotion ? 0 : 250)
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        viewportRef.current?.setAttribute(
          "transform",
          event.transform.toString(),
        );
      });
    const selection = select(svg).call(behaviour);
    behaviourRef.current = behaviour;
    return () => {
      selection.on(".zoom", null);
      behaviourRef.current = null;
    };
  }, [reducedMotion]);

  // A layout effect, so the jump has landed by the time the press that asked
  // for it has been handled.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const behaviour = behaviourRef.current;
    if (!svg || !behaviour || !focus) return;
    const transform = zoomTransform(svg);
    // The part of the drawing in view: the viewBox, through the transform.
    const [left, top] = transform.invert([0, 0]);
    const [right, bottom] = transform.invert([width, height]);
    const frame = {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
    };
    if (contains(frame, focus)) return;

    const x = focus.x + focus.width / 2;
    const y = focus.y + focus.height / 2;
    const target = select(svg);
    if (reducedMotion) {
      target.interrupt().call(behaviour.translateTo, x, y);
    } else {
      target
        .transition()
        .duration(GRAPH_GLIDE_MS)
        .call(behaviour.translateTo, x, y);
    }
  }, [focus, width, height, reducedMotion]);

  return (
    <svg
      ref={svgRef}
      // A group, not an image: an image's children are presentational, and
      // the boxes on it are buttons.
      role="group"
      aria-label={label}
      tabIndex={onKeyDown ? 0 : undefined}
      onKeyDown={onKeyDown}
      viewBox={`0 0 ${width} ${height}`}
      className={cn(
        "block h-auto w-full cursor-grab touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:cursor-grabbing",
        className,
      )}
    >
      <g ref={viewportRef} {...{ [GRAPH_VIEWPORT_ATTRIBUTE]: "" }}>
        {children}
      </g>
    </svg>
  );
}
