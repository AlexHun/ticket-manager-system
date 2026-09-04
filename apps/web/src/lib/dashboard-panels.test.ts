import { describe, expect, test } from "vitest";
import {
  DASHBOARD_PANEL_ID,
  DASHBOARD_PANEL_WIDTH,
  DEFAULT_DASHBOARD_LAYOUT,
  type DashboardPanelId,
  type DashboardPanelPlacement,
  type DashboardPanelWidth,
} from "@ticket/shared";
import {
  DASHBOARD_PANEL_WIDTH_ORDER,
  applyPanelCommand,
  panelCapabilities,
  reorderPanels,
} from "./dashboard-panels";

/**
 * The panel-move rules, without a dashboard.
 *
 * Every case here used to be reachable only by rendering the whole page
 * against four mocked endpoints and clicking a toolbar button — which meant
 * the boundary rules (already first, already last, already widest, already
 * narrowest) were asserted through a `disabled` attribute rather than
 * directly, and the layout the click would have saved was only ever seen as a
 * request body. These are the same rules, read off the array.
 */

/** A layout of the given widths, over ids taken from the head of the real
 * panel list so nothing here is asserting against invented values. */
function layout(
  widths: DashboardPanelWidth[] = [
    DASHBOARD_PANEL_WIDTH.narrow,
    DASHBOARD_PANEL_WIDTH.narrow,
    DASHBOARD_PANEL_WIDTH.narrow,
  ],
): DashboardPanelPlacement[] {
  const ids: DashboardPanelId[] = [
    DASHBOARD_PANEL_ID.volumeChart,
    DASHBOARD_PANEL_ID.statusMix,
    DASHBOARD_PANEL_ID.needsAttention,
    DASHBOARD_PANEL_ID.firstResponseChart,
  ];
  return widths.map((width, i) => ({ panelId: ids[i]!, width }));
}

const ids = (l: readonly DashboardPanelPlacement[]) => l.map((p) => p.panelId);

const NARROWEST = DASHBOARD_PANEL_WIDTH_ORDER[0]!;
const WIDEST =
  DASHBOARD_PANEL_WIDTH_ORDER[DASHBOARD_PANEL_WIDTH_ORDER.length - 1]!;

describe("panelCapabilities", () => {
  test("the first panel cannot move earlier and the last cannot move later", () => {
    const l = layout();

    expect(panelCapabilities(l, l[0]!.panelId)).toMatchObject({
      moveEarlier: false,
      moveLater: true,
    });
    expect(panelCapabilities(l, l[1]!.panelId)).toMatchObject({
      moveEarlier: true,
      moveLater: true,
    });
    expect(panelCapabilities(l, l[2]!.panelId)).toMatchObject({
      moveEarlier: true,
      moveLater: false,
    });
  });

  test("a lone panel can move in neither direction", () => {
    const l = layout([DASHBOARD_PANEL_WIDTH.narrow]);
    expect(panelCapabilities(l, l[0]!.panelId)).toMatchObject({
      moveEarlier: false,
      moveLater: false,
    });
  });

  test("the narrowest width cannot shrink and the widest cannot grow", () => {
    const l = layout([NARROWEST, DASHBOARD_PANEL_WIDTH.half, WIDEST]);

    expect(panelCapabilities(l, l[0]!.panelId)).toMatchObject({
      shrink: false,
      grow: true,
    });
    expect(panelCapabilities(l, l[1]!.panelId)).toMatchObject({
      shrink: true,
      grow: true,
    });
    expect(panelCapabilities(l, l[2]!.panelId)).toMatchObject({
      shrink: true,
      grow: false,
    });
  });

  test("a panel that isn't in the layout can do nothing", () => {
    expect(
      panelCapabilities(layout(), DASHBOARD_PANEL_ID.assistantEffectiveness),
    ).toEqual({
      moveEarlier: false,
      moveLater: false,
      shrink: false,
      grow: false,
    });
  });
});

