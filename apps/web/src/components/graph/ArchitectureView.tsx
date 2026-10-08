import { useId, useState, type KeyboardEvent } from "react";
import {
  ARCHITECTURE,
  ARCHITECTURE_EDGES,
  ARCHITECTURE_NODES,
  RAILWAY_FRAME,
  SHARED_PACKAGES_NOTE,
  architectureNode,
  type ArchitectureNode,
  type ArchitectureNodeId,
} from "@/lib/how-it-works/architecture";
import {
  GRAPH_EDGE_ATTRIBUTE,
  GRAPH_NODE_ATTRIBUTE,
  HOW_IT_WORKS_LABEL,
} from "@/lib/how-it-works/dom";
import {
  layOutArchitecture,
  type PlacedEdge,
  type PlacedNode,
  type Rect,
} from "@/lib/how-it-works/layout";
import { cn } from "@/lib/utils";
import { GraphCanvas } from "./GraphCanvas";

/**
 * The Architecture tab: the runtime boxes on a zoomable canvas, a panel that
 * explains whichever box is selected, and the same content as a visually
 * hidden ordered list for a screen reader (R11).
 *
 * Everything drawn comes from `@/lib/how-it-works/architecture`, and every
 * coordinate from `layOutArchitecture` over it — nothing here places a box.
 */

/** A rough width for a label's backing plate at the drawing's 11px. */
const LABEL_CHAR_WIDTH = 6.2;
const LABEL_HEIGHT = 16;

const titleOf = (id: ArchitectureNodeId) => architectureNode(id).title;

/** Computed once: the data is a constant, so its layout is too. */
const LAYOUT = layOutArchitecture(ARCHITECTURE);

