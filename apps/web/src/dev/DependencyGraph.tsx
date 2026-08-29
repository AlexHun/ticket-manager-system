import { useMemo, useState } from "react";
import { EDGE_KIND, type ModuleEdge, type ModuleNode } from "./protocol";
import { LAYER_VISUAL } from "./layer-visuals";
import { TABLE_FRAME } from "@/lib/table-frame";
import { cn } from "@/lib/utils";

/**
 * The import graph, laid out as columns of architectural depth.
 *
 * Depth, not workspace, is what the columns encode — and that is the one decision
 * the whole picture rests on. `apps/web` and `apps/api` are two trees that touch
 * nowhere in their own code, so a layout grouped by workspace draws two unrelated
 * blobs. Ordered by depth instead, both trees flow left to right and *converge*
 * on the same two columns at the right edge: the zod schemas in `packages/core`
 * and the types in `packages/shared`. The shape of the project is that
 * convergence, so the layout is built to show it.
 *
 * Every edge therefore means "the left one imports the right one". Arrowheads are
 * drawn only on the edges of the node you are pointing at: at ~330 edges, marking
 * all of them costs more legibility than the direction is worth when the
 * left-to-right convention already carries it.
 *
 * Laid out by hand rather than with a force simulation. A force layout would move
 * every node whenever a filter changed, and a graph you cannot find the same file
 * in twice is not a map. This one is a pure function of the filtered node set.
 */

const NODE_W = 158;
const NODE_H = 20;
const ROW_GAP = 6;
const COL_GAP = 76;
/** Room above the first row for the column headings. */
const HEADER_H = 34;
/** Space either side, so a bulging back-edge is not clipped by the viewBox. */
const PAD_X = 16;

/** Fits `NODE_W` minus the accent bar and padding at 10px Geist. */
const LABEL_CHARS = 26;

interface Placed {
  node: ModuleNode;
  x: number;
  y: number;
}

interface Column {
  depth: number;
  label: string;
  x: number;
  count: number;
}

