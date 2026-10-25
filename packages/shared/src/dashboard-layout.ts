/**
 * The dashboard's fixed panel set (issue #102) — every panel `DashboardPage`
 * renders today, given a durable id that survives the component being
 * renamed or moved. A user's saved layout names panels by this id, never by
 * a component name or file path, which is exactly what keeps a refactor from
 * silently orphaning someone's saved arrangement.
 *
 * Fixed on purpose: this feature reorders and resizes panels, it does not
 * add, remove or hide them, so this set changes only when a panel is added
 * to or removed from the dashboard itself, not as part of personalizing it.
 */
export const DASHBOARD_PANEL_ID = {
  volumeChart: "volumeChart",
  statusMix: "statusMix",
  needsAttention: "needsAttention",
  firstResponseChart: "firstResponseChart",
  byCategory: "byCategory",
  workload: "workload",
  backlogAge: "backlogAge",
  topCustomers: "topCustomers",
  assistantEffectiveness: "assistantEffectiveness",
} as const;

export type DashboardPanelId =
  (typeof DASHBOARD_PANEL_ID)[keyof typeof DASHBOARD_PANEL_ID];

export const DASHBOARD_PANEL_IDS = [
  DASHBOARD_PANEL_ID.volumeChart,
  DASHBOARD_PANEL_ID.statusMix,
  DASHBOARD_PANEL_ID.needsAttention,
  DASHBOARD_PANEL_ID.firstResponseChart,
  DASHBOARD_PANEL_ID.byCategory,
  DASHBOARD_PANEL_ID.workload,
  DASHBOARD_PANEL_ID.backlogAge,
  DASHBOARD_PANEL_ID.topCustomers,
  DASHBOARD_PANEL_ID.assistantEffectiveness,
] as const;

/**
 * The 4 discrete widths a panel may snap to — the same four spans
 * `PANEL_SPAN` in `apps/web/src/components/dashboard/grid.ts` already draws
 * the grid with. Never a fifth value or a continuous size: the grid is 6
 * columns for exactly this reason, see that file's own comment.
 */
export const DASHBOARD_PANEL_WIDTH = {
  narrow: "narrow",
  half: "half",
  twoThirds: "twoThirds",
  wide: "wide",
} as const;

export type DashboardPanelWidth =
  (typeof DASHBOARD_PANEL_WIDTH)[keyof typeof DASHBOARD_PANEL_WIDTH];

export const DASHBOARD_PANEL_WIDTHS = [
  DASHBOARD_PANEL_WIDTH.narrow,
  DASHBOARD_PANEL_WIDTH.half,
  DASHBOARD_PANEL_WIDTH.twoThirds,
  DASHBOARD_PANEL_WIDTH.wide,
] as const;

/** One panel's place in a saved (or default) layout: its identity plus the
 * width it's been resized to. Order in the array is display order — there is
 * no separate position field. */
export interface DashboardPanelPlacement {
  panelId: DashboardPanelId;
  width: DashboardPanelWidth;
}

/**
 * What `DashboardPage` renders when a user has never customized it — exactly
 * today's hard-coded markup, given names. `GET /api/dashboard-layout` falls
 * back to this for a user with no saved `DashboardLayout` row, and "reset to
 * default" is defined as returning to it.
 */
export const DEFAULT_DASHBOARD_LAYOUT: DashboardPanelPlacement[] = [
  {
    panelId: DASHBOARD_PANEL_ID.volumeChart,
    width: DASHBOARD_PANEL_WIDTH.twoThirds,
  },
  {
    panelId: DASHBOARD_PANEL_ID.statusMix,
    width: DASHBOARD_PANEL_WIDTH.narrow,
  },
  {
    panelId: DASHBOARD_PANEL_ID.needsAttention,
    width: DASHBOARD_PANEL_WIDTH.twoThirds,
  },
  {
    panelId: DASHBOARD_PANEL_ID.firstResponseChart,
    width: DASHBOARD_PANEL_WIDTH.narrow,
  },
  {
    panelId: DASHBOARD_PANEL_ID.byCategory,
    width: DASHBOARD_PANEL_WIDTH.narrow,
  },
  { panelId: DASHBOARD_PANEL_ID.workload, width: DASHBOARD_PANEL_WIDTH.narrow },
  {
    panelId: DASHBOARD_PANEL_ID.backlogAge,
    width: DASHBOARD_PANEL_WIDTH.narrow,
  },
  {
    panelId: DASHBOARD_PANEL_ID.topCustomers,
    width: DASHBOARD_PANEL_WIDTH.wide,
  },
  {
    panelId: DASHBOARD_PANEL_ID.assistantEffectiveness,
    width: DASHBOARD_PANEL_WIDTH.wide,
  },
];

/** `GET` / `PUT /api/dashboard-layout`: the caller's layout, defaulted where
 * they have never customized it. `isDefault` is what lets the frontend show
 * a "reset to default" action only when there is something to reset. */
export interface DashboardLayoutResponse {
  layout: DashboardPanelPlacement[];
  isDefault: boolean;
}
