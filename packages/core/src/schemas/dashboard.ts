import { z } from "zod";
import { DASHBOARD_PANEL_IDS, DASHBOARD_PANEL_WIDTHS } from "@ticket/shared";

/**
 * A saved dashboard layout, as a user writes it (issue #102).
 *
 * Not just "an array of placements" — it must name the *current* fixed panel
 * set exactly once each. That is what keeps a saved layout from silently
 * dropping a panel a future `DashboardPage` change added, or from carrying a
 * stale id for one that was removed: either would leave `DashboardPage`
 * unable to place every panel it renders, or holding a placement nothing
 * reads. The route revalidates every write against this schema rather than
 * trusting the client to have kept up.
 */
export const dashboardLayoutSchema = z.object({
  layout: z
    .array(
      z.object({
        panelId: z.enum(DASHBOARD_PANEL_IDS),
        width: z.enum(DASHBOARD_PANEL_WIDTHS),
      }),
    )
    .length(
      DASHBOARD_PANEL_IDS.length,
      `Layout must place exactly the ${DASHBOARD_PANEL_IDS.length} current dashboard panels`,
    )
    .refine(
      (placements) =>
        new Set(placements.map((p) => p.panelId)).size === placements.length &&
        DASHBOARD_PANEL_IDS.every((id) =>
          placements.some((p) => p.panelId === id),
        ),
      { message: "Layout must include each current dashboard panel exactly once" },
    ),
});

export type DashboardLayoutValues = z.infer<typeof dashboardLayoutSchema>;
