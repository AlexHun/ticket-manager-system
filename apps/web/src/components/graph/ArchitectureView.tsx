import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  isDrillable,
  linkPhrase,
  linkPhrasesFor,
  part,
  subsystemsOf,
  type DrillableBoxId,
  type PartId,
} from "@/lib/how-it-works/subsystems";
import {
  layOutArchitecture,
  type PlacedEdge,
  type PlacedNode,
  type Rect,
} from "@/lib/how-it-works/layout";
import { ArrowMarker } from "./ArrowMarker";
import { DetailsPanel } from "./DetailsPanel";
import { GraphCanvas } from "./GraphCanvas";
import { CodeLine, InTheCodeDetails } from "./InTheCodeDetails";
import { SelectableNode } from "./SelectableNode";
import { SubsystemDrawing } from "./SubsystemDrawing";

/**
 * The Architecture tab: the runtime boxes on a zoomable canvas, a panel that
 * explains whichever box is selected, and the same content as a visually
 * hidden ordered list for a screen reader (R11).
 *
 * Selecting the API, the job workers or the browser app opens it onto its
 * subsystems (R3). Back, or Escape, returns to the runtime boxes with the same
 * box selected.
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
  // The box opened onto its subsystems, and what is selected inside it.
  const [openBox, setOpenBox] = useState<DrillableBoxId | null>(null);
  const [partId, setPartId] = useState<PartId | null>(null);
  const arrowId = `arrow-${useId().replace(/:/g, "")}`;
  const runtimeRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const select = (id: ArchitectureNodeId) => {
    setSelectedId(id);
    if (isDrillable(id)) {
      setOpenBox(id);
      setPartId(null);
    }
  };
  const back = () => setOpenBox(null);

  // Focus follows the level: opening a box lands it on Back, and leaving lands
  // it on the box that was opened, so a keyboard user is never left on a
  // control that has just disappeared.
  useEffect(() => {
    if (openBox) {
      backRef.current?.focus();
    } else if (wasOpen.current && selectedId) {
      runtimeRef.current
        ?.querySelector<SVGGElement>(
          `[${GRAPH_NODE_ATTRIBUTE}="${selectedId}"]`,
        )
        ?.focus();
    }
    wasOpen.current = openBox !== null;
    // Only a change of level moves focus, so `selectedId` is read, not watched.
  }, [openBox]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && openBox) {
      event.preventDefault();
      back();
    }
  };

  const panelId: PartId | null = openBox ? (partId ?? openBox) : selectedId;
  // A part of another box is named with its box, as on the drawing.
  const panelPart = panelId === null ? null : part(panelId);
  const panelTitle =
    panelPart === null
      ? null
      : openBox && panelPart.box !== openBox
        ? panelPart.label
        : panelPart.title;
  const panelLinks = openBox && partId ? linkPhrasesFor(openBox, partId) : [];

  return (
    // The panel moves beside the canvas only at 2xl. Beside it at 1280px,
    // the drawing would shrink to about two thirds and its labels with it;
    // below, it keeps the width and the panel is still in view.
    <div className="flex flex-col gap-4 2xl:flex-row" onKeyDown={onKeyDown}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {openBox && (
          <div className="flex items-center gap-2">
            <Button ref={backRef} variant="outline" size="sm" onClick={back}>
              <ArrowLeft aria-hidden />
              {HOW_IT_WORKS_LABEL.backToRuntime}
            </Button>
            <p className="text-sm text-muted-foreground">
              Inside {architectureNode(openBox).title}. Escape goes back too.
            </p>
          </div>
        )}

        {/* Hidden rather than unmounted while a box is open, so coming back
            finds every box, and the view, exactly where they were (R9). */}
        <div
          ref={runtimeRef}
          hidden={openBox !== null}
          className="overflow-hidden rounded-lg border bg-background"
        >
          <GraphCanvas
            width={LAYOUT.width}
            height={LAYOUT.height}
            label={HOW_IT_WORKS_LABEL.architectureCanvas}
          >
            <ArrowMarker id={arrowId} />

            <RailwayFrame rect={LAYOUT.frame} />
            <SharedPackagesNote rect={LAYOUT.note} />

            {LAYOUT.nodes.map((placed) => (
              <Box
                key={placed.node.id}
                placed={placed}
                selected={placed.node.id === selectedId}
                onSelect={() => select(placed.node.id)}
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

        {openBox && (
          <div className="overflow-hidden rounded-lg border bg-background">
            <SubsystemDrawing
              key={openBox}
              box={openBox}
              selectedId={partId}
              onSelect={setPartId}
            />
          </div>
        )}
      </div>

      <DetailsPanel
        title={panelTitle}
        hint="Select a box to read what it does; the API, the job workers and the browser app open onto their parts. Scroll to zoom, and drag to move around."
      >
        {panelPart && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {panelPart.explanation}
          </p>
        )}
        {panelLinks.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {panelLinks.map((phrase) => (
              <li key={phrase}>{phrase}</li>
            ))}
          </ul>
        )}
        {panelPart && (
          <InTheCodeDetails code={panelPart.code} screen={panelPart.screen} />
        )}
      </DetailsPanel>

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

  return (
    <SelectableNode
      id={node.id}
      label={node.title}
      rect={placed}
      selected={selected}
      onSelect={onSelect}
    >
      <text
        x={x + width / 2}
        y={container ? y + 24 : y + height / 2}
        dominantBaseline="middle"
        textAnchor="middle"
        className="fill-foreground text-[14px] font-medium"
      >
        {node.title}
      </text>
    </SelectableNode>
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
 * order, carrying the panel's words and the connections it starts, and for a
 * box that opens, its subsystems and what each talks to.
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
      <CodeLine code={node.code} />
      {outgoing.length > 0 && (
        <ul>
          {outgoing.map((edge) => (
            <li key={edge.id}>
              {edge.label} to {titleOf(edge.to)}
            </li>
          ))}
        </ul>
      )}
      {isDrillable(node.id) && (
        <>
          <p>Inside it:</p>
          <ol>
            {subsystemsOf(node.id).map((subsystem) => (
              <li key={subsystem.id}>
                {subsystem.title}: {subsystem.explanation}
                <CodeLine code={subsystem.code} />
                <ul>
                  {subsystem.links.map((link) => (
                    <li key={link.part}>{linkPhrase(link)}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}
