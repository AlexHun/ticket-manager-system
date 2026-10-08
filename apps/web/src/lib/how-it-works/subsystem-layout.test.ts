import { describe, expect, it } from "vitest";
import { ARCHITECTURE } from "./architecture";
import { contains, layOutArchitecture, type Rect } from "./layout";
import { PART_SIDE, layOutSubsystems } from "./subsystem-layout";
import { DRILLABLE_BOXES, subsystemsOf } from "./subsystems";

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function onSideBorder(rect: Rect, x: number, y: number): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  return (
    (near(x, rect.x) || near(x, rect.x + rect.width)) &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}

/** The runtime view's drawing, which is what 1280px was judged readable at. */
const RUNTIME = layOutArchitecture(ARCHITECTURE);

describe.each(DRILLABLE_BOXES)("layOutSubsystems(%s)", (box) => {
  const subsystems = subsystemsOf(box);
  const layout = layOutSubsystems(box, subsystems);
  const nodes: Array<[string, Rect]> = [
    ...layout.subsystems.map((p): [string, Rect] => [p.subsystem.id, p]),
    ...layout.parts.map((p): [string, Rect] => [p.id, p]),
  ];

  it("is a pure function of the data", () => {
    expect(layOutSubsystems(box, subsystems)).toEqual(layout);
  });

  it("places every subsystem once, in the data's order, inside the frame", () => {
    expect(layout.subsystems.map((p) => p.subsystem.id)).toEqual(
      subsystems.map((s) => s.id),
    );
    for (const placed of layout.subsystems) {
      expect(contains(layout.frame, placed), placed.subsystem.id).toBe(true);
    }
    const ys = layout.subsystems.map((p) => p.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it("places every part a subsystem talks to once, outside the frame", () => {
    const named = new Set(
      subsystems.flatMap((s) => s.links.map((l) => l.part)),
    );
    expect(layout.parts.map((p) => p.id).sort()).toEqual([...named].sort());
    for (const part of layout.parts) {
      expect(overlaps(layout.frame, part), part.id).toBe(false);
    }
  });

  it("never lets two nodes overlap", () => {
    for (const [i, [nameA, a]] of nodes.entries()) {
      for (const [nameB, b] of nodes.slice(i + 1)) {
        expect(overlaps(a, b), `${nameA} overlaps ${nameB}`).toBe(false);
      }
    }
  });

  it("joins every link to the side of its subsystem that faces its part", () => {
    expect(layout.links).toHaveLength(
      subsystems.reduce((sum, s) => sum + s.links.length, 0),
    );
    for (const placed of layout.links) {
      const subsystem = layout.subsystems.find(
        (p) => p.subsystem.id === placed.subsystem,
      )!;
      const part = layout.parts.find((p) => p.id === placed.link.part)!;
      const ends: Array<[number, number]> = [
        [placed.x1, placed.y1],
        [placed.x2, placed.y2],
      ];
      expect(
        ends.some(([x, y]) => onSideBorder(subsystem, x, y)),
        placed.id,
      ).toBe(true);
      expect(
        ends.some(([x, y]) => onSideBorder(part, x, y)),
        placed.id,
      ).toBe(true);
      // The subsystem's end is on the side its part stands, so no link
      // crosses the column.
      const facing =
        part.side === PART_SIDE.left
          ? subsystem.x
          : subsystem.x + subsystem.width;
      expect(
        ends.some(([x]) => x === facing),
        placed.id,
      ).toBe(true);
    }
    const ids = layout.links.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every node with the canvas", () => {
    const canvas = { x: 0, y: 0, width: layout.width, height: layout.height };
    for (const [name, rect] of nodes) {
      expect(contains(canvas, rect), name).toBe(true);
    }
    expect(contains(canvas, layout.frame)).toBe(true);
  });

  it("draws at no smaller a scale than the runtime view, so it is as readable at 1280px", () => {
    // Both drawings are scaled to the canvas's width, so a wider drawing would
    // shrink every label below the size the runtime view shows it at.
    expect(layout.width).toBeLessThanOrEqual(RUNTIME.width);
  });
});
