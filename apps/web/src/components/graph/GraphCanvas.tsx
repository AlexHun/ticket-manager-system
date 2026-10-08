import { useEffect, useRef, type ReactNode } from "react";
import { select } from "d3-selection";
import { zoom, type D3ZoomEvent } from "d3-zoom";
import { GRAPH_VIEWPORT_ATTRIBUTE } from "@/lib/how-it-works/dom";
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
 * This module is reached only through the lazily loaded How it works page,
 * which is what keeps d3 out of the entry chunk.
 */

const SCALE_EXTENT: [number, number] = [0.5, 4];

export function GraphCanvas({
  width,
  height,
  label,
  className,
  children,
}: {
  /** The drawing's own size, in its coordinates; the SVG scales it to fit. */
  width: number;
  height: number;
  /** The drawing's accessible name. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<SVGGElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behaviour = zoom<SVGSVGElement, unknown>()
      .scaleExtent(SCALE_EXTENT)
      // The double-click zoom is the one animated thing d3 does here.
      .duration(reducedMotion ? 0 : 250)
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        viewportRef.current?.setAttribute(
          "transform",
          event.transform.toString(),
        );
      });
    const selection = select(svg).call(behaviour);
    return () => {
      selection.on(".zoom", null);
    };
  }, [reducedMotion]);

  return (
    <svg
      ref={svgRef}
      // A group, not an image: an image's children are presentational, and
      // the boxes on it are buttons.
      role="group"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      className={cn(
        "block h-auto w-full cursor-grab touch-none select-none active:cursor-grabbing",
        className,
      )}
    >
      <g ref={viewportRef} {...{ [GRAPH_VIEWPORT_ATTRIBUTE]: "" }}>
        {children}
      </g>
    </svg>
  );
}
