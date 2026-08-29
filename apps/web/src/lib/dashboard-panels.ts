import {
  DASHBOARD_PANEL_ID,
  DASHBOARD_PANEL_WIDTH,
  type DashboardPanelId,
  type DashboardPanelWidth,
} from "@ticket/shared";

/** What a screen reader (and the customize toolbar's `aria-label`s) call each
 * panel — the dashboard's own headings are per-chart, not a single fixed
 * label, so this is its own registry rather than derived from them. */
export const DASHBOARD_PANEL_LABEL: Record<DashboardPanelId, string> = {
  [DASHBOARD_PANEL_ID.volumeChart]: "Ticket volume",
  [DASHBOARD_PANEL_ID.statusMix]: "Status mix",
  [DASHBOARD_PANEL_ID.needsAttention]: "Needs attention",
  [DASHBOARD_PANEL_ID.firstResponseChart]: "First response time",
  [DASHBOARD_PANEL_ID.byCategory]: "By category",
  [DASHBOARD_PANEL_ID.workload]: "Workload",
  [DASHBOARD_PANEL_ID.backlogAge]: "Open backlog age",
  [DASHBOARD_PANEL_ID.topCustomers]: "Top customers",
  [DASHBOARD_PANEL_ID.assistantEffectiveness]: "Assistant effectiveness",
};

/** Narrowest to widest — the order "shrink"/"grow" step through. Mirrors the
 * grid's own 6-column math in `grid.ts`: 2 → 3 → 4 → 6. */
export const DASHBOARD_PANEL_WIDTH_ORDER: DashboardPanelWidth[] = [
  DASHBOARD_PANEL_WIDTH.narrow,
  DASHBOARD_PANEL_WIDTH.half,
  DASHBOARD_PANEL_WIDTH.twoThirds,
  DASHBOARD_PANEL_WIDTH.wide,
];
