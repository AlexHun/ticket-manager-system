import { describe, expect, it } from "vitest";
import {
  ARCHITECTURE,
  ARCHITECTURE_NODES,
  RAILWAY_FRAME,
} from "./architecture";
import { contains, layOutArchitecture, type Rect } from "./layout";

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function onBorder(rect: Rect, x: number, y: number): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  const withinX = x >= rect.x - 0.5 && x <= rect.x + rect.width + 0.5;
  const withinY = y >= rect.y - 0.5 && y <= rect.y + rect.height + 0.5;
  return (
    (withinY && (near(x, rect.x) || near(x, rect.x + rect.width))) ||
    (withinX && (near(y, rect.y) || near(y, rect.y + rect.height)))
  );
}

function strictlyInside(rect: Rect, x: number, y: number): boolean {
  return (
    x > rect.x &&
    x < rect.x + rect.width &&
    y > rect.y &&
    y < rect.y + rect.height
  );
}

describe("layOutArchitecture", () => {
  const layout = layOutArchitecture(ARCHITECTURE);
  const topLevel = layout.nodes.filter((placed) => !placed.node.inside);

  it("is a pure function of the data", () => {
    expect(layOutArchitecture(ARCHITECTURE)).toEqual(layout);
  });

  it("places every node once", () => {
    expect(layout.nodes.map((placed) => placed.node.id).sort()).toEqual(
      ARCHITECTURE_NODES.map((node) => node.id).sort(),
    );
  });

  it("never lets two boxes, or a box and the note, overlap", () => {
    const rects: Array<[string, Rect]> = [
      ...topLevel.map((placed): [string, Rect] => [placed.node.id, placed]),
      ["note", layout.note],
    ];
    for (const [i, [nameA, a]] of rects.entries()) {
      for (const [nameB, b] of rects.slice(i + 1)) {
        expect(overlaps(a, b), `${nameA} overlaps ${nameB}`).toBe(false);
      }
    }
  });

  it("draws a node inside its parent's box", () => {
    for (const placed of layout.nodes) {
      if (!placed.node.inside) continue;
      expect(contains(layout.byId[placed.node.inside], placed)).toBe(true);
    }
  });

  it("frames what Railway hosts and nothing else", () => {
    for (const placed of topLevel) {
      const enclosed = (RAILWAY_FRAME.encloses as readonly string[]).includes(
        placed.node.id,
      );
      if (enclosed) {
        expect(contains(layout.frame, placed), placed.node.id).toBe(true);
      } else {
        expect(overlaps(layout.frame, placed), placed.node.id).toBe(false);
      }
    }
  });

  it("starts and ends every connection on the border of its two boxes", () => {
    for (const placed of layout.edges) {
      const { from, to, id } = placed.edge;
      expect(onBorder(layout.byId[from], placed.x1, placed.y1), id).toBe(true);
      expect(onBorder(layout.byId[to], placed.x2, placed.y2), id).toBe(true);
    }
  });

  it("puts every connection label clear of the boxes, and apart from the others", () => {
    for (const placed of layout.edges) {
      for (const box of topLevel) {
        expect(
          strictlyInside(box, placed.labelX, placed.labelY),
          `${placed.edge.id}'s label sits on ${box.node.id}`,
        ).toBe(false);
      }
    }
    const spots = layout.edges.map((e) => `${e.labelX},${e.labelY}`);
    expect(new Set(spots).size).toBe(spots.length);
  });

  it("covers every box with the canvas", () => {
    const canvas = { x: 0, y: 0, width: layout.width, height: layout.height };
    for (const placed of layout.nodes)
      expect(contains(canvas, placed)).toBe(true);
    expect(contains(canvas, layout.frame)).toBe(true);
    expect(contains(canvas, layout.note)).toBe(true);
  });
});

describe("contains", () => {
  const outer = { x: 0, y: 0, width: 100, height: 50 };

  it("holds a rect inside, edges included", () => {
    expect(contains(outer, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
    expect(contains(outer, outer)).toBe(true);
  });

  it("refuses a rect that crosses any edge", () => {
    expect(contains(outer, { x: -1, y: 10, width: 20, height: 20 })).toBe(
      false,
    );
    expect(contains(outer, { x: 10, y: -1, width: 20, height: 20 })).toBe(
      false,
    );
    expect(contains(outer, { x: 90, y: 10, width: 20, height: 20 })).toBe(
      false,
    );
    expect(contains(outer, { x: 10, y: 40, width: 20, height: 20 })).toBe(
      false,
    );
  });
});
