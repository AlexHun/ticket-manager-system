import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the user has asked the OS to reduce motion.
 *
 * Recharts already honours this on its own (`isAnimationActive` defaults to
 * `'auto'`), so this hook exists for the motion Recharts doesn't own — the
 * count-up on the stat tiles.
 *
 * jsdom implements no `matchMedia`, and the test setup shims Pointer Capture,
 * `scrollIntoView` and `ResizeObserver` but not this one. Hence the guard, and
 * hence the guard's *default*: reduced. Treating an unknown environment as
 * "animate" would make every component test that renders a tile depend on
 * animation frames.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(QUERY).matches
      : true,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(QUERY);
    const onChange = () => setReduced(mql.matches);
    // Re-read on mount as well: the preference can change between the lazy
    // initial state and the effect running.
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
