/**
 * The dashboard grid, written down once so the real panels and the skeleton
 * that stands in for them can't drift apart.
 *
 * Six columns rather than four: it divides by two and three, so a row can hold
 * one wide panel, two halves, or three thirds without a second breakpoint set.
 */
export const DASHBOARD_GRID = "grid gap-3 lg:grid-cols-6";

export const PANEL_SPAN = {
  /** Full width — the time series, which needs the horizontal room. */
  wide: "lg:col-span-6",
  /** Half width. */
  half: "lg:col-span-3",
  /** Two thirds — a list that needs room for subjects beside a narrow panel. */
  twoThirds: "lg:col-span-4",
  /** A third. */
  narrow: "lg:col-span-2",
} as const;