describe("applyPanelCommand", () => {
  test("swaps a panel with its neighbour in each direction", () => {
    const l = layout();

    expect(ids(applyPanelCommand(l, l[1]!.panelId, "moveEarlier")!)).toEqual([
      l[1]!.panelId,
      l[0]!.panelId,
      l[2]!.panelId,
    ]);
    expect(ids(applyPanelCommand(l, l[1]!.panelId, "moveLater")!)).toEqual([
      l[0]!.panelId,
      l[2]!.panelId,
      l[1]!.panelId,
    ]);
  });

  test("steps one width along the order, keeping the panel where it is", () => {
    const l = layout([DASHBOARD_PANEL_WIDTH.half, NARROWEST, WIDEST]);

    const grown = applyPanelCommand(l, l[0]!.panelId, "grow")!;
    expect(grown[0]).toEqual({
      panelId: l[0]!.panelId,
      width: DASHBOARD_PANEL_WIDTH.twoThirds,
    });
    expect(ids(grown)).toEqual(ids(l));

    const shrunk = applyPanelCommand(l, l[0]!.panelId, "shrink")!;
    expect(shrunk[0]!.width).toBe(NARROWEST);
    expect(ids(shrunk)).toEqual(ids(l));
  });

  test("walks the full width order and back, one step at a time", () => {
    let current = layout([NARROWEST]);
    const climbed: DashboardPanelWidth[] = [current[0]!.width];

    for (let i = 0; i < DASHBOARD_PANEL_WIDTH_ORDER.length - 1; i++) {
      current = applyPanelCommand(current, current[0]!.panelId, "grow")!;
      climbed.push(current[0]!.width);
    }
    expect(climbed).toEqual(DASHBOARD_PANEL_WIDTH_ORDER);
    expect(applyPanelCommand(current, current[0]!.panelId, "grow")).toBeNull();

    for (let i = 0; i < DASHBOARD_PANEL_WIDTH_ORDER.length - 1; i++) {
      current = applyPanelCommand(current, current[0]!.panelId, "shrink")!;
    }
    expect(current[0]!.width).toBe(NARROWEST);
    expect(applyPanelCommand(current, current[0]!.panelId, "shrink")).toBeNull();
  });

  test("returns null for every command the capabilities refuse", () => {
    const l = layout([NARROWEST, DASHBOARD_PANEL_WIDTH.half, WIDEST]);
    const first = l[0]!.panelId;
    const last = l[2]!.panelId;

    expect(applyPanelCommand(l, first, "moveEarlier")).toBeNull();
    expect(applyPanelCommand(l, last, "moveLater")).toBeNull();
    expect(applyPanelCommand(l, first, "shrink")).toBeNull();
    expect(applyPanelCommand(l, last, "grow")).toBeNull();
    expect(
      applyPanelCommand(l, DASHBOARD_PANEL_ID.workload, "moveLater"),
    ).toBeNull();
  });

  test("never mutates the layout it was given", () => {
    const l = layout([DASHBOARD_PANEL_WIDTH.half, NARROWEST, WIDEST]);
    const before = structuredClone(l);

    applyPanelCommand(l, l[0]!.panelId, "moveLater");
    applyPanelCommand(l, l[0]!.panelId, "grow");
    reorderPanels(l, l[0]!.panelId, l[2]!.panelId);

    expect(l).toEqual(before);
  });

  test("the default layout's boundary panels agree with what the toolbar disables", () => {
    const first = DEFAULT_DASHBOARD_LAYOUT[0]!.panelId;
    const last =
      DEFAULT_DASHBOARD_LAYOUT[DEFAULT_DASHBOARD_LAYOUT.length - 1]!.panelId;

    expect(applyPanelCommand(DEFAULT_DASHBOARD_LAYOUT, first, "moveEarlier")).toBeNull();
    expect(applyPanelCommand(DEFAULT_DASHBOARD_LAYOUT, last, "moveLater")).toBeNull();
    expect(
      ids(applyPanelCommand(DEFAULT_DASHBOARD_LAYOUT, first, "moveLater")!),
    ).toEqual([
      DEFAULT_DASHBOARD_LAYOUT[1]!.panelId,
      DEFAULT_DASHBOARD_LAYOUT[0]!.panelId,
      ...DEFAULT_DASHBOARD_LAYOUT.slice(2).map((p) => p.panelId),
    ]);
  });
});

describe("reorderPanels", () => {
  test("drops the dragged panel into the target's slot, shifting the rest", () => {
    const l = layout([
      DASHBOARD_PANEL_WIDTH.narrow,
      DASHBOARD_PANEL_WIDTH.narrow,
      DASHBOARD_PANEL_WIDTH.narrow,
      DASHBOARD_PANEL_WIDTH.narrow,
    ]);
    const [a, b, c, d] = ids(l);

    // Forward: a lands where c was, b and c shift up one.
    expect(ids(reorderPanels(l, a!, c!)!)).toEqual([b, c, a, d]);
    // Backward: d lands where b was, b and c shift down one.
    expect(ids(reorderPanels(l, d!, b!)!)).toEqual([a, d, b, c]);
  });

  test("carries each panel's width along with it", () => {
    const l = layout([NARROWEST, WIDEST, DASHBOARD_PANEL_WIDTH.half]);
    expect(reorderPanels(l, l[0]!.panelId, l[2]!.panelId)).toEqual([
      l[1],
      l[2],
      l[0],
    ]);
  });

  test("returns null when the panel is dropped on itself", () => {
    const l = layout();
    expect(reorderPanels(l, l[0]!.panelId, l[0]!.panelId)).toBeNull();
  });

  test("returns null when either id is not in the layout", () => {
    const l = layout();
    expect(reorderPanels(l, DASHBOARD_PANEL_ID.workload, l[0]!.panelId)).toBeNull();
    expect(reorderPanels(l, l[0]!.panelId, DASHBOARD_PANEL_ID.workload)).toBeNull();
  });
});
