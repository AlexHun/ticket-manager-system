import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { ROUTE } from "@/lib/routes";
import { ARCHITECTURE_NODES } from "./architecture";
import { LIFECYCLE_STEP, LIFECYCLE_STEPS, lifecycleStep } from "./lifecycle";
import { SUBSYSTEMS } from "./subsystems";

/**
 * The app screens How it works links to (R4). The panel names a screen after
 * its nav item and gates the link the way the sidebar does, so a screen the
 * sidebar does not link to would have no name and no gate.
 */
describe("How it works' screens", () => {
  it("are all screens the sidebar links to", () => {
    const linked = new Set<string>(NAV_ITEMS.map((item) => item.to));
    const parts: { id: string; screen?: string }[] = [
      ...ARCHITECTURE_NODES,
      ...SUBSYSTEMS,
      ...LIFECYCLE_STEPS,
    ];
    const strays = parts
      .filter(({ screen }) => screen !== undefined && !linked.has(screen))
      .map(({ id, screen }) => `${id}: ${screen}`);
    expect(strays).toEqual([]);
  });

  it("send Classification to the Pipeline page", () => {
    expect(lifecycleStep(LIFECYCLE_STEP.classification).screen).toBe(
      ROUTE.pipeline.path,
    );
  });
});
