import type {
  ArchitectureEdge,
  ArchitectureNode,
  ArchitectureNodeId,
} from "./architecture";

/**
 * Grid cells in, coordinates out, for the Architecture view.
 *
 * Nothing is simulated: a box's place is its cell times the pitch, so it is the
 * same on every load, every reload and every zoom (R9) — the property
 * `DependencyGraph.tsx` keeps for the same reason. d3 only moves the view over
 * these coordinates; it never moves a box.
 */

const NODE_WIDTH = 176;
const NODE_HEIGHT = 56;
const COLUMN_GAP = 96;
const ROW_GAP = 52;
/** Room around the drawing, so a frame or an arrowhead is never clipped. */
const PAD = 24;
/** How far a box drawn inside another sits from its parent's edges. */
const INSET = 12;
/** How far the Railway frame stands off the boxes it encloses. */
const FRAME_PAD = 24;
/**
 * Between two connections joining the same pair of boxes. Wider when the lines
 * run vertically, because their labels then sit side by side, not stacked.
 */
const PARALLEL_SPACING = { horizontal: 24, vertical: 96 } as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedNode extends Rect {
  node: ArchitectureNode;
}

export interface PlacedEdge {
  edge: ArchitectureEdge;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The label's centre: the line's midpoint. */
  labelX: number;
  labelY: number;
}

export interface ArchitectureLayout {
  nodes: PlacedNode[];
  byId: Record<ArchitectureNodeId, PlacedNode>;
  edges: PlacedEdge[];
  frame: Rect;
  note: Rect;
  width: number;
  height: number;
}

export interface ArchitectureInput {
  nodes: readonly ArchitectureNode[];
  edges: readonly ArchitectureEdge[];
  frame: { encloses: readonly ArchitectureNodeId[] };
  note: { column: number; row: number };
}

function cell(column: number, row: number, rowSpan = 1): Rect {
  return {
    x: PAD + column * (NODE_WIDTH + COLUMN_GAP),
    y: PAD + row * (NODE_HEIGHT + ROW_GAP),
    width: NODE_WIDTH,
    height: rowSpan * NODE_HEIGHT + (rowSpan - 1) * ROW_GAP,
  };
}

function bounds(rects: readonly Rect[]): Rect {
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The line between two boxes. Where they share a band of rows the line runs
 * straight across it, and where they share a column it runs straight down;
 * only boxes that share neither are joined corner-wise, centre to centre and
 * cut at each border. `offset` shifts it sideways for a second connection
 * between the same pair.
 */
function connect(
  a: Rect,
  b: Rect,
  offset: (orientation: "horizontal" | "vertical") => number,
): [number, number, number, number] {
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (top < bottom) {
    const y = (top + bottom) / 2 + offset("horizontal");
    return a.x < b.x ? [a.x + a.width, y, b.x, y] : [a.x, y, b.x + b.width, y];
  }

  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  if (left < right) {
    const x = (left + right) / 2 + offset("vertical");
    return a.y < b.y
      ? [x, a.y + a.height, x, b.y]
      : [x, a.y, x, b.y + b.height];
  }

  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  const [x1, y1] = clip(a, ax, ay, bx - ax, by - ay);
  const [x2, y2] = clip(b, bx, by, ax - bx, ay - by);
  return [x1, y1, x2, y2];
}

/** Where a ray from a box's centre leaves the box. */
function clip(
  rect: Rect,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): [number, number] {
  const tx = dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return [cx + dx * t, cy + dy * t];
}

function pairKey(edge: ArchitectureEdge): string {
  return [edge.from, edge.to].sort().join("|");
}

export function layOutArchitecture(
  input: ArchitectureInput,
): ArchitectureLayout {
  const byId = {} as Record<ArchitectureNodeId, PlacedNode>;

  // Top-level boxes first, so a box drawn inside one has its parent to sit in.
  for (const node of input.nodes) {
    if (node.inside) continue;
    byId[node.id] = { node, ...cell(node.column, node.row, node.rowSpan) };
  }
  for (const node of input.nodes) {
    if (!node.inside) continue;
    const parent = byId[node.inside];
    byId[node.id] = {
      node,
      x: parent.x + INSET,
      y: parent.y + parent.height - INSET - NODE_HEIGHT,
      width: parent.width - 2 * INSET,
      height: NODE_HEIGHT,
    };
  }
  const nodes = input.nodes.map((node) => byId[node.id]);

  const pairs = new Map<string, ArchitectureEdge[]>();
  for (const edge of input.edges) {
    const key = pairKey(edge);
    pairs.set(key, [...(pairs.get(key) ?? []), edge]);
  }

  const edges = input.edges.map((edge): PlacedEdge => {
    const siblings = pairs.get(pairKey(edge))!;
    const index = siblings.indexOf(edge);
    const step = index - (siblings.length - 1) / 2;
    const [x1, y1, x2, y2] = connect(
      byId[edge.from],
      byId[edge.to],
      (orientation) => step * PARALLEL_SPACING[orientation],
    );
    return {
      edge,
      x1,
      y1,
      x2,
      y2,
      labelX: (x1 + x2) / 2,
      labelY: (y1 + y2) / 2,
    };
  });

  const enclosed = bounds(input.frame.encloses.map((id) => byId[id]));
  const frame = {
    x: enclosed.x - FRAME_PAD,
    y: enclosed.y - FRAME_PAD,
    width: enclosed.width + 2 * FRAME_PAD,
    height: enclosed.height + 2 * FRAME_PAD,
  };
  const note = cell(input.note.column, input.note.row);

  const drawing = bounds([...nodes, frame, note]);
  return {
    nodes,
    byId,
    edges,
    frame,
    note,
    width: drawing.x + drawing.width + PAD,
    height: drawing.y + drawing.height + PAD,
  };
}
