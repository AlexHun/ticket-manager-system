import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";

const DURATION_MS = 500;

/** Fast at the start, settling at the end — a number that decelerates into place
 *  reads as arriving rather than as still loading. */
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * A number that counts up to `value`.
 *
 * Animates from the *previous* value rather than from zero, so changing the
 * range tweens between two real numbers instead of collapsing to nothing and
 * climbing back — the same reasoning as holding the chart frame on refetch.
 *
 * Returns `value` immediately when the user prefers reduced motion, so callers
 * never have to branch. Only the displayed frames are approximate; the caller
 * is expected to expose the true `value` to assistive tech (see `StatTile`).
 */
export function useCountUp(value: number): number {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef(0);

  useEffect(() => {
    if (reduced) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }

    const from = fromRef.current;
    if (from === value) return;

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION_MS, 1);
      setDisplay(Math.round(from + (value - from) * easeOutCubic(t)));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = value;
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameRef.current);
  }, [value, reduced]);

  return display;
}
