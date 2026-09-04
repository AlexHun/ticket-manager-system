import {
  DASHBOARD_PANEL_ID,
  DASHBOARD_PANEL_WIDTH,
  type DashboardPanelId,
  type DashboardPanelPlacement,
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

/**
 * The four things a panel's customize toolbar can ask for — one button each,
 * and one key each in `panelCapabilities` below.
 *
 * Naming them is what lets the slot take a single `onCommand` callback instead
 * of four handlers, and what keeps "is this button disabled?" and "does this
 * command do anything?" reading the same record rather than two lists of
 * conditions that have to be kept in step by hand.
 */
export const DASHBOARD_PANEL_COMMAND = {
  moveEarlier: "moveEarlier",
  moveLater: "moveLater",
  shrink: "shrink",
  grow: "grow",
} as const;

export type DashboardPanelCommand =
  (typeof DASHBOARD_PANEL_COMMAND)[keyof typeof DASHBOARD_PANEL_COMMAND];

/** Which of the four commands would actually change the layout. */
export type DashboardPanelCapabilities = Record<DashboardPanelCommand, boolean>;

/** A panel that isn't in the layout at all can do nothing — the shape every
 * lookup miss below returns, rather than four separate `false`s inline. */
const NO_CAPABILITIES: DashboardPanelCapabilities = {
  moveEarlier: false,
  moveLater: false,
  shrink: false,
  grow: false,
};

/**
 * What this panel can do, from its position in the array and its width alone.
 *
 * This is the single home of the boundary rules — already first, already last,
 * already narrowest, already widest. `applyPanelCommand` asks it before it
 * touches anything and the toolbar asks it to decide `disabled`, so a button
 * that is enabled and a command that no-ops cannot disagree.
 */
export function panelCapabilities(
  layout: readonly DashboardPanelPlacement[],
  panelId: DashboardPanelId,
): DashboardPanelCapabilities {
  return capabilitiesAt(
    layout,
    layout.findIndex((p) => p.panelId === panelId),
  );
}

/** The rules themselves, by index — so `applyPanelCommand` can look a panel up
 * once and still consult exactly the same answers the toolbar was given. */
function capabilitiesAt(
  layout: readonly DashboardPanelPlacement[],
  index: number,
): DashboardPanelCapabilities {
  if (index === -1) return NO_CAPABILITIES;

  const widthIndex = DASHBOARD_PANEL_WIDTH_ORDER.indexOf(layout[index]!.width);

  return {
    moveEarlier: index > 0,
    moveLater: index < layout.length - 1,
    shrink: widthIndex > 0,
    grow: widthIndex < DASHBOARD_PANEL_WIDTH_ORDER.length - 1,
  };
}

/**
 * The layout after one toolbar command, or `null` when it would be a no-op —
 * which is every case `panelCapabilities` calls false, plus an unknown panel.
 *
 * `null` rather than the array unchanged: the caller's next move is a `PUT`,
 * and "nothing to save" is worth being unable to miss.
 */
export function applyPanelCommand(
  layout: readonly DashboardPanelPlacement[],
  panelId: DashboardPanelId,
  command: DashboardPanelCommand,
): DashboardPanelPlacement[] | null {
  const index = layout.findIndex((p) => p.panelId === panelId);
  if (!capabilitiesAt(layout, index)[command]) return null;

  switch (command) {
    case DASHBOARD_PANEL_COMMAND.moveEarlier:
      return movePanelWithin(layout, index, index - 1);
    case DASHBOARD_PANEL_COMMAND.moveLater:
      return movePanelWithin(layout, index, index + 1);
    case DASHBOARD_PANEL_COMMAND.shrink:
      return resizePanel(layout, index, -1);
    case DASHBOARD_PANEL_COMMAND.grow:
      return resizePanel(layout, index, 1);
  }
}

/**
 * The layout after a drag drops `activeId` onto `overId`'s slot, or `null`
 * when nothing moves — the panel dropped on itself, or either id is a stranger
 * (dnd-kit hands back whatever id it was given, not a `DashboardPanelId`).
 */
export function reorderPanels(
  layout: readonly DashboardPanelPlacement[],
  activeId: DashboardPanelId,
  overId: DashboardPanelId,
): DashboardPanelPlacement[] | null {
  const from = layout.findIndex((p) => p.panelId === activeId);
  const to = layout.findIndex((p) => p.panelId === overId);
  if (from === -1 || to === -1 || from === to) return null;
  return movePanelWithin(layout, from, to);
}

/** `arrayMove` for placements — pull one out, put it back at `to`. Written
 * here rather than imported from `@dnd-kit/sortable` so this module stays a
 * plain data module with no runtime dependencies, which is what lets the E2E
 * suite import from it directly (see `tests/e2e/dashboard-layout.spec.ts`). */
function movePanelWithin(
  layout: readonly DashboardPanelPlacement[],
  from: number,
  to: number,
): DashboardPanelPlacement[] {
  const next = [...layout];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** One step along `DASHBOARD_PANEL_WIDTH_ORDER`. Only ever reached through a
 * capability the record above allows, so the target index is in range — the
 * bounds are checked there and nowhere else. */
function resizePanel(
  layout: readonly DashboardPanelPlacement[],
  index: number,
  step: 1 | -1,
): DashboardPanelPlacement[] {
  const widthIndex = DASHBOARD_PANEL_WIDTH_ORDER.indexOf(layout[index]!.width);
  const next = [...layout];
  next[index] = {
    ...next[index]!,
    width: DASHBOARD_PANEL_WIDTH_ORDER[widthIndex + step]!,
  };
  return next;
}