export function ArchitectureView() {
  const [selectedId, setSelectedId] = useState<ArchitectureNodeId | null>(null);
  const selected = selectedId ? architectureNode(selectedId) : null;
  const arrowId = `arrow-${useId().replace(/:/g, "")}`;

  return (
    // The panel moves beside the canvas only at 2xl. Beside it at 1280px,
    // the drawing would shrink to about two thirds and its labels with it;
    // below, it keeps the width and the panel is still in view.
    <div className="flex flex-col gap-4 2xl:flex-row">
      <div className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-background">
        <GraphCanvas
          width={LAYOUT.width}
          height={LAYOUT.height}
          label={HOW_IT_WORKS_LABEL.architectureCanvas}
        >
          <defs>
            <marker
              id={arrowId}
              viewBox="0 0 10 10"
              refX="10"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                className="fill-muted-foreground"
              />
            </marker>
          </defs>

          <RailwayFrame rect={LAYOUT.frame} />
          <SharedPackagesNote rect={LAYOUT.note} />

          {LAYOUT.nodes.map((placed) => (
            <Box
              key={placed.node.id}
              placed={placed}
              selected={placed.node.id === selectedId}
              onSelect={() => setSelectedId(placed.node.id)}
            />
          ))}

          {LAYOUT.edges.map((placed) => (
            <Connection
              key={placed.edge.id}
              placed={placed}
              arrowId={arrowId}
            />
          ))}
        </GraphCanvas>
      </div>

      <section
        aria-label={HOW_IT_WORKS_LABEL.details}
        aria-live="polite"
        className="shrink-0 rounded-lg border bg-card p-4 2xl:w-80"
      >
        {selected ? (
          <>
            <h2 className="font-heading text-base font-semibold">
              {selected.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {selected.explanation}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Select a box to read what it does. Scroll to zoom, and drag to move
            around.
          </p>
        )}
      </section>

      <ArchitectureList />
    </div>
  );
}

function Box({
  placed,
  selected,
  onSelect,
}: {
  placed: PlacedNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const { node, x, y, width, height } = placed;
  // A box with another drawn inside it carries its title at the top, clear of
  // the child; every other box centres it.
  const container = ARCHITECTURE_NODES.some(
    (other) => other.inside === node.id,
  );
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={node.title}
      aria-pressed={selected}
      {...{ [GRAPH_NODE_ATTRIBUTE]: node.id }}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className="group cursor-pointer outline-none"
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={8}
        className={cn(
          "fill-card stroke-border transition-colors group-hover:stroke-muted-foreground group-focus-visible:stroke-ring",
          selected && "stroke-ring group-hover:stroke-ring",
        )}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      <text
        x={x + width / 2}
        y={container ? y + 24 : y + height / 2}
        dominantBaseline="middle"
        textAnchor="middle"
        className="fill-foreground text-[14px] font-medium"
      >
        {node.title}
      </text>
    </g>
  );
}

function Connection({
  placed,
  arrowId,
}: {
  placed: PlacedEdge;
  arrowId: string;
}) {
  const { edge, x1, y1, x2, y2, labelX, labelY } = placed;
  const plate = edge.label.length * LABEL_CHAR_WIDTH + 10;
  return (
    <g {...{ [GRAPH_EDGE_ATTRIBUTE]: edge.id }} className="pointer-events-none">
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        markerEnd={`url(#${arrowId})`}
        className="stroke-muted-foreground"
        strokeWidth={1.25}
      />
      <rect
        x={labelX - plate / 2}
        y={labelY - LABEL_HEIGHT / 2}
        width={plate}
        height={LABEL_HEIGHT}
        rx={4}
        className="fill-background"
      />
      <text
        x={labelX}
        y={labelY}
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-muted-foreground text-[11px]"
      >
        {edge.label}
      </text>
    </g>
  );
}

function RailwayFrame({ rect }: { rect: Rect }) {
  const { x, y, width, height } = rect;
  return (
    <g className="pointer-events-none">
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={12}
        className="fill-none stroke-bronze"
        strokeWidth={1.25}
        strokeDasharray="6 4"
      />
      {/* Bottom-left, where no connection's label lands. The rule is bronze,
          the decorative edge; its name is muted, since bronze text reads as
          urgency (the hue map at the top of `index.css`). */}
      <text
        x={x + 12}
        y={y + height - 10}
        className="fill-muted-foreground text-[12px] font-medium tracking-wide"
      >
        {RAILWAY_FRAME.title}
      </text>
    </g>
  );
}

function SharedPackagesNote({ rect }: { rect: Rect }) {
  const { x, y, width, height } = rect;
  return (
    <g className="pointer-events-none">
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={6}
        className="fill-muted/40 stroke-border"
        strokeDasharray="3 3"
      />
      <text
        x={x + 12}
        y={y + 22}
        className="fill-foreground text-[12px] font-medium"
      >
        {SHARED_PACKAGES_NOTE.title}
      </text>
      <text x={x + 12} y={y + 40} className="fill-muted-foreground text-[10px]">
        {SHARED_PACKAGES_NOTE.caption}
      </text>
    </g>
  );
}

/**
 * The drawing as a screen reader gets it: one item per box, in the data's
 * order, carrying the panel's words and the connections it starts.
 */
function ArchitectureList() {
  return (
    <ol aria-label={HOW_IT_WORKS_LABEL.architectureList} className="sr-only">
      {ARCHITECTURE_NODES.map((node) => (
        <li key={node.id}>
          <ListEntry node={node} />
        </li>
      ))}
      <li>
        {RAILWAY_FRAME.title}: {RAILWAY_FRAME.explanation} It holds{" "}
        {RAILWAY_FRAME.encloses.map(titleOf).join(" and ")}.
      </li>
      <li>
        {SHARED_PACKAGES_NOTE.title}: {SHARED_PACKAGES_NOTE.text}
      </li>
    </ol>
  );
}

function ListEntry({ node }: { node: ArchitectureNode }) {
  const outgoing = ARCHITECTURE_EDGES.filter((edge) => edge.from === node.id);
  return (
    <>
      {node.title}
      {node.inside ? ` (inside ${titleOf(node.inside)})` : ""}:{" "}
      {node.explanation}
      {outgoing.length > 0 && (
        <ul>
          {outgoing.map((edge) => (
            <li key={edge.id}>
              {edge.label} to {titleOf(edge.to)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
