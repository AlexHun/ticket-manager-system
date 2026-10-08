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
  zoomIdentity,
  zoomTransform,
  type D3ZoomEvent,
  type ZoomBehavior,
} from "d3-zoom";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Hint } from "@/components/Hint";
import { Button } from "@/components/ui/button";
import {
  GRAPH_GLIDE_MS,
  GRAPH_VIEWPORT_ATTRIBUTE,
  HOW_IT_WORKS_LABEL,
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
 * Zoom in, zoom out and reset buttons sit in the canvas's corner, for a
 * keyboard and for a screen with no wheel (R10, R11). Reset returns the view to
 * the identity transform — the starting frame — and tells the view through
 * `onReset`, which clears its selection.
 *
 * This module is reached only through the lazily loaded How it works page,
 * which is what keeps d3 out of the entry chunk.
 */

const SCALE_EXTENT: [number, number] = [0.5, 4];
/** What one press of zoom in multiplies the scale by; zoom out divides. */
const ZOOM_STEP = 1.5;
/** A button's zoom animates as the double-click zoom does. */
const ZOOM_MS = 250;

export function GraphCanvas({
  width,
  height,
  label,
  focus = null,
  onKeyDown,
  onReset,
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
  /** Called when Reset view is pressed, as the view returns to its start. */
  onReset?: () => void;
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
      // The viewBox, given rather than read: it is what d3 would read, and
      // jsdom has no `viewBox.baseVal` for it to read it from.
      .extent([
        [0, 0],
        [width, height],
      ])
      // The double-click zoom animates too; it jumps under reduced motion.
      .duration(reducedMotion ? 0 : ZOOM_MS)
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
  }, [reducedMotion, width, height]);

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

  // The buttons move the view as a gesture would: through the zoom behaviour,
  // so the next wheel or drag carries on from where they left it.
  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    const behaviour = behaviourRef.current;
    if (!svg || !behaviour) return;
    const target = select(svg).interrupt();
    if (reducedMotion) target.call(behaviour.scaleBy, factor);
    else target.transition().duration(ZOOM_MS).call(behaviour.scaleBy, factor);
  };
  const reset = () => {
    const svg = svgRef.current;
    const behaviour = behaviourRef.current;
    if (svg && behaviour) {
      const target = select(svg).interrupt();
      if (reducedMotion) target.call(behaviour.transform, zoomIdentity);
      else
        target
          .transition()
          .duration(ZOOM_MS)
          .call(behaviour.transform, zoomIdentity);
    }
    onReset?.();
  };

  return (
    <div className="relative">
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
      {/* Outside the <svg>, so pressing one never reaches d3-zoom as the
          start of a drag. */}
      <div
        role="group"
        aria-label={HOW_IT_WORKS_LABEL.zoomControls}
        className="absolute right-2 bottom-2 flex gap-0.5 rounded-lg border bg-card p-0.5"
      >
        <ZoomButton
          label={HOW_IT_WORKS_LABEL.zoomIn}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <Plus />
        </ZoomButton>
        <ZoomButton
          label={HOW_IT_WORKS_LABEL.zoomOut}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <Minus />
        </ZoomButton>
        <ZoomButton label={HOW_IT_WORKS_LABEL.resetView} onClick={reset}>
          <RotateCcw />
        </ZoomButton>
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Hint content={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        onClick={onClick}
      >
        {children}
      </Button>
    </Hint>
  );
}