interface Layout {
  placed: Placed[];
  byId: Map<string, Placed>;
  columns: Column[];
  width: number;
  height: number;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function layOut(modules: ModuleNode[]): Layout {
  // Group by depth, then keep only the depths in play so a filtered view has no
  // empty columns to scroll past.
  const groups = new Map<number, ModuleNode[]>();
  for (const node of modules) {
    const { depth } = LAYER_VISUAL[node.layer];
    const group = groups.get(depth);
    if (group) group.push(node);
    else groups.set(depth, [node]);
  }

  const depths = [...groups.keys()].sort((a, b) => a - b);
  const placed: Placed[] = [];
  const byId = new Map<string, Placed>();
  const columns: Column[] = [];
  let tallest = 0;

  depths.forEach((depth, col) => {
    const members = groups.get(depth)!;
    // Directory first, so siblings sit together and a file stays findable by eye.
    members.sort((a, b) => a.dir.localeCompare(b.dir) || a.name.localeCompare(b.name));

    const x = PAD_X + col * (NODE_W + COL_GAP);
    columns.push({
      depth,
      // Several layers can share a column (`test` and `e2e` both sit at 0); the
      // heading names whichever is most numerous there.
      label: LAYER_VISUAL[dominantLayer(members)].label,
      x,
      count: members.length,
    });

    members.forEach((node, row) => {
      const entry = { node, x, y: HEADER_H + row * (NODE_H + ROW_GAP) };
      placed.push(entry);
      byId.set(node.id, entry);
    });
    tallest = Math.max(tallest, members.length);
  });

  return {
    placed,
    byId,
    columns,
    width: PAD_X * 2 + Math.max(1, depths.length) * (NODE_W + COL_GAP) - COL_GAP,
    height: HEADER_H + Math.max(1, tallest) * (NODE_H + ROW_GAP),
  };
}

function dominantLayer(members: ModuleNode[]): ModuleNode["layer"] {
  const counts = new Map<ModuleNode["layer"], number>();
  for (const m of members) counts.set(m.layer, (counts.get(m.layer) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

/**
 * The curve from one node to another.
 *
 * Forward edges leave the right face and arrive at the left. A backward edge —
 * something deeper importing something shallower — leaves the *left* face and
 * bulges outward, so it reads as going against the grain rather than hiding among
 * the forward ones.
 */
function edgePath(from: Placed, to: Placed): string {
  const y1 = from.y + NODE_H / 2;
  const y2 = to.y + NODE_H / 2;
  const forward = to.x >= from.x + NODE_W;

  const x1 = forward ? from.x + NODE_W : from.x;
  const x2 = forward ? to.x : to.x + NODE_W;
  const reach = forward
    ? Math.max(24, (x2 - x1) * 0.45)
    : Math.max(40, (x1 - x2) * 0.35);
  const c1 = forward ? x1 + reach : x1 - reach;
  const c2 = forward ? x2 - reach : x2 + reach;

  return `M${x1},${y1} C${c1},${y1} ${c2},${y2} ${x2},${y2}`;
}

const DASH: Record<string, string | undefined> = {
  [EDGE_KIND.static]: undefined,
  // Erased by `verbatimModuleSyntax`, so it costs nothing at runtime — drawn as
  // the lighter commitment it is.
  [EDGE_KIND.type]: "4 3",
  [EDGE_KIND.dynamic]: "1 3",
};

interface DependencyGraphProps {
  /** Already filtered — the layout is derived from exactly what is passed. */
  modules: ModuleNode[];
  edges: ModuleEdge[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Lowercased search term. Non-matching nodes recede; it never removes them,
   *  so the structure around a hit stays visible. */
  query: string;
}

export function DependencyGraph({
  modules,
  edges,
  selectedId,
  onSelect,
  query,
}: DependencyGraphProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const layout = useMemo(() => layOut(modules), [modules]);

  // Only edges whose both ends survived the filter can be drawn.
  const drawable = useMemo(
    () => edges.filter((e) => layout.byId.has(e.from) && layout.byId.has(e.to)),
    [edges, layout],
  );

  const focusId = hoveredId ?? selectedId;

  /** Everything one hop from the focused node, in either direction. */
  const neighbours = useMemo(() => {
    if (!focusId) return null;
    const ids = new Set<string>([focusId]);
    for (const edge of drawable) {
      if (edge.from === focusId) ids.add(edge.to);
      else if (edge.to === focusId) ids.add(edge.from);
    }
    return ids;
  }, [drawable, focusId]);

  const lit = drawable.filter(
    (e) => focusId && (e.from === focusId || e.to === focusId),
  );

  return (
    // Same frame as the sibling `ModuleTable` — two views of the same module
    // set, and they should read as one pane.
    <div className={TABLE_FRAME}>
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        // Not `role="img"`: the nodes are focusable controls, and an img would
        // hide them from assistive tech. The modules table below is the
        // non-visual path through the same data.
        aria-label="Module dependency graph"
        className="block max-w-none"
      >
        <defs>
          <marker
            id="dev-graph-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L7,4 L0,7 z" fill="currentColor" />
          </marker>
        </defs>

        {layout.columns.map((column) => (
          <text
            key={column.depth}
            x={column.x}
            y={16}
            className="fill-muted-foreground text-[10px] font-medium tracking-wide uppercase"
          >
            {column.label} · {column.count}
          </text>
        ))}

        {/* Two passes over the same edges: the quiet bed first, then the focused
            ones re-drawn on top so a highlighted curve is never buried under
            three hundred others. */}
        <g fill="none" className="text-border">
          {drawable.map((edge, i) => {
            const from = layout.byId.get(edge.from)!;
            const to = layout.byId.get(edge.to)!;
            return (
              <path
                key={`${edge.from}|${edge.to}|${edge.kind}|${i}`}
                d={edgePath(from, to)}
                stroke="currentColor"
                strokeWidth={1}
                strokeDasharray={DASH[edge.kind]}
                opacity={focusId ? 0.07 : 0.55}
              />
            );
          })}
        </g>

        <g fill="none" className="text-foreground">
          {lit.map((edge, i) => {
            const from = layout.byId.get(edge.from)!;
            const to = layout.byId.get(edge.to)!;
            return (
              <path
                key={`lit|${edge.from}|${edge.to}|${edge.kind}|${i}`}
                d={edgePath(from, to)}
                stroke="currentColor"
                strokeWidth={1.5}
                strokeDasharray={DASH[edge.kind]}
                opacity={0.85}
                markerEnd="url(#dev-graph-arrow)"
              />
            );
          })}
        </g>

        {layout.placed.map(({ node, x, y }) => {
          const visual = LAYER_VISUAL[node.layer];
          const matches = query.length === 0 || node.id.toLowerCase().includes(query);
          const dimmed = neighbours ? !neighbours.has(node.id) : !matches;
          const isFocus = node.id === focusId;

          return (
            <g
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`${node.id}, ${visual.label}, imports ${node.imports.length}, imported by ${node.importedBy.length}`}
              aria-pressed={node.id === selectedId}
              transform={`translate(${x},${y})`}
              opacity={dimmed ? 0.22 : 1}
              className="cursor-pointer outline-none"
              onMouseEnter={() => setHoveredId(node.id)}
              onMouseLeave={() => setHoveredId(null)}
              onFocus={() => setHoveredId(node.id)}
              onBlur={() => setHoveredId(null)}
              onClick={() => onSelect(node.id === selectedId ? null : node.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelect(node.id === selectedId ? null : node.id);
              }}
            >
              {/* The native tooltip is the cheap way to get the full path on a
                  node whose label had to be truncated. */}
              <title>{node.id}</title>
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={4}
                className="fill-card"
                stroke={visual.color}
                strokeWidth={isFocus ? 1.5 : 1}
                strokeOpacity={isFocus ? 1 : 0.45}
              />
              {/* The layer's colour rides on a 3px bar rather than filling the
                  node: the label needs foreground ink on the card to stay
                  readable, and a block of hue behind it would not allow that. */}
              <rect width={3} height={NODE_H} rx={1.5} fill={visual.color} />
              <text
                x={10}
                y={NODE_H / 2 + 3.5}
                className={cn(
                  "pointer-events-none text-[10px]",
                  isFocus ? "fill-foreground font-medium" : "fill-foreground/85",
                )}
              >
                {truncate(node.name, LABEL_CHARS)}
              </text>
              {node.id === selectedId && (
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={4}
                  fill="none"
                  className="stroke-ring"
                  strokeWidth={1}
                  strokeDasharray="3 2"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
