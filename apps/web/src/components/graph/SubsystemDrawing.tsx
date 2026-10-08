import { useId } from "react";
import { architectureNode } from "@/lib/how-it-works/architecture";
import {
  GRAPH_EDGE_ATTRIBUTE,
  GRAPH_EMPHASIS,
  GRAPH_EMPHASIS_ATTRIBUTE,
  HOW_IT_WORKS_LABEL,
} from "@/lib/how-it-works/dom";
import {
  layOutSubsystems,
  type PlacedPart,
  type SubsystemLayout,
} from "@/lib/how-it-works/subsystem-layout";
import {
  DRILLABLE_BOXES,
  part,
  subsystemsOf,
  type DrillableBoxId,
  type PartId,
} from "@/lib/how-it-works/subsystems";
import { cn } from "@/lib/utils";
import { ArrowMarker } from "./ArrowMarker";
import { GraphCanvas } from "./GraphCanvas";
import { SelectableNode } from "./SelectableNode";
import { emphasisClass, emphasisOf } from "./emphasis";

/**
 * One runtime box opened onto its subsystems (R3): the subsystems in a framed
 * column, the parts of other boxes they talk to either side, and a link for
 * each conversation. Selecting a subsystem or a part brings its links forward
 * and fades the rest.
 *
 * Every coordinate comes from `layOutSubsystems`, computed once per box.
 */

/** Computed once: the data is a constant, so its layouts are too. */
const LAYOUTS = Object.fromEntries(
  DRILLABLE_BOXES.map((box) => [box, layOutSubsystems(subsystemsOf(box))]),
) as Record<DrillableBoxId, SubsystemLayout>;

export function SubsystemDrawing({
  box,
  selectedId,
  onSelect,
}: {
  box: DrillableBoxId;
  /** The subsystem or part selected, if any. */
  selectedId: PartId | null;
  onSelect: (id: PartId) => void;
}) {
  const layout = LAYOUTS[box];
  const id = useId().replace(/:/g, "");
  const arrowId = `arrow-${id}`;
  const currentArrowId = `arrow-current-${id}`;
  const selecting = selectedId !== null;
  const touches = (subsystem: PartId, part: PartId) =>
    subsystem === selectedId || part === selectedId;

  return (
    <GraphCanvas
      width={layout.width}
      height={layout.height}
      label={HOW_IT_WORKS_LABEL.subsystemCanvas}
    >
      <ArrowMarker id={arrowId} />
      <ArrowMarker id={currentArrowId} className="fill-ring" />

      <g className="pointer-events-none">
        <rect
          x={layout.frame.x}
          y={layout.frame.y}
          width={layout.frame.width}
          height={layout.frame.height}
          rx={12}
          className="fill-muted/25 stroke-border"
        />
        <text
          x={layout.frame.x + 14}
          y={layout.frame.y + 20}
          dominantBaseline="middle"
          className="fill-foreground text-[13px] font-medium"
        >
          {architectureNode(box).title}
        </text>
      </g>

      {layout.links.map((placed) => {
        const emphasis = emphasisOf(
          selecting,
          touches(placed.subsystem, placed.link.part),
        );
        const current = emphasis === GRAPH_EMPHASIS.current;
        return (
          <path
            key={placed.id}
            {...{
              [GRAPH_EDGE_ATTRIBUTE]: placed.id,
              [GRAPH_EMPHASIS_ATTRIBUTE]: emphasis,
            }}
            d={placed.path}
            fill="none"
            markerEnd={`url(#${current ? currentArrowId : arrowId})`}
            className={cn(
              "pointer-events-none",
              current ? "stroke-ring" : "stroke-muted-foreground",
              emphasisClass(emphasis),
            )}
            strokeWidth={current ? 2 : 1.25}
          />
        );
      })}

      {layout.subsystems.map((placed) => {
        const { subsystem, x, y, width, height } = placed;
        return (
          <SelectableNode
            key={subsystem.id}
            id={subsystem.id}
            label={subsystem.title}
            rect={placed}
            selected={subsystem.id === selectedId}
            emphasis={emphasisOf(
              selecting,
              subsystem.id === selectedId ||
                subsystem.links.some((link) => link.part === selectedId),
            )}
            onSelect={() => onSelect(subsystem.id)}
          >
            <text
              x={x + width / 2}
              y={y + height / 2}
              dominantBaseline="central"
              textAnchor="middle"
              className="fill-foreground text-[13px] font-medium"
            >
              {subsystem.title}
            </text>
          </SelectableNode>
        );
      })}

      {layout.parts.map((placed) => (
        <Part
          key={placed.id}
          placed={placed}
          layout={layout}
          selectedId={selectedId}
          onSelect={() => onSelect(placed.id)}
        />
      ))}
    </GraphCanvas>
  );
}

/**
 * A part of another box. A subsystem of one carries that box's name above its
 * own, so the API's Outbox and the app's Outbox screen are never confused.
 */
function Part({
  placed,
  layout,
  selectedId,
  onSelect,
}: {
  placed: PlacedPart;
  layout: SubsystemLayout;
  selectedId: PartId | null;
  onSelect: () => void;
}) {
  const { id, x, y, width, height } = placed;
  const { box, title, label } = part(id);
  // A subsystem of another box, rather than a runtime box itself.
  const inAnotherBox = box !== id;
  const joined =
    id === selectedId ||
    layout.links.some(
      (link) => link.link.part === id && link.subsystem === selectedId,
    );

  return (
    <SelectableNode
      id={id}
      label={label}
      rect={placed}
      selected={id === selectedId}
      emphasis={emphasisOf(selectedId !== null, joined)}
      onSelect={onSelect}
    >
      {inAnotherBox && (
        <text
          x={x + width / 2}
          y={y + 15}
          dominantBaseline="central"
          textAnchor="middle"
          className="fill-muted-foreground text-[10px] tracking-wide uppercase"
        >
          {architectureNode(box).title}
        </text>
      )}
      <text
        x={x + width / 2}
        y={inAnotherBox ? y + 32 : y + height / 2}
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-foreground text-[13px]"
      >
        {title}
      </text>
    </SelectableNode>
  );
}
