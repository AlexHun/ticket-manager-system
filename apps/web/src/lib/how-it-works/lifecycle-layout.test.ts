import { describe, expect, it } from "vitest";
import { TICKET_STATUS } from "@ticket/shared";
import { LIFECYCLE, LIFECYCLE_STEPS } from "./lifecycle";
import { layOutLifecycle, wrapText } from "./lifecycle-layout";
import { contains, type Rect } from "./layout";

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

describe("layOutLifecycle", () => {
  const layout = layOutLifecycle(LIFECYCLE);

  it("is a pure function of the data", () => {
    expect(layOutLifecycle(LIFECYCLE)).toEqual(layout);
  });

  it("places every step once, inside the band of the lane the data names", () => {
    expect(layout.steps.map((placed) => placed.step.id)).toEqual(
      LIFECYCLE_STEPS.map((step) => step.id),
    );
    for (const placed of layout.steps) {
      expect(
        contains(layout.lanesById[placed.step.lane], placed),
        placed.step.id,
      ).toBe(true);
    }
  });

  it("stacks the three lanes without overlap, Customer on top", () => {
    const [customer, assistant, agent] = layout.lanes;
    expect([customer.lane.id, assistant.lane.id, agent.lane.id]).toEqual([
      "customer",
      "assistant",
      "agent",
    ]);
    expect(customer.y + customer.height).toBeLessThanOrEqual(assistant.y);
    expect(assistant.y + assistant.height).toBeLessThanOrEqual(agent.y);
  });

  it("never lets two steps overlap", () => {
    for (const [i, a] of layout.steps.entries()) {
      for (const b of layout.steps.slice(i + 1)) {
        expect(overlaps(a, b), `${a.step.id} overlaps ${b.step.id}`).toBe(
          false,
        );
      }
    }
  });

  it("puts a branch's two arms in one column, to the right of the step they fork from", () => {
    expect(LIFECYCLE.branches).toHaveLength(2);
    for (const { from, arms } of LIFECYCLE.branches) {
      const [a, b] = arms.map((id) => layout.stepsById[id]);
      expect(a.x, `${arms.join(" and ")}`).toBe(b.x);
      expect(a.x).toBeGreaterThan(layout.stepsById[from].x);
    }
  });

  it("moves left to right along every edge", () => {
    for (const placed of layout.edges) {
      expect(placed.x2, placed.edge.id).toBeGreaterThan(placed.x1);
    }
  });

  it("keeps the notes clear of each other and of every step, each under the step it qualifies", () => {
    const rects: Array<[string, Rect]> = [
      ...layout.steps.map((p): [string, Rect] => [p.step.id, p]),
      ...layout.notes.map((p): [string, Rect] => [p.note.id, p]),
    ];
    for (const [i, [nameA, a]] of rects.entries()) {
      for (const [nameB, b] of rects.slice(i + 1)) {
        expect(overlaps(a, b), `${nameA} overlaps ${nameB}`).toBe(false);
      }
    }
    const lanesBottom = Math.max(...layout.lanes.map((l) => l.y + l.height));
    for (const placed of layout.notes) {
      const step = layout.stepsById[placed.note.step];
      expect(placed.y).toBeGreaterThanOrEqual(lanesBottom);
      // The connector drops straight from the step's centre into the note.
      expect(placed.connectorX).toBe(step.x + step.width / 2);
      expect(placed.connectorX).toBeGreaterThan(placed.x);
      expect(placed.connectorX).toBeLessThan(placed.x + placed.width);
    }
  });

  it("draws the Status strip above the lanes with all five Statuses, in lifecycle order", () => {
    expect(layout.strip.map((chip) => chip.status)).toEqual([
      TICKET_STATUS.New,
      TICKET_STATUS.Processing,
      TICKET_STATUS.Open,
      TICKET_STATUS.Resolved,
      TICKET_STATUS.Closed,
    ]);
    const lanesTop = Math.min(...layout.lanes.map((l) => l.y));
    for (const chip of layout.strip) {
      expect(chip.y + chip.height).toBeLessThanOrEqual(lanesTop);
    }
  });

  it("covers everything with the canvas", () => {
    const canvas = { x: 0, y: 0, width: layout.width, height: layout.height };
    for (const rect of [...layout.lanes, ...layout.notes, ...layout.strip]) {
      expect(contains(canvas, rect)).toBe(true);
    }
  });
});

describe("wrapText", () => {
  it("breaks at spaces so no line passes the limit", () => {
    expect(wrapText("Reply joins the thread", 14)).toEqual([
      "Reply joins",
      "the thread",
    ]);
  });

  it("keeps a word longer than the limit whole", () => {
    expect(wrapText("Classification", 10)).toEqual(["Classification"]);
  });

  it("leaves a short text on one line", () => {
    expect(wrapText("Claim", 14)).toEqual(["Claim"]);
  });
});
